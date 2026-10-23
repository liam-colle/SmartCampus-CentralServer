import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../auth/middleware.js";
import { describeSession, startRegistration, stopRegistration } from "../domain/registration.js";
import { HttpError } from "../lib/errors.js";
import { RegistrationSessionModel } from "../models/registrationSession.js";

/**
 * Identity registration mode: pick a reader, it collects every card presented until the session is
 * stopped (or expires), then the console turns the cards into students. Admins and operators only.
 */
export const cardRegistrationRouter = Router();
cardRegistrationRouter.use(requireRole("admin", "operator"));

const startInput = z.object({ deviceId: z.string().min(1).max(40) });

cardRegistrationRouter.post("/", async (req, res) => {
  const { deviceId } = startInput.parse(req.body);
  res.status(201).json(await describeSession(await startRegistration(deviceId, req.user!)));
});

cardRegistrationRouter.get("/:id", async (req, res) => {
  const session = await RegistrationSessionModel.findOne({ sessionId: String(req.params.id) });
  if (!session) throw new HttpError(404, "Registration session not found");
  res.json(await describeSession(session));
});

cardRegistrationRouter.delete("/:id", async (req, res) => {
  res.json(await describeSession(await stopRegistration(String(req.params.id), req.user!)));
});
