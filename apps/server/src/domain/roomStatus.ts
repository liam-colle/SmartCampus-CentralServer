import type { PayloadOf } from "@smartcampus/protocol";
import { HttpError } from "../lib/errors.js";
import { recordAudit } from "../lib/audit.js";
import { consoleBus } from "../gateway/consoleBus.js";
import { DeviceModel } from "../models/device.js";
import { BUILT_IN_STATUSES, DEFAULT_STATUS_KEY, RoomStatusModel } from "../models/roomStatus.js";
import { RoomStatusChangeModel } from "../models/roomStatusChange.js";
import { RoomModel } from "../models/room.js";
import type { PublicUser } from "../models/user.js";
import { enqueueCommand } from "./commands.js";

type Actor = Pick<PublicUser, "id" | "name">;

/** Creates the built-in statuses that are missing. Existing ones keep any label or colour an admin changed. */
export async function seedRoomStatuses(): Promise<void> {
  for (const status of BUILT_IN_STATUSES) {
    await RoomStatusModel.updateOne({ key: status.key }, { $setOnInsert: { ...status, builtIn: true } }, { upsert: true });
  }
}

async function loadStatus(key: string) {
  const status = await RoomStatusModel.findOne({ key });
  if (!status) throw new HttpError(400, `Unknown status "${key}"`);
  return status;
}

/** Active devices linked to a room. Only these show its status. */
const devicesOfRoom = (roomId: string) => DeviceModel.find({ room: roomId, status: "active" }, { deviceId: 1 });

function statusPayload(roomId: string, status: { key: string; label: string; color: string; icon: string }, since?: Date | null) {
  return {
    roomId,
    status: status.key,
    label: status.label,
    color: status.color,
    icon: status.icon,
    ...(since && { since: since.getTime() }),
  } as PayloadOf<"room.status.set">;
}

/** Sends what a door screen shows about its room (facts + current status) to one device. */
export async function pushRoomToDevice(deviceId: string, roomId: string): Promise<void> {
  const room = await RoomModel.findById(roomId).populate<{ building: { name: string } }>("building", "name");
  if (!room) return;
  const status = await RoomStatusModel.findOne({ key: room.status });
  await enqueueCommand(deviceId, "room.info.set", {
    roomId,
    code: room.code,
    name: room.name ?? "",
    building: room.building.name,
    floor: room.floor,
    capacity: room.capacity ?? null,
  });
  if (status) await enqueueCommand(deviceId, "room.status.set", statusPayload(roomId, status, room.statusSince));
}

export async function pushRoomToItsDevices(roomId: string): Promise<void> {
  for (const device of await devicesOfRoom(roomId)) await pushRoomToDevice(device.deviceId, roomId);
}

/**
 * Changes the status of a room: stores it, keeps a history row, tells the devices of the room
 * (outbox, so offline screens catch up) and writes an audit entry. Setting the same status again is a no-op.
 */
export async function setRoomStatus(roomId: string, key: string, actor: Actor) {
  const status = await loadStatus(key);
  const room = await RoomModel.findById(roomId);
  if (!room) throw new HttpError(404, "Room not found");
  if (room.status === key) return room;

  const from = room.status;
  const now = new Date();
  room.status = key;
  room.statusSince = now;
  await room.save();

  await RoomStatusChangeModel.create({
    room: room._id,
    from,
    to: key,
    toLabel: status.label,
    toColor: status.color,
    actorName: actor.name,
    at: now,
  });
  for (const device of await devicesOfRoom(roomId)) {
    await enqueueCommand(device.deviceId, "room.status.set", statusPayload(roomId, status, now));
  }
  consoleBus.emit("room.status.changed", { roomId, status: key });
  await recordAudit(actor, "room.status.set", { type: "room", id: roomId }, { from, to: key });
  return room;
}

/** After a status was renamed or recoloured, devices of every room using it get the new look. */
export async function pushStatusDefinition(key: string): Promise<void> {
  const status = await loadStatus(key);
  for (const room of await RoomModel.find({ status: key }, { statusSince: 1 })) {
    for (const device of await devicesOfRoom(String(room._id))) {
      await enqueueCommand(device.deviceId, "room.status.set", statusPayload(String(room._id), status, room.statusSince));
    }
  }
}

/** Newest first. */
export const roomStatusHistory = (roomId: string, limit = 50) =>
  RoomStatusChangeModel.find({ room: roomId }).sort({ at: -1 }).limit(limit).lean();

export { DEFAULT_STATUS_KEY };
