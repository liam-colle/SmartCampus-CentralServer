import { ulid } from "@smartcampus/protocol";
import { HttpError } from "../lib/errors.js";
import { recordAudit } from "../lib/audit.js";
import { AnnouncementModel } from "../models/announcement.js";
import { AssetModel } from "../models/asset.js";
import type { PublicUser } from "../models/user.js";
import { enqueueCommand } from "./commands.js";
import { requireTargetDevices, type Targets } from "./targeting.js";

type Actor = Pick<PublicUser, "id" | "name">;

/**
 * A broadcast that reaches a screen minutes late is worse than none ("evacuate now" at 10:40),
 * so audio commands expire quickly instead of waiting an hour for an offline device.
 */
export const AUDIO_COMMAND_TTL_SECONDS = 5 * 60;

/** Plays a stored sound on the chosen devices. Offline devices only get it if they return within the TTL. */
export async function broadcastAudio(input: { assetId: string; title?: string; targets: Targets }, actor: Actor) {
  const asset = await AssetModel.findOne({ assetId: input.assetId });
  if (!asset) throw new HttpError(404, "Asset not found");
  const deviceIds = await requireTargetDevices(input.targets);

  const announcement = await AnnouncementModel.create({
    announcementId: ulid(),
    kind: "audio",
    title: input.title ?? asset.name,
    assetId: asset.assetId,
    targets: input.targets,
    deviceIds,
    createdByName: actor.name,
  });

  for (const deviceId of deviceIds) {
    await enqueueCommand(
      deviceId,
      "audio.play",
      {
        announcementId: announcement.announcementId,
        title: announcement.title,
        assetId: asset.assetId,
        sha256: asset.sha256,
        size: asset.size,
      },
      AUDIO_COMMAND_TTL_SECONDS,
    );
  }
  await recordAudit(actor, "intercom.broadcast", { type: "announcement", id: announcement.announcementId }, {
    assetId: asset.assetId,
    devices: deviceIds.length,
  });
  return announcement;
}
