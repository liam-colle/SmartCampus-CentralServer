import { ANNOUNCE_PRIORITIES } from "@smartcampus/protocol";
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { cancelAnnouncement, createAnnouncement, deliveryOf } from "../domain/announcements.js";
import { targetsInput } from "../domain/targeting.js";
import { HttpError } from "../lib/errors.js";
import { pagination } from "../lib/http.js";
import { AnnouncementModel, announcementState } from "../models/announcement.js";

/** Visual announcements on door and faculty screens. Everyone signed in reads, admins and operators write. */
export const announcementsRouter = Router();
announcementsRouter.use(requireAuth);

const canWrite = requireRole("admin", "operator");

const announcementInput = z.object({
  title: z.string().trim().max(200).optional(),
  text: z.string().trim().min(1).max(2000),
  priority: z.enum(ANNOUNCE_PRIORITIES).default("info"),
  targets: targetsInput,
  expiresAt: z.coerce.date().optional(),
});

const dto = (a: InstanceType<typeof AnnouncementModel>) => ({
  id: a.announcementId,
  kind: a.kind,
  assetId: a.assetId ?? null,
  title: a.title,
  text: a.text,
  priority: a.priority,
  targets: a.targets,
  deviceCount: a.deviceIds.length,
  expiresAt: a.expiresAt ?? null,
  state: announcementState(a),
  createdBy: a.createdByName,
  createdAt: a.createdAt,
});

announcementsRouter.get("/", async (req, res) => {
  const { page, limit, kind } = pagination.extend({ kind: z.enum(["text", "audio"]).optional() }).parse(req.query);
  const filter = kind ? { kind } : {};
  const [items, total] = await Promise.all([
    AnnouncementModel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    AnnouncementModel.countDocuments(filter),
  ]);
  res.json({ items: items.map(dto), total, page, limit });
});

announcementsRouter.get("/:id", async (req, res) => {
  const a = await AnnouncementModel.findOne({ announcementId: String(req.params.id) });
  if (!a) throw new HttpError(404, "Announcement not found");
  res.json({ ...dto(a), delivery: await deliveryOf(a.announcementId, a.deviceIds, a.kind === "audio" ? "audio.play" : "announce.show") });
});

announcementsRouter.post("/", canWrite, async (req, res) => {
  const announcement = await createAnnouncement(announcementInput.parse(req.body), req.user!);
  res.status(201).json(dto(announcement));
});

/** Cancelling keeps the record (state "cancelled") and removes it from every screen. */
announcementsRouter.delete("/:id", canWrite, async (req, res) => {
  await cancelAnnouncement(String(req.params.id), req.user!);
  res.status(204).end();
});
