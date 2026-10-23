import { sign, verify } from "node:crypto";
import { loadPrivateKey, loadPublicKey } from "./keys.js";

/** A signed request older (or newer) than this is refused, which bounds how long a copy can be replayed. */
export const REQUEST_MAX_SKEW_MS = 60_000;

/** Domain separation: a request signature can never be mistaken for a handshake signature. */
const CONTEXT = "smartcampus/v1/request\0";

export interface SignedRequest {
  method: string;
  /** Path only, no query string, e.g. "/api/assets/01ABC/download". */
  path: string;
  /** Milliseconds since epoch, as a decimal string (it travels in a header). */
  timestamp: string;
  /** ECDSA P-256 / SHA-256, DER, base64. */
  signature: string;
}

const message = (method: string, path: string, timestamp: string) =>
  Buffer.from(`${CONTEXT}${method.toUpperCase()}\n${path}\n${timestamp}`);

/** Device side: signs an HTTPS request with the identity key used for the handshake. */
export function signRequest(
  devicePrivateKey: string,
  method: string,
  path: string,
  now: number = Date.now(),
): SignedRequest {
  const timestamp = String(now);
  const signature = sign("sha256", message(method, path, timestamp), loadPrivateKey(devicePrivateKey)).toString("base64");
  return { method: method.toUpperCase(), path, timestamp, signature };
}

/** Server side. Returns false (never throws) for a bad signature, malformed input or a stale timestamp. */
export function verifyRequest(devicePublicKey: string, req: SignedRequest, now: number = Date.now()): boolean {
  if (!/^\d{10,16}$/.test(req.timestamp)) return false;
  if (Math.abs(now - Number(req.timestamp)) > REQUEST_MAX_SKEW_MS) return false;
  try {
    return verify(
      "sha256",
      message(req.method, req.path, req.timestamp),
      loadPublicKey(devicePublicKey),
      Buffer.from(req.signature, "base64"),
    );
  } catch {
    return false;
  }
}
