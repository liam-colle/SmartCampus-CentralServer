import { isCommandType, parseServerMessage, buildMessage, ulid, type CommandType } from "@smartcampus/protocol";
import { HttpError } from "../lib/errors.js";
import { registry } from "../gateway/registry.js";
import { CommandModel } from "../models/command.js";
import { DeviceModel } from "../models/device.js";
import { patchDesired } from "./devices.js";

const DEFAULT_TTL_SECONDS = 3600;

/** Commands that set a lasting state: only the newest one matters, older unacknowledged ones are dropped. */
const STATE_COMMAND_TYPES: readonly CommandType[] = [
  "room.status.set",
  "room.info.set",
  "display.config.set",
  "audio.settings.set",
];

/**
 * Queues a command for a device (outbox) and delivers it right away if the device is online.
 * Offline devices get it on reconnection, as long as it has not expired.
 */
export async function enqueueCommand(
  deviceId: string,
  type: string,
  payload: unknown,
  ttlSeconds = DEFAULT_TTL_SECONDS,
) {
  if (!isCommandType(type)) throw new HttpError(400, `Unknown command type "${type}"`);
  if (!(await DeviceModel.exists({ deviceId, status: "active" }))) throw new HttpError(404, "Active device not found");

  // Validate with the same schema the device will use, so a bad command never reaches the outbox.
  const probe = parseServerMessage(JSON.stringify(buildMessage({ type, payload } as never, 1)));
  if (!probe.ok) throw new HttpError(400, probe.error);

  if ((STATE_COMMAND_TYPES as readonly string[]).includes(type)) {
    // Why: a device that was offline for an hour should not replay forty status flips, only the last.
    await CommandModel.updateMany({ deviceId, type, status: { $in: ["pending", "sent"] } }, { $set: { status: "superseded" } });
  }

  const command = await CommandModel.create({
    commandId: ulid(),
    deviceId,
    type,
    payload: probe.message.payload,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000),
  });

  await updateDesiredFor(deviceId, type, probe.message.payload as Record<string, unknown>);
  void registry.get(deviceId)?.flush().catch((err) => console.error("flush failed", err));
  return command;
}

/** Commands that describe lasting state also update the digital twin target. */
async function updateDesiredFor(deviceId: string, type: CommandType, payload: Record<string, unknown>) {
  if (type === "room.status.set") await patchDesired(deviceId, { roomStatus: payload });
  else if (type === "room.info.set") await patchDesired(deviceId, { room: payload });
  else if (type === "display.config.set") await patchDesired(deviceId, { displayConfig: payload.config });
  else if (type === "audio.settings.set") await patchDesired(deviceId, { audioSettings: payload });
}

/** Unacknowledged, unexpired commands in creation order: what a (re)connecting device must receive. */
export function pendingCommands(deviceId: string) {
  return CommandModel.find({
    deviceId,
    status: { $in: ["pending", "sent"] },
    expiresAt: { $gt: new Date() },
  }).sort({ commandId: 1 });
}

export const markSent = (commandId: string) =>
  CommandModel.updateOne({ commandId }, { $set: { status: "sent", sentAt: new Date() }, $inc: { attempts: 1 } });

/** `deviceId` is checked so a device can only acknowledge its own commands. */
export const markAcked = (deviceId: string, commandId: string) =>
  CommandModel.updateOne({ deviceId, commandId }, { $set: { status: "acked", ackedAt: new Date() } });

export const markNacked = (deviceId: string, commandId: string, reason: string) =>
  CommandModel.updateOne({ deviceId, commandId }, { $set: { status: "nacked", nackReason: reason } });

export const recentCommands = (deviceId: string, limit = 50) =>
  CommandModel.find({ deviceId }).sort({ commandId: -1 }).limit(limit).lean();
