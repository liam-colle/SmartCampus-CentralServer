import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import { resolveSession } from "../auth/sessions.js";
import { config } from "../config.js";
import { toPublicUser, type PublicUser } from "../models/user.js";
import { consoleBus, type ConsoleEvents } from "./consoleBus.js";
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

  const onRequested = (request: ConsoleEvents["enrollment.requested"][0]) => send({ type: "enrollment.requested", request });
  const onResolved = (event: ConsoleEvents["enrollment.resolved"][0]) => send({ type: "enrollment.resolved", ...event });

  const onReported = (event: ConsoleEvents["device.reported"][0]) => send({ type: "device.reported", ...event });
  const onRoomStatus = (event: ConsoleEvents["room.status.changed"][0]) => send({ type: "room.status.changed", ...event });
  const onEmergency = (event: ConsoleEvents["emergency.changed"][0]) => send({ type: "emergency.changed", ...event });

  send({ type: "devices.online", deviceIds: registry.onlineIds() });
  registry.on("online", onOnline);
  registry.on("offline", onOffline);
  consoleBus.on("enrollment.requested", onRequested);
  consoleBus.on("enrollment.resolved", onResolved);
  consoleBus.on("device.reported", onReported);
  consoleBus.on("room.status.changed", onRoomStatus);
  consoleBus.on("emergency.changed", onEmergency);

  ws.on("error", () => {});
  ws.on("close", () => {
    registry.off("online", onOnline);
    registry.off("offline", onOffline);
    consoleBus.off("enrollment.requested", onRequested);
    consoleBus.off("enrollment.resolved", onResolved);
    consoleBus.off("device.reported", onReported);
    consoleBus.off("room.status.changed", onRoomStatus);
    consoleBus.off("emergency.changed", onEmergency);
  });
}
