import { z } from "zod";
import { PROTOCOL_VERSION } from "./constants.js";
import { ULID_REGEX } from "./ulid.js";

/** Envelope shared by every message after the handshake. */
const envelope = {
  v: z.literal(PROTOCOL_VERSION),
  /** ULID. Idempotence key: a device never runs the same id twice. */
  id: z.string().regex(ULID_REGEX),
  ts: z.number().int().nonnegative(),
  /** Per-connection, per-direction counter starting at 1. Must strictly increase (anti-replay). */
  seq: z.number().int().positive(),
};

const msg = <T extends string, P extends z.ZodTypeAny>(type: T, payload: P) =>
  z.object({ ...envelope, type: z.literal(type), payload });

const record = z.record(z.string(), z.unknown());

export const ROOM_STATUSES = ["free", "occupied", "reserved", "closed"] as const;
export const ANNOUNCE_PRIORITIES = ["low", "normal", "high", "emergency"] as const;

// ---- Server -> device ------------------------------------------------------------------

/** Sent first, inside the encrypted channel, once the handshake succeeded. */
export const sessionReady = msg(
  "session.ready",
  z.object({
    /** Full desired state: the device converges on it after any outage. */
    desired: record,
    serverTime: z.number().int(),
    /** Commands about to be replayed right after this message. */
    pendingCommands: z.number().int().nonnegative(),
  }),
);

export const roomStatusSet = msg(
  "room.status.set",
  z.object({ roomId: z.string().min(1).max(64), status: z.enum(ROOM_STATUSES) }),
);

export const displayConfigSet = msg("display.config.set", z.object({ config: record }));

export const announceShow = msg(
  "announce.show",
  z.object({
    announcementId: z.string().min(1).max(64),
    title: z.string().max(200).optional(),
    text: z.string().min(1).max(2000),
    priority: z.enum(ANNOUNCE_PRIORITIES).default("normal"),
    expiresAt: z.number().int().optional(),
  }),
);

/** Audio never travels in JSON: the device downloads `assetId` over signed HTTPS and checks the hash. */
export const audioPlay = msg(
  "audio.play",
  z.object({
    assetId: z.string().min(1).max(64),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    size: z.number().int().positive(),
  }),
);

export const accessAclSync = msg(
  "access.acl.sync",
  z.object({
    rules: z
      .array(
        z.object({
          badgeUid: z.string().min(1).max(64),
          zones: z.array(z.string().max(64)).max(64),
          validFrom: z.number().int().optional(),
          validUntil: z.number().int().optional(),
        }),
      )
      .max(5000),
  }),
);

// ---- Device -> server ------------------------------------------------------------------

export const ack = msg("ack", z.object({ ref: z.string().regex(ULID_REGEX) }));

export const nack = msg(
  "nack",
  z.object({ ref: z.string().regex(ULID_REGEX), reason: z.string().max(200) }),
);

export const stateReport = msg(
  "state.report",
  z.object({ state: record, telemetry: record.optional() }),
);

export const eventBadge = msg(
  "event.badge",
  z.object({ badgeUid: z.string().min(1).max(64), at: z.number().int(), granted: z.boolean().optional() }),
);

// ---- Unions ----------------------------------------------------------------------------

export const serverMessage = z.discriminatedUnion("type", [
  sessionReady,
  roomStatusSet,
  displayConfigSet,
  announceShow,
  audioPlay,
  accessAclSync,
]);

export const deviceMessage = z.discriminatedUnion("type", [ack, nack, stateReport, eventBadge]);

export type ServerMessage = z.infer<typeof serverMessage>;
export type DeviceMessage = z.infer<typeof deviceMessage>;
export type ServerMessageType = ServerMessage["type"];
export type DeviceMessageType = DeviceMessage["type"];

/** Server messages that must be acknowledged by the device and therefore go through the outbox. */
export const COMMAND_TYPES = [
  "room.status.set",
  "display.config.set",
  "announce.show",
  "audio.play",
  "access.acl.sync",
] as const satisfies readonly ServerMessageType[];
export type CommandType = (typeof COMMAND_TYPES)[number];

export const isCommandType = (t: string): t is CommandType => (COMMAND_TYPES as readonly string[]).includes(t);

/** Payload type of a message type, e.g. `PayloadOf<"room.status.set">`. */
export type PayloadOf<T extends ServerMessageType | DeviceMessageType> = Extract<
  ServerMessage | DeviceMessage,
  { type: T }
>["payload"];
