import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import { resolveSession } from "../auth/sessions.js";
import { config } from "../config.js";
import { toPublicUser, type PublicUser } from "../models/user.js";
import { registry } from "./registry.js";

const appOrigin = new URL(config.APP_URL).origin;

/** Reads one cookie from a raw Cookie header. */
function cookie(header: string | undefined, name: string): string | undefined {
  for (const part of header?.split(";") ?? []) {
    const i = part.indexOf("=");
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

/**
 * Console channel (/ws/admin): same human session cookie as the REST API, restricted to admins and
 * operators. Browsers do not enforce CORS on WebSockets, so the Origin is checked here.
 */
export async function authenticateAdmin(req: IncomingMessage): Promise<PublicUser | null> {
  const origin = req.headers.origin;
  if (origin && origin !== appOrigin) return null;
  const token = cookie(req.headers.cookie, config.SESSION_COOKIE_NAME);
  if (!token) return null;
  const user = await resolveSession(token);
  if (!user || user.role === "staff") return null;
  return toPublicUser(user);
}

/** Pushes device online/offline changes to a console. Read-only: inbound frames are ignored. */
export function handleAdminSocket(ws: WebSocket): void {
  const send = (msg: unknown) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
  const onOnline = (deviceId: string) => send({ type: "device.online", deviceId });
  const onOffline = (deviceId: string) => send({ type: "device.offline", deviceId });

  send({ type: "devices.online", deviceIds: registry.onlineIds() });
  registry.on("online", onOnline);
  registry.on("offline", onOffline);

  ws.on("error", () => {});
  ws.on("close", () => {
    registry.off("online", onOnline);
    registry.off("offline", onOffline);
  });
}
