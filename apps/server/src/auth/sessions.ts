import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { config } from "../config.js";
import { SessionModel } from "../models/session.js";
import { UserModel, type ProviderId, type UserDoc } from "../models/user.js";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

const IDLE_MS = config.SESSION_IDLE_MINUTES * 60_000;
// Don't write to the database on every request, only when the expiry has drifted this much.
const TOUCH_AFTER_MS = 60_000;

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: config.COOKIE_SECURE,
  path: "/",
} as const;

/** Sent to the client so it can run its own inactivity timer. */
export const sessionPolicy = { idleTimeoutSeconds: Math.round(IDLE_MS / 1000) };

/**
 * Sessions are opaque random tokens kept in an httpOnly cookie and stored hashed in MongoDB.
 * Every login method (password, Azure SSO, ...) ends here, so the rest of the app never
 * cares how a user authenticated.
 *
 * A session ends after SESSION_IDLE_MINUTES without activity, or SESSION_TTL_HOURS after login.
 */
export async function startSession(
  req: Request,
  res: Response,
  user: UserDoc,
  provider: ProviderId,
): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const absoluteExpiresAt = new Date(now + config.SESSION_TTL_HOURS * 3_600_000);

  await SessionModel.create({
    tokenHash: hash(token),
    userId: user._id,
    provider,
    userAgent: req.get("user-agent")?.slice(0, 256),
    ip: req.ip,
    expiresAt: new Date(Math.min(now + IDLE_MS, absoluteExpiresAt.getTime())),
    absoluteExpiresAt,
  });

  res.cookie(config.SESSION_COOKIE_NAME, token, { ...cookieOptions, expires: absoluteExpiresAt });
}

/** Returns the user owning the session token, or null if it is unknown, expired or disabled. */
export async function resolveSession(token: string): Promise<UserDoc | null> {
  const now = Date.now();
  const session = await SessionModel.findOne({
    tokenHash: hash(token),
    expiresAt: { $gt: new Date(now) },
    absoluteExpiresAt: { $gt: new Date(now) },
  });
  if (!session) return null;

  const user = await UserModel.findById(session.userId);
  if (!user || user.disabled) return null;

  const slid = Math.min(now + IDLE_MS, session.absoluteExpiresAt.getTime());
  if (slid - session.expiresAt.getTime() > TOUCH_AFTER_MS) {
    await SessionModel.updateOne({ _id: session._id }, { expiresAt: new Date(slid) });
  }
  return user;
}

export async function endSession(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[config.SESSION_COOKIE_NAME];
  if (typeof token === "string") await SessionModel.deleteOne({ tokenHash: hash(token) });
  res.clearCookie(config.SESSION_COOKIE_NAME, cookieOptions);
}

/** Logs a user out everywhere (password change/reset, account disabled). */
export async function revokeUserSessions(userId: unknown): Promise<void> {
  await SessionModel.deleteMany({ userId });
}
