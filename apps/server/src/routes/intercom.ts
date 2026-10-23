import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../auth/middleware.js";
import { broadcastAudio } from "../domain/intercom.js";
import { targetsInput } from "../domain/targeting.js";

/** InterCom: play a stored sound on chosen devices. Admins and operators only. */
export const intercomRouter = Router();
intercomRouter.use(requireRole("admin", "operator"));

intercomRouter.post("/broadcasts", async (req, res) => {
  const input = z
    .object({ assetId: z.string().min(1).max(40), title: z.string().trim().max(200).optional(), targets: targetsInput })
    .parse(req.body);
  const broadcast = await broadcastAudio(input, req.user!);
  res.status(201).json({ id: broadcast.announcementId, deviceCount: broadcast.deviceIds.length });
});
