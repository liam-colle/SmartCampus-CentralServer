import type { ZodTypeAny, z } from "zod";
import { MAX_FRAME_BYTES, PROTOCOL_VERSION } from "./constants.js";
import { deviceMessage, serverMessage, type DeviceMessage, type ServerMessage } from "./messages.js";
import { ulid } from "./ulid.js";

export type ParseResult<T> = { ok: true; message: T } | { ok: false; error: string };

function parse<S extends ZodTypeAny>(schema: S, raw: Buffer | string): ParseResult<z.infer<S>> {
  const size = typeof raw === "string" ? Buffer.byteLength(raw) : raw.length;
  if (size > MAX_FRAME_BYTES) return { ok: false, error: "frame too large" };

  let json: unknown;
  try {
    json = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
  } catch {
    return { ok: false, error: "invalid JSON" };
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    return { ok: false, error: `${issue?.path.join(".") || "message"}: ${issue?.message}` };
  }
  return { ok: true, message: result.data };
}

/** Validates a frame sent by a device (what the server receives). */
export const parseDeviceMessage = (raw: Buffer | string) => parse(deviceMessage, raw);

/** Validates a frame sent by the server (what a device receives). */
export const parseServerMessage = (raw: Buffer | string) => parse(serverMessage, raw);

type Unsealed<M> = M extends { type: infer T; payload: infer P } ? { type: T; payload: P; id?: string } : never;

/** Builds a complete envelope. `id` is generated unless given (outbox replays keep the original id). */
export function buildMessage<M extends ServerMessage | DeviceMessage>(
  msg: Unsealed<M>,
  seq: number,
  now: number = Date.now(),
): M {
  return { v: PROTOCOL_VERSION, id: msg.id ?? ulid(now), ts: now, seq, type: msg.type, payload: msg.payload } as unknown as M;
}
