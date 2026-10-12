import type { Server } from "node:http";
import type { Duplex } from "node:stream";
import { CloseCode, MAX_FRAME_BYTES } from "@smartcampus/protocol";
import { WebSocketServer } from "ws";
import { authenticateAdmin, handleAdminSocket } from "./adminSocket.js";
import { handleDeviceSocket, type DeviceSocketOptions } from "./deviceSocket.js";
import { AttemptLimiter } from "./rateLimit.js";

export interface GatewayOptions extends DeviceSocketOptions {
  /** Max new device connections per address per minute (handshake rate limit). */
  maxConnectsPerMinute?: number;
}

const reject = (socket: Duplex, status: string) => {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
};

/**
 * Routes HTTP upgrades on the main server to the two channels:
 *   /ws/device  devices (mutual handshake, then AES-256-GCM frames)
 *   /ws/admin   the React console (session cookie)
 */
export function attachGateway(server: Server, opts: GatewayOptions) {
  // Frames are small; the limit also covers the encryption overhead (counter + tag).
  const maxPayload = MAX_FRAME_BYTES + 64;
  const deviceWss = new WebSocketServer({ noServer: true, maxPayload });
  const adminWss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  const limiter = new AttemptLimiter(opts.maxConnectsPerMinute ?? 30, 60_000);

  server.on("upgrade", (req, socket, head) => {
    const ip = req.socket.remoteAddress ?? "unknown";
    const { pathname } = new URL(req.url ?? "/", "http://gateway");

    if (pathname === "/ws/device") {
      if (!limiter.allow(ip)) {
        // Complete the upgrade to be able to send a proper close code.
        deviceWss.handleUpgrade(req, socket, head, (ws) => ws.close(CloseCode.RateLimited, "rate limited"));
        return;
      }
      deviceWss.handleUpgrade(req, socket, head, (ws) => handleDeviceSocket(ws, ip, opts));
    } else if (pathname === "/ws/admin") {
      authenticateAdmin(req)
        .then((user) => {
          if (!user) return reject(socket, "401 Unauthorized");
          adminWss.handleUpgrade(req, socket, head, (ws) => handleAdminSocket(ws));
        })
        .catch(() => reject(socket, "500 Internal Server Error"));
    } else {
      reject(socket, "404 Not Found");
    }
  });

  return {
    close() {
      for (const wss of [deviceWss, adminWss]) {
        for (const client of wss.clients) client.terminate();
        wss.close();
      }
    },
  };
}
