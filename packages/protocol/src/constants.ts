export const PROTOCOL_VERSION = 1;

/** Largest frame (bytes) either side accepts, before and after encryption. */
export const MAX_FRAME_BYTES = 64 * 1024;

export const PING_INTERVAL_MS = 25_000;
/** Consecutive missed pongs after which a device is considered offline. */
export const MAX_MISSED_PONGS = 2;
/** hello -> ready must complete within this time. */
export const HANDSHAKE_TIMEOUT_MS = 10_000;

/** Reconnect backoff for clients: exponential from MIN to MAX, with jitter. */
export const BACKOFF_MIN_MS = 1_000;
export const BACKOFF_MAX_MS = 60_000;

/** WebSocket close codes (application range 4000-4999). */
export const CloseCode = {
  /** Handshake failed or device unknown/revoked. Deliberately the same for all causes. */
  AuthFailed: 4401,
  /** Malformed, oversized or out-of-sequence frame. */
  ProtocolError: 4400,
  /** Handshake did not finish in time. */
  HandshakeTimeout: 4408,
  /** Another connection for the same device took over. */
  Replaced: 4409,
  /** Device was revoked while connected. */
  Revoked: 4403,
  /** Too many handshake attempts from one address. */
  RateLimited: 4429,
  /** Missed pongs. */
  PingTimeout: 4410,
} as const;
