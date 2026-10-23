import { EMERGENCY_CATALOGUE, ulid, type EmergencyKind, type PayloadOf } from "@smartcampus/protocol";
import { HttpError } from "../lib/errors.js";
import { recordAudit } from "../lib/audit.js";
import { CommandModel } from "../models/command.js";
import { DeviceModel } from "../models/device.js";
import { EmergencyModel } from "../models/emergency.js";
import type { PublicUser } from "../models/user.js";
import { consoleBus } from "../gateway/consoleBus.js";
import { enqueueCommand } from "./commands.js";
import { requireTargetDevices, type Targets } from "./targeting.js";

type Actor = Pick<PublicUser, "id" | "name">;

/** An emergency has no end time of its own, so a screen that is offline keeps its command for a day. */
const EMERGENCY_COMMAND_TTL_SECONDS = 86_400;

export interface EmergencyInput {
  kind: EmergencyKind;
  targets: Targets;
  testMode: boolean;
  testVolume: number;
  /** Replaces the default wording for this alert only. */
  instructions?: string;
}

/**
 * Starts an emergency on every target. It goes into the digital twin as well as the outbox, so a
 * screen that reconnects after its command expired still sounds the alarm. A screen shows one
 * emergency at a time: a newer one replaces an older one.
 */
export async function triggerEmergency(input: EmergencyInput, actor: Actor) {
  const deviceIds = await requireTargetDevices(input.targets);
  const info = EMERGENCY_CATALOGUE[input.kind];

  const emergency = await EmergencyModel.create({
    emergencyId: ulid(),
    kind: input.kind,
    title: info.title,
    instructions: input.instructions ?? info.instructions,
    testMode: input.testMode,
    testVolume: input.testVolume,
    targets: input.targets,
    deviceIds,
    startedByName: actor.name,
  });

  const payload: PayloadOf<"emergency.set"> = {
    emergencyId: emergency.emergencyId,
    kind: input.kind,
    title: emergency.title,
    instructions: emergency.instructions,
    testMode: emergency.testMode,
    testVolume: emergency.testVolume,
    startedAt: Date.now(),
  };
  for (const deviceId of deviceIds) await enqueueCommand(deviceId, "emergency.set", payload, EMERGENCY_COMMAND_TTL_SECONDS);

  await recordAudit(actor, "emergency.trigger", { type: "emergency", id: emergency.emergencyId }, {
    kind: input.kind,
    testMode: input.testMode,
    devices: deviceIds.length,
  });
  consoleBus.emit("emergency.changed", { emergencyId: emergency.emergencyId });
  return emergency;
}

/**
 * Ends an emergency. Only the screens that still show *this* emergency are cleared: one that was
 * since taken over by a newer alert keeps showing it.
 */
export async function clearEmergency(emergencyId: string, actor: Actor) {
  const emergency = await EmergencyModel.findOneAndUpdate(
    { emergencyId, status: "active" },
    { $set: { status: "cleared", clearedAt: new Date(), clearedByName: actor.name } },
    { new: true },
  );
  if (!emergency) throw new HttpError(404, "Active emergency not found");

  const showing = await DeviceModel.find({ deviceId: { $in: emergency.deviceIds }, "desired.emergency.emergencyId": emergencyId }, { deviceId: 1 });
  for (const { deviceId } of showing) await enqueueCommand(deviceId, "emergency.clear", { emergencyId }, EMERGENCY_COMMAND_TTL_SECONDS);

  await recordAudit(actor, "emergency.clear", { type: "emergency", id: emergencyId }, { kind: emergency.kind, devices: showing.length });
  consoleBus.emit("emergency.changed", { emergencyId });
  return emergency;
}

/**
 * Per device: did the screen acknowledge the start, and does it report showing it right now?
 * `showing` comes from the device's own report, so it is the proof the alarm is on.
 */
export async function deliveryOfEmergency(emergencyId: string, deviceIds: string[]) {
  const commands = await CommandModel.find({ type: "emergency.set", "payload.emergencyId": emergencyId }).lean();
  const byDevice = new Map(commands.map((c) => [c.deviceId, c.status]));
  const devices = await DeviceModel.find({ deviceId: { $in: deviceIds } }, { deviceId: 1, name: 1, reported: 1 }).lean();
  return devices.map((d) => ({
    deviceId: d.deviceId,
    name: d.name || d.deviceId,
    delivery: byDevice.get(d.deviceId) ?? "pending",
    showing: (d.reported as { emergency?: string } | undefined)?.emergency === emergencyId,
  }));
}
