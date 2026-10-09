import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { resolveExternalUser } from "../auth/identity.js";
import { requireAuth } from "../auth/middleware.js";
import { azureProvider } from "../auth/providers/azure.js";
import { verifyCredentials } from "../auth/providers/local.js";
import { completeReset, requestReset } from "../auth/passwordReset.js";
import { endSession, sessionPolicy, startSession } from "../auth/sessions.js";
import { config } from "../config.js";
import { HttpError } from "../lib/errors.js";
import { passwordSchema } from "../lib/http.js";
import { toPublicUser } from "../models/user.js";

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many login attempts, try again later" },
});

const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(256),
});

/** Which login methods the frontend should offer. */
authRouter.get("/providers", (_req, res) => {
  res.json({ local: true, azure: azureProvider.enabled });
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user, session: sessionPolicy });
});

authRouter.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = credentials.parse(req.body);
  const user = await verifyCredentials(email, password);
  if (!user) throw new HttpError(401, "Invalid email or password");

  await startSession(req, res, user, "local");
  res.json({ user: toPublicUser(user), session: sessionPolicy });
});

const resetLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests, try again later" },
});

/** Always answers 204, whether or not the email exists. The mail is sent in the background. */
authRouter.post("/forgot-password", resetLimiter, (req, res) => {
  const { email } = z.object({ email: z.string().email() }).parse(req.body);
  requestReset(email).catch((err) => console.error("Password reset failed", err));
  res.status(204).end();
});

authRouter.post("/reset-password", resetLimiter, async (req, res) => {
  const { token, password } = z
    .object({ token: z.string().min(10).max(200), password: passwordSchema })
    .parse(req.body);
  await completeReset(token, password);
  res.status(204).end();
});

authRouter.post("/logout", async (req, res) => {
  await endSession(req, res);
  res.status(204).end();
});

// --- Microsoft Azure SSO (scaffold, see auth/providers/azure.ts) -------------------------

authRouter.get("/azure/login", async (req, res) => {
  res.redirect(await azureProvider.getAuthorizationUrl(req, res));
});

authRouter.get("/azure/callback", async (req, res) => {
  const profile = await azureProvider.handleCallback(req, res);
  const user = await resolveExternalUser(profile, { autoProvision: config.AZURE_AUTO_PROVISION });
  await startSession(req, res, user, "azure");
  res.redirect(config.APP_URL);
});
