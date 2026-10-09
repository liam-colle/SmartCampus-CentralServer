import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { HttpError } from "../lib/errors.js";
import { toPublicUser, type PublicUser, type Role } from "../models/user.js";
import { resolveSession } from "./sessions.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: PublicUser;
    }
  }
}

/** Populates req.user from the session cookie, if there is a valid one. */
export async function attachUser(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[config.SESSION_COOKIE_NAME];
  if (typeof token === "string") {
    const user = await resolveSession(token);
    if (user) req.user = toPublicUser(user);
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw new HttpError(401, "Not authenticated");
  next();
}

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new HttpError(401, "Not authenticated");
    if (!roles.includes(req.user.role)) throw new HttpError(403, "Forbidden");
    next();
  };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const appOrigin = new URL(config.APP_URL).origin;

/**
 * CSRF defence in depth on top of SameSite=Lax: state-changing requests that carry an
 * Origin header must come from the app itself.
 */
export function sameOriginGuard(req: Request, _res: Response, next: NextFunction) {
  const origin = req.get("origin");
  if (!SAFE_METHODS.has(req.method) && origin && origin !== appOrigin) {
    throw new HttpError(403, "Cross-origin request blocked");
  }
  next();
}
