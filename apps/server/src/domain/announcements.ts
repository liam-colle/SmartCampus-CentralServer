import { ulid, type PayloadOf } from "@smartcampus/protocol";
import { HttpError } from "../lib/errors.js";
import { recordAudit } from "../lib/audit.js";
import { AnnouncementModel } from "../models/announcement.js";
import { CommandModel } from "../models/command.js";
import { DeviceModel } from "../models/device.js";
import type { PublicUser } from "../models/user.js";
import { enqueueCommand } from "./commands.js";
import { requireTargetDevices, type Targets } from "./targeting.js";

type Actor = Pick<PublicUser, "id" | "name">;

/** An announcement without an expiry stays until cancelled; its command waits this long for an offline device. */
const NO_EXPIRY_COMMAND_TTL_SECONDS = 7 * 86_400;

export interface AnnouncementInput {
  title?: string;
  text: string;
  priority: PayloadOf<"announce.show">["priority"];
  targets: Targets;
  expiresAt?: Date;
}

/**
 * Stores the announcement, puts it in the digital twin of every target (so a screen that reconnects
 * sees it even after its command expired) and queues `announce.show`. The screen hides it by itself
 * at `expiresAt`, so expiry works through an outage.
 */
export async function createAnnouncement(input: AnnouncementInput, actor: Actor) {
  if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) throw new HttpError(400, "expiresAt must be in the future");
  const deviceIds = await requireTargetDevices(input.targets);

  const announcement = await AnnouncementModel.create({
    announcementId: ulid(),
    title: input.title ?? "",
    text: input.text,
    priority: input.priority,
    targets: input.targets,
    deviceIds,
    expiresAt: input.expiresAt,
    createdByName: actor.name,
  });

  const payload: PayloadOf<"announce.show"> = {
    announcementId: announcement.announcementId,
    ...(announcement.title && { title: announcement.title }),
    text: announcement.text,
    priority: announcement.priority,
    ...(input.expiresAt && { expiresAt: input.expiresAt.getTime() }),
  };
  const ttlSeconds = input.expiresAt
    ? Math.max(10, Math.ceil((input.expiresAt.getTime() - Date.now()) / 1000))
    : NO_EXPIRY_COMMAND_TTL_SECONDS;

  for (const deviceId of deviceIds) {
    await DeviceModel.updateOne({ deviceId }, { $set: { [`desired.announcements.${announcement.announcementId}`]: payload } });
    await enqueueCommand(deviceId, "announce.show", payload, ttlSeconds);
  }
  await recordAudit(actor, "announcement.create", { type: "announcement", id: announcement.announcementId }, {
    priority: announcement.priority,
    devices: deviceIds.length,
  });
  return announcement;
}

/** Takes an announcement off every screen and out of their desired state. */
export async function cancelAnnouncement(announcementId: string, actor: Actor) {
  const announcement = await AnnouncementModel.findOneAndUpdate(
    { announcementId, kind: "text", status: "active" },
    { $set: { status: "cancelled", cancelledAt: new Date() } },
    { new: true },
  );
  if (!announcement) throw new HttpError(404, "Active announcement not found");

  // An unsent announce.show must never reach a device after its cancellation.
  await CommandModel.updateMany(
    { type: "announce.show", "payload.announcementId": announcementId, status: { $in: ["pending", "sent"] } },
    { $set: { status: "superseded" } },
  );
  for (const deviceId of announcement.deviceIds) {
    await DeviceModel.updateOne({ deviceId }, { $unset: { [`desired.announcements.${announcementId}`]: 1 } });
    await enqueueCommand(deviceId, "announce.clear", { announcementId });
  }
  await recordAudit(actor, "announcement.cancel", { type: "announcement", id: announcementId });
  return announcement;
}

/** Per device delivery of one announcement, from the outbox. */
export async function deliveryOf(announcementId: string, deviceIds: string[], type: "announce.show" | "audio.play") {
  const commands = await CommandModel.find({ type, "payload.announcementId": announcementId }).lean();
  const byDevice = new Map(commands.map((c) => [c.deviceId, c.status]));
  const devices = await DeviceModel.find({ deviceId: { $in: deviceIds } }, { deviceId: 1, name: 1 }).lean();
  return devices.map((d) => ({ deviceId: d.deviceId, name: d.name || d.deviceId, delivery: byDevice.get(d.deviceId) ?? "pending" }));
}
