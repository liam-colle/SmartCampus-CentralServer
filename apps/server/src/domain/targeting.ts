import { z } from "zod";
import { DeviceModel } from "../models/device.js";
import { RoomModel } from "../models/room.js";
import { HttpError } from "../lib/errors.js";

/** Which devices a message is for. Used by visual announcements and audio broadcasts. */
export const targetsInput = z
  .object({
    all: z.boolean().optional(),
    devices: z.array(z.string().min(1).max(40)).max(500).optional(),
    groups: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
    buildings: z.array(z.string().min(1).max(40)).max(50).optional(),
    floors: z.array(z.object({ building: z.string().min(1).max(40), floor: z.number().int().min(-10).max(200) })).max(50).optional(),
  })
  .strict();

export type Targets = z.infer<typeof targetsInput>;

/** Screens that can show or play an announcement. Access units have neither. */
const ANNOUNCEMENT_DEVICE_TYPES = ["door", "display"];

/**
 * Resolves targets to the ids of active devices. Rooms matched by building or floor give their
 * linked devices; a device without a room only matches by id, group or `all`.
 */
export async function resolveTargetDevices(targets: Targets): Promise<string[]> {
  const base = { status: "active", type: { $in: ANNOUNCEMENT_DEVICE_TYPES } };
  if (targets.all) return (await DeviceModel.find(base, { deviceId: 1 })).map((d) => d.deviceId);

  const roomIds = new Set<string>();
  if (targets.buildings?.length) {
    for (const room of await RoomModel.find({ building: { $in: targets.buildings } }, { _id: 1 })) roomIds.add(String(room._id));
  }
  for (const { building, floor } of targets.floors ?? []) {
    for (const room of await RoomModel.find({ building, floor }, { _id: 1 })) roomIds.add(String(room._id));
  }

  const selectors: Record<string, unknown>[] = [];
  if (targets.devices?.length) selectors.push({ deviceId: { $in: targets.devices } });
  if (targets.groups?.length) selectors.push({ groups: { $in: targets.groups } });
  if (roomIds.size) selectors.push({ room: { $in: [...roomIds] } });
  if (selectors.length === 0) return [];

  return (await DeviceModel.find({ ...base, $or: selectors }, { deviceId: 1 })).map((d) => d.deviceId);
}

/** Like resolveTargetDevices, but refuses a target that reaches nobody so a typo is not silently "sent". */
export async function requireTargetDevices(targets: Targets): Promise<string[]> {
  const ids = await resolveTargetDevices(targets);
  if (ids.length === 0) throw new HttpError(400, "No active screen matches these targets");
  return ids;
}
