import { EMERGENCY_CATALOGUE, EMERGENCY_KINDS } from "@smartcampus/protocol";
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { clearEmergency, deliveryOfEmergency, triggerEmergency } from "../domain/emergencies.js";
import { targetsInput } from "../domain/targeting.js";
import { HttpError } from "../lib/errors.js";
import { pagination } from "../lib/http.js";
import { EmergencyModel } from "../models/emergency.js";

/** Emergency alerts. Everyone signed in reads, admins and operators trigger and clear. */
export const emergenciesRouter = Router();
emergenciesRouter.use(requireAuth);

const canWrite = requireRole("admin", "operator");

const emergencyInput = z.object({
  kind: z.enum(EMERGENCY_KINDS),
  // Why default to everyone: in a real emergency nobody should have to pick the screens first.
  targets: targetsInput.default({ all: true }),
  testMode: z.boolean().default(false),
  testVolume: z.number().int().min(0).max(100).default(20),
  instructions: z.string().trim().min(1).max(400).optional(),
});

const dto = (e: InstanceType<typeof EmergencyModel>) => ({
  id: e.emergencyId,
  kind: e.kind,
  title: e.title,
  instructions: e.instructions,
  testMode: e.testMode,
  testVolume: e.testVolume,
  targets: e.targets,
  deviceCount: e.deviceIds.length,
  status: e.status,
  startedBy: e.startedByName,
  startedAt: e.createdAt,
  clearedBy: e.clearedByName ?? null,
  clearedAt: e.clearedAt ?? null,
});

/** Default wording and colour of each kind, so the console never keeps a copy that could drift. */
emergenciesRouter.get("/catalogue", (_req, res) => {
  res.json({ items: EMERGENCY_KINDS.map((kind) => ({ kind, ...EMERGENCY_CATALOGUE[kind] })) });
});

emergenciesRouter.get("/", async (req, res) => {
  const { page, limit, status } = pagination.extend({ status: z.enum(["active", "cleared"]).optional() }).parse(req.query);
  const filter = status ? { status } : {};
  const [items, total] = await Promise.all([
    EmergencyModel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    EmergencyModel.countDocuments(filter),
  ]);
  res.json({ items: items.map(dto), total, page, limit });
});

emergenciesRouter.get("/:id", async (req, res) => {
  const e = await EmergencyModel.findOne({ emergencyId: String(req.params.id) });
  if (!e) throw new HttpError(404, "Emergency not found");
  res.json({ ...dto(e), delivery: await deliveryOfEmergency(e.emergencyId, e.deviceIds) });
});

emergenciesRouter.post("/", canWrite, async (req, res) => {
  const emergency = await triggerEmergency(emergencyInput.parse(req.body), req.user!);
  res.status(201).json(dto(emergency));
});

/** Ending an alert keeps its record and takes the alarm off every screen still showing it. */
emergenciesRouter.delete("/:id", canWrite, async (req, res) => {
  await clearEmergency(String(req.params.id), req.user!);
  res.status(204).end();
});
