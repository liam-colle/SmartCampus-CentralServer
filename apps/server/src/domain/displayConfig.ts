import { displayConfig, type DisplayConfig } from "@smartcampus/protocol";
import { HttpError } from "../lib/errors.js";
import { recordAudit } from "../lib/audit.js";
import { DeviceModel } from "../models/device.js";
import type { PublicUser } from "../models/user.js";
import { enqueueCommand } from "./commands.js";

type Actor = Pick<PublicUser, "id" | "name">;

/** Only screens have a layout: access units have nothing to configure. */
const CONFIGURABLE_TYPES = ["door", "display"];

/** The configuration a device is meant to show: what was last set, or the defaults. */
export async function currentDisplayConfig(deviceId: string): Promise<DisplayConfig> {
  const device = await DeviceModel.findOne({ deviceId }, { desired: 1 });
  return displayConfig.parse((device?.desired as { displayConfig?: unknown } | undefined)?.displayConfig ?? {});
}

export async function setDisplayConfig(deviceId: string, config: DisplayConfig, actor: Actor): Promise<void> {
  const device = await DeviceModel.findOne({ deviceId, status: "active" }, { type: 1 });
  if (!device) throw new HttpError(404, "Active device not found");
  if (!CONFIGURABLE_TYPES.includes(device.type)) throw new HttpError(400, "This kind of device has no display to configure");

  await enqueueCommand(deviceId, "display.config.set", { config });
  await recordAudit(actor, "device.display-config", { type: "device", id: deviceId }, { layout: config.layout, theme: config.theme });
}

export interface CopyResult {
  deviceId: string;
  ok: boolean;
  error?: string;
}

/**
 * Copies the configuration of `sourceId` to other screens. A target that cannot take it (unknown,
 * revoked, not a screen) is reported but does not stop the others.
 */
export async function copyDisplayConfig(sourceId: string, targetIds: string[], actor: Actor): Promise<CopyResult[]> {
  const config = await currentDisplayConfig(sourceId);
  const results: CopyResult[] = [];
  for (const deviceId of new Set(targetIds)) {
    if (deviceId === sourceId) continue;
    try {
      await setDisplayConfig(deviceId, config, actor);
      results.push({ deviceId, ok: true });
    } catch (err) {
      results.push({ deviceId, ok: false, error: err instanceof HttpError ? err.message : "Could not send the configuration" });
    }
  }
  await recordAudit(actor, "device.display-config.copy", { type: "device", id: sourceId }, {
    targets: results.length,
    failed: results.filter((r) => !r.ok).length,
  });
  return results;
}
