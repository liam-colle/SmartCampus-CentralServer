import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32
export const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** 26-char ULID: 48-bit millisecond timestamp + 80 random bits. Sortable and collision-safe. */
export function ulid(now: number = Date.now()): string {
  let time = "";
  for (let i = 0, t = now; i < 10; i++, t = Math.floor(t / 32)) time = ALPHABET[t % 32]! + time;

  const rand = randomBytes(10);
  let bits = 0n;
  for (const b of rand) bits = (bits << 8n) | BigInt(b);
  let tail = "";
  for (let i = 0; i < 16; i++, bits >>= 5n) tail = ALPHABET[Number(bits & 31n)]! + tail;

  return time + tail;
}

export const isUlid = (s: unknown): s is string => typeof s === "string" && ULID_REGEX.test(s);
