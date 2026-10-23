import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { audioSettingsSet } from "@smartcampus/protocol";
import { z } from "zod";
import { requireRole } from "../auth/middleware.js";
import { config } from "../config.js";
import { enqueueCommand, recentCommands } from "../domain/commands.js";
import { pushRoomToDevice } from "../domain/roomStatus.js";
import { recordAudit } from "../lib/audit.js";
import {
  approveRequest,
  denyRequest,
  enrollmentStatus,
  listPendingRequests,
  requestEnrollment,
  revokeDevice,
} from "../domain/devices.js";
import { registry } from "../gateway/registry.js";
import { HttpError } from "../lib/errors.js";
import { objectId } from "../lib/http.js";
import { DEVICE_TYPES, DeviceModel, deviceDto, requestDto } from "../models/device.js";
import { RoomModel } from "../models/room.js";

/**
 * Public: used by a device that has no identity yet. It asks to be enrolled and polls the outcome;
 * an admin or operator approves or denies the request in the console.
 */
export const enrollRouter = Router();

const enrollLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: config.ENROLL_RATE_LIMIT,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many enrollment attempts, try again later" },
});
enrollRouter.use(enrollLimiter);

enrollRouter.post("/", async (req, res) => {
  const input = z
    .object({
      publicKey: z.string().min(80).max(400),
      type: z.enum(DEVICE_TYPES),
      name: z.string().trim().max(100).optional(),
    })
    .parse(req.body);
  const request = await requestEnrollment({ ...input, ip: req.ip?.replace(/^::ffff:/, ""), userAgent: req.get("user-agent") });
  res.status(201).json(request);
});

enrollRouter.get("/:deviceId", async (req, res) => {
  res.json({ status: await enrollmentStatus(String(req.params.deviceId)) });
});

/** Console: manage devices. Admins and operators. */
export const devicesRouter = Router();
devicesRouter.use(requireRole("admin", "operator"));

const loadDevice = async (id: unknown) => {
  const device = await DeviceModel.findOne({ deviceId: String(id) });
  if (!device) throw new HttpError(404, "Device not found");
  return device;
};

devicesRouter.get("/", async (_req, res) => {
  const devices = await DeviceModel.find({ status: { $in: ["active", "revoked"] } }).sort({ createdAt: -1 });
  res.json({ items: devices.map((d) => deviceDto(d, registry.isOnline(d.deviceId))) });
});

/** Connection requests waiting for a decision. Declared before "/:id" so "requests" is not read as an id. */
devicesRouter.get("/requests", async (_req, res) => {
  res.json({ items: (await listPendingRequests()).map(requestDto) });
});

devicesRouter.post("/requests/:deviceId/approve", async (req, res) => {
  const input = z
    .object({
      name: z.string().trim().min(1).max(100),
      room: z.string().nullable(),
      groups: z.array(z.string().trim().min(1).max(50)).max(20),
    })
    .partial()
    .parse(req.body ?? {});
  if (input.room) {
    if (!(await RoomModel.exists({ _id: objectId(input.room) }))) throw new HttpError(400, "Unknown room");
  }
  const device = await approveRequest(String(req.params.deviceId), { ...input, room: input.room ?? undefined });
  if (device.room) await pushRoomToDevice(device.deviceId, String(device.room));
  await recordAudit(req.user!, "device.approve", { type: "device", id: device.deviceId }, { name: device.name });
  res.json(deviceDto(device, false));
});

devicesRouter.post("/requests/:deviceId/deny", async (req, res) => {
  await denyRequest(String(req.params.deviceId));
  await recordAudit(req.user!, "device.deny", { type: "device", id: String(req.params.deviceId) });
  res.status(204).end();
});

devicesRouter.get("/:id", async (req, res) => {
  const device = await loadDevice(req.params.id);
  res.json(deviceDto(device, registry.isOnline(device.deviceId)));
});

devicesRouter.patch("/:id", async (req, res) => {
  const patch = z
    .object({
      name: z.string().trim().min(1).max(100),
      room: z.string().nullable(),
      groups: z.array(z.string().trim().min(1).max(50)).max(20),
    })
    .partial()
    .parse(req.body);
  const device = await loadDevice(req.params.id);
  const previousRoom = device.room ? String(device.room) : null;
  if (patch.room) {
    if (!(await RoomModel.exists({ _id: objectId(patch.room) }))) throw new HttpError(400, "Unknown room");
  }
  if (patch.name !== undefined) device.name = patch.name;
  if (patch.groups !== undefined) device.groups = patch.groups;
  if (patch.room !== undefined) device.room = (patch.room ?? undefined) as never;
  await device.save();
  // Why: a screen moved to another room must show that room at once (the outbox covers offline screens).
  // Limitation: unlinking a screen from every room does not blank it until a command replaces its state.
  if (device.status === "active" && device.room && String(device.room) !== previousRoom) {
    await pushRoomToDevice(device.deviceId, String(device.room));
  }
  res.json(deviceDto(device, registry.isOnline(device.deviceId)));
});

devicesRouter.post("/:id/revoke", async (req, res) => {
  const device = await revokeDevice(String(req.params.id));
  await recordAudit(req.user!, "device.revoke", { type: "device", id: device.deviceId }, { name: device.name });
  res.json(deviceDto(device, false));
});

/** Volume and quiet hours of one device. Enforced by the device, kept in its desired state. */
devicesRouter.put("/:id/audio-settings", async (req, res) => {
  const settings = audioSettingsSet.shape.payload.parse(req.body);
  const device = await loadDevice(req.params.id);
  await enqueueCommand(device.deviceId, "audio.settings.set", settings);
  await recordAudit(req.user!, "device.audio-settings", { type: "device", id: device.deviceId }, settings);
  res.json(settings);
});

devicesRouter.get("/:id/commands", async (req, res) => {
  const device = await loadDevice(req.params.id);
  const items = await recentCommands(device.deviceId);
  res.json({
    items: items.map((c) => ({
      id: c.commandId,
      type: c.type,
      payload: c.payload,
      status: c.status,
      attempts: c.attempts,
      nackReason: c.nackReason ?? null,
      createdAt: c.createdAt,
      ackedAt: c.ackedAt ?? null,
    })),
  });
});

/** Queues a command for the device (delivered now if online, on reconnection otherwise). */
devicesRouter.post("/:id/commands", async (req, res) => {
  const { type, payload, ttlSeconds } = z
    .object({
      type: z.string().min(1).max(40),
      payload: z.unknown(),
      ttlSeconds: z.number().int().min(10).max(7 * 86_400).optional(),
    })
    .parse(req.body);
  const device = await loadDevice(req.params.id);
  const command = await enqueueCommand(device.deviceId, type, payload, ttlSeconds);
  res.status(202).json({ id: command.commandId, status: command.status, delivered: registry.isOnline(device.deviceId) });
});
