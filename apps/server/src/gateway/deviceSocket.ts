import { ChannelError, HandshakeError, ServerHandshake } from "@smartcampus/handshake";
import {
  CloseCode,
  HANDSHAKE_TIMEOUT_MS,
  MAX_MISSED_PONGS,
  PING_INTERVAL_MS,
  handshakeMessages,
  parseDeviceMessage,
  type DeviceMessage,
} from "@smartcampus/protocol";
import type { RawData, WebSocket } from "ws";
import { markAcked, markNacked, pendingCommands } from "../domain/commands.js";
import { activePublicKey, desiredState, recordReport, touchLastSeen } from "../domain/devices.js";
import { DeviceConnection } from "./deviceConnection.js";
import { registry } from "./registry.js";

export interface DeviceSocketOptions {
  serverPrivateKey: string;
  pingIntervalMs?: number;
  handshakeTimeoutMs?: number;
}

const log = (level: "info" | "warn", msg: string, extra: Record<string, unknown> = {}) =>
  console[level === "warn" ? "warn" : "log"](JSON.stringify({ level, msg, ...extra }));

const toBuffer = (data: RawData): Buffer =>
  Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);

/**
 * One device socket, from upgrade to close:
 *   hello -> challenge -> auth -> (encrypted) session.ready + pending commands -> live loop.
 * Frames are processed strictly one at a time; anything unexpected closes the socket.
 */
export function handleDeviceSocket(ws: WebSocket, ip: string, opts: DeviceSocketOptions): void {
  const hs = new ServerHandshake(opts.serverPrivateKey);
  let stage: "hello" | "auth" | "live" = "hello";
  let conn: DeviceConnection | null = null;
  let pingTimer: NodeJS.Timeout | undefined;

  const handshakeTimer = setTimeout(
    () => ws.close(CloseCode.HandshakeTimeout, "handshake timeout"),
    opts.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS,
  );

  const fail = (code: number, reason: string, detail?: string) => {
    log("warn", "device socket closed", { ip, deviceId: hs.deviceId, reason, detail });
    ws.close(code, reason);
  };

  async function onFrame(data: RawData, isBinary: boolean) {
    // ---- 1. hello (plain JSON) ----
    if (stage === "hello") {
      if (isBinary) return fail(CloseCode.ProtocolError, "protocol error");
      const parsed = handshakeMessages.hello.safeParse(safeJson(toBuffer(data)));
      if (!parsed.success) return fail(CloseCode.ProtocolError, "protocol error");
      ws.send(JSON.stringify(hs.onHello(parsed.data)));
      stage = "auth";
      return;
    }

    // ---- 2. auth (plain JSON), then the encrypted channel opens ----
    if (stage === "auth") {
      if (isBinary) return fail(CloseCode.ProtocolError, "protocol error");
      const parsed = handshakeMessages.auth.safeParse(safeJson(toBuffer(data)));
      if (!parsed.success) return fail(CloseCode.ProtocolError, "protocol error");

      const publicKey = await activePublicKey(hs.deviceId!);
      let channel;
      try {
        channel = hs.onAuth(parsed.data, publicKey);
      } catch (err) {
        // Same answer whether the device is unknown, revoked, or its signature is wrong.
        return fail(CloseCode.AuthFailed, "authentication failed", err instanceof HandshakeError ? err.message : String(err));
      }

      clearTimeout(handshakeTimer);
      const connection = new DeviceConnection(hs.deviceId!, ws, channel);
      conn = connection;
      stage = "live";
      registry.register(connection)?.close(CloseCode.Replaced, "replaced by a new connection");

      // Full desired state first, then the commands the device has not acknowledged.
      const pending = await pendingCommands(connection.deviceId);
      connection.send("session.ready", {
        desired: await desiredState(connection.deviceId),
        serverTime: Date.now(),
        pendingCommands: pending.length,
      });
      connection.markReady();
      await connection.flush();
      await touchLastSeen(connection.deviceId);
      log("info", "device online", { ip, deviceId: connection.deviceId, replayed: pending.length });

      pingTimer = setInterval(() => {
        if (connection.missedPongs >= MAX_MISSED_PONGS) {
          log("warn", "device missed pongs", { deviceId: connection.deviceId });
          ws.close(CloseCode.PingTimeout, "ping timeout");
          connection.terminate(); // the peer is not answering, do not wait for the close handshake
          return;
        }
        connection.missedPongs++;
        ws.ping();
      }, opts.pingIntervalMs ?? PING_INTERVAL_MS);
      return;
    }

    // ---- 3. live: every frame is an encrypted binary envelope ----
    const connection = conn!;
    if (!isBinary) return fail(CloseCode.ProtocolError, "protocol error");

    let plain: Buffer;
    try {
      plain = connection.decryptFrame(toBuffer(data));
    } catch (err) {
      return fail(CloseCode.ProtocolError, "protocol error", err instanceof ChannelError ? err.message : String(err));
    }
    const parsed = parseDeviceMessage(plain);
    if (!parsed.ok) return fail(CloseCode.ProtocolError, "protocol error", parsed.error);
    if (parsed.message.seq !== connection.recvSeq + 1) return fail(CloseCode.ProtocolError, "protocol error", "bad seq");
    connection.recvSeq = parsed.message.seq;

    await dispatch(connection, parsed.message);
  }

  async function dispatch(connection: DeviceConnection, msg: DeviceMessage) {
    switch (msg.type) {
      case "ack":
        await markAcked(connection.deviceId, msg.payload.ref);
        break;
      case "nack":
        await markNacked(connection.deviceId, msg.payload.ref, msg.payload.reason);
        log("warn", "command rejected by device", { deviceId: connection.deviceId, ref: msg.payload.ref, reason: msg.payload.reason });
        break;
      case "state.report":
        await recordReport(connection.deviceId, msg.payload.state, msg.payload.telemetry);
        break;
      case "event.badge":
        // Access decisions arrive with the access unit (M4); for now the event is only logged.
        log("info", "badge event", { deviceId: connection.deviceId, at: msg.payload.at, granted: msg.payload.granted });
        break;
    }
  }

  let queue: Promise<void> = Promise.resolve();
  ws.on("message", (data, isBinary) => {
    queue = queue.then(() => onFrame(data, isBinary)).catch((err) => {
      log("warn", "device frame error", { deviceId: hs.deviceId, err: err instanceof Error ? err.message : String(err) });
      ws.close(CloseCode.ProtocolError, "protocol error");
    });
  });
  ws.on("pong", () => {
    if (conn) conn.missedPongs = 0;
  });
  ws.on("error", () => {});
  ws.on("close", () => {
    clearTimeout(handshakeTimer);
    clearInterval(pingTimer);
    if (conn) {
      registry.unregister(conn);
      void touchLastSeen(conn.deviceId).catch(() => {});
    }
  });
}

function safeJson(buf: Buffer): unknown {
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    return undefined;
  }
}
