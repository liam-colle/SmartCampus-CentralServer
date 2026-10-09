import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { config } from "../config.js";
import { SessionModel } from "../models/session.js";
import { UserModel, type ProviderId, type UserDoc } from "../models/user.js";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Sessions are opaque random tokens kept in an httpOnly cookie and stored hashed in MongoDB.
 * Every login method (password, Azure SSO, ...) ends here, so the rest of the app never
 * cares how a user authenticated.
 */
export async function startSession(
  req: Request,
  res: Response,
  user: UserDoc,
  provider: ProviderId,
): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 3_600_000);

  await SessionModel.create({
    tokenHash: hash(token),
    userId: user._id,
    provider,
    userAgent: req.get("user-agent")?.slice(0, 256),
    ip: req.ip,
    expiresAt,
  });

  res.cookie(config.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.COOKIE_SECURE,
    path: "/",
    expires: expiresAt,
  });
}

/** Returns the user owning the session token, or null if it is unknown, expired or disabled. */
export async function resolveSession(token: string): Promise<UserDoc | null> {
  const session = await SessionModel.findOne({
    tokenHash: hash(token),
    expiresAt: { $gt: new Date() },
  });
  if (!session) return null;

  const user = await UserModel.findById(session.userId);
  return user && !user.disabled ? user : null;
}

export async function endSession(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[config.SESSION_COOKIE_NAME];
  if (typeof token === "string") await SessionModel.deleteOne({ tokenHash: hash(token) });
  res.clearCookie(config.SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.COOKIE_SECURE,
    path: "/",
  });
}
