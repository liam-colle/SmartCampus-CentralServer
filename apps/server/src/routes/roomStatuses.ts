import { Router } from "express";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { pushStatusDefinition } from "../domain/roomStatus.js";
import { HttpError } from "../lib/errors.js";
import { recordAudit } from "../lib/audit.js";
import { RoomModel } from "../models/room.js";
import { RoomStatusModel, roomStatusDto, statusInput } from "../models/roomStatus.js";

/** Catalogue of room statuses: everyone signed in reads it, admins and operators edit it. */
export const roomStatusesRouter = Router();
roomStatusesRouter.use(requireAuth);

const canWrite = requireRole("admin", "operator");

roomStatusesRouter.get("/", async (_req, res) => {
  const statuses = await RoomStatusModel.find().sort({ builtIn: -1, createdAt: 1 }).lean();
  res.json({ items: statuses.map(roomStatusDto) });
});

roomStatusesRouter.post("/", canWrite, async (req, res) => {
  const input = statusInput.parse(req.body);
  const status = await RoomStatusModel.create(input);
  await recordAudit(req.user!, "room-status.create", { type: "room-status", id: status.key }, { label: status.label });
  res.status(201).json(roomStatusDto(status));
});

/** The key never changes (rooms and devices refer to it); label, colour and icon do. */
roomStatusesRouter.patch("/:key", canWrite, async (req, res) => {
  const patch = statusInput.omit({ key: true }).partial().parse(req.body);
  const status = await RoomStatusModel.findOneAndUpdate({ key: req.params.key }, patch, { new: true });
  if (!status) throw new HttpError(404, "Status not found");
  await pushStatusDefinition(status.key);
  await recordAudit(req.user!, "room-status.update", { type: "room-status", id: status.key }, patch);
  res.json(roomStatusDto(status));
});

roomStatusesRouter.delete("/:key", canWrite, async (req, res) => {
  const status = await RoomStatusModel.findOne({ key: req.params.key });
  if (!status) throw new HttpError(404, "Status not found");
  if (status.builtIn) throw new HttpError(409, "Built-in statuses cannot be deleted");
  const inUse = await RoomModel.countDocuments({ status: status.key });
  if (inUse > 0) throw new HttpError(409, `${inUse} room(s) use this status, change them first`);
  await status.deleteOne();
  await recordAudit(req.user!, "room-status.delete", { type: "room-status", id: status.key });
  res.status(204).end();
});
