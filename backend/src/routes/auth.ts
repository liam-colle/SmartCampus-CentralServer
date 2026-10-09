import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { resolveExternalUser } from "../auth/identity.js";
import { requireAuth } from "../auth/middleware.js";
import { azureProvider } from "../auth/providers/azure.js";
import { verifyCredentials } from "../auth/providers/local.js";
import { endSession, startSession } from "../auth/sessions.js";
import { config } from "../config.js";
import { HttpError } from "../lib/errors.js";
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
  res.json({ user: req.user });
});

authRouter.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = credentials.parse(req.body);
  const user = await verifyCredentials(email, password);
  if (!user) throw new HttpError(401, "Invalid email or password");

  await startSession(req, res, user, "local");
  res.json({ user: toPublicUser(user) });
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
