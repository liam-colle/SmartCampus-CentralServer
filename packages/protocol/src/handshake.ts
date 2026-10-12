import { z } from "zod";
import { PROTOCOL_VERSION } from "./constants.js";
import { ULID_REGEX } from "./ulid.js";

/**
 * Handshake messages travel as plain JSON text frames. Binary fields are base64.
 * They carry no secret: everything is bound together by the two signatures (see packages/handshake).
 */
const b64 = (bytes: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9+/]+={0,2}$/)
    .refine((s) => Buffer.from(s, "base64").length === bytes, `expected ${bytes} bytes`);

/** 32-byte random nonce. */
export const nonce = b64(32);
/** Uncompressed P-256 point (0x04 || X || Y). */
export const ephemeralKey = b64(65);
/** ASN.1 DER ECDSA signature: length varies (70-72 bytes typically), so only size-bounded. */
export const signature = z
  .string()
  .regex(/^[A-Za-z0-9+/]+={0,2}$/)
  .max(200);

export const hello = z.object({
  type: z.literal("hello"),
  v: z.literal(PROTOCOL_VERSION),
  deviceId: z.string().regex(ULID_REGEX),
  nonceA: nonce,
  ephA: ephemeralKey,
});

export const challenge = z.object({
  type: z.literal("challenge"),
  nonceS: nonce,
  ephS: ephemeralKey,
  sigS: signature,
});

export const auth = z.object({
  type: z.literal("auth"),
  sigA: signature,
});

export type Hello = z.infer<typeof hello>;
export type Challenge = z.infer<typeof challenge>;
export type Auth = z.infer<typeof auth>;
