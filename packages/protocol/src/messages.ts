import { z } from "zod";
import { PROTOCOL_VERSION } from "./constants.js";
import { EMERGENCY_KINDS } from "./emergency.js";
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

export const ANNOUNCE_PRIORITIES = ["info", "important", "urgent"] as const;

/** Icons a status may use. Devices map each name to a drawable they ship with. */
export const STATUS_ICONS = [
  "check",
  "user",
  "lock",
  "wrench",
  "calendar",
  "clock",
  "alert",
  "info",
  "book",
  "coffee",
  "ban",
  "wifi-off",
] as const;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "expected a colour like #00a86b");
const hourMinute = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM");

/** Machine key of a status, e.g. "free" or "exam-in-progress". */
export const statusKey = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/);

/**
 * A status travels with its label, colour and icon, so a door unit never needs the catalogue and
 * keeps showing the right thing for a status created after it was installed.
 */
export const roomStatusValue = z.object({
  roomId: z.string().min(1).max(64),
  status: statusKey,
  label: z.string().trim().min(1).max(40),
  color: hexColor,
  icon: z.enum(STATUS_ICONS),
  /** When the status was set (ms since epoch). */
  since: z.number().int().nonnegative().optional(),
});

export const DISPLAY_LAYOUTS = ["standard", "compact", "split"] as const;
export const DISPLAY_THEMES = ["dark", "light"] as const;

/** Night sleep and quiet hours share this shape. `from` > `to` means the window crosses midnight. */
export const timeWindow = z.object({
  enabled: z.boolean().default(false),
  from: hourMinute.default("22:00"),
  to: hourMinute.default("06:00"),
});

/** What a door screen shows and how. Every field has a default so a partial config is valid. */
export const displayConfig = z.object({
  layout: z.enum(DISPLAY_LAYOUTS).default("standard"),
  theme: z.enum(DISPLAY_THEMES).default("dark"),
  accentColor: hexColor.default("#00a86b"),
  show: z
    .object({
      roomName: z.boolean().default(true),
      building: z.boolean().default(true),
      floor: z.boolean().default(true),
      capacity: z.boolean().default(true),
      clock: z.boolean().default(true),
      announcements: z.boolean().default(true),
    })
    .default({}),
  sleep: timeWindow.default({}),
});
export type DisplayConfig = z.infer<typeof displayConfig>;

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

export const roomStatusSet = msg("room.status.set", roomStatusValue);

/** Static facts about the room a door screen is linked to. */
export const roomInfoSet = msg(
  "room.info.set",
  z.object({
    roomId: z.string().min(1).max(64),
    code: z.string().min(1).max(30),
    name: z.string().max(100),
    building: z.string().max(100),
    floor: z.number().int(),
    capacity: z.number().int().nonnegative().nullable(),
  }),
);

export const displayConfigSet = msg("display.config.set", z.object({ config: displayConfig }));

/** Per-device speaker settings. Audio that arrives inside quiet hours is acknowledged but not played. */
export const audioSettingsSet = msg(
  "audio.settings.set",
  z.object({ volume: z.number().int().min(0).max(100), quietHours: timeWindow }),
);

export const announceShow = msg(
  "announce.show",
  z.object({
    announcementId: z.string().min(1).max(64),
    title: z.string().max(200).optional(),
    text: z.string().min(1).max(2000),
    priority: z.enum(ANNOUNCE_PRIORITIES).default("info"),
    /** Absolute time (ms since epoch). The device hides the announcement by itself, even offline. */
    expiresAt: z.number().int().optional(),
  }),
);

export const announceClear = msg("announce.clear", z.object({ announcementId: z.string().min(1).max(64) }));

/** Audio never travels in JSON: the device downloads `assetId` over signed HTTPS and checks the hash. */
export const audioPlay = msg(
  "audio.play",
  z.object({
    announcementId: z.string().min(1).max(64),
    title: z.string().max(200).optional(),
    assetId: z.string().min(1).max(64),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    size: z.number().int().positive(),
  }),
);

/**
 * An emergency takes over the whole screen and sounds an alarm. It carries its own title and
 * instructions, so a door unit shows the right thing even when it was installed before the wording
 * changed, and keeps showing it through an outage until `emergency.clear`.
 */
export const emergencySet = msg(
  "emergency.set",
  z.object({
    emergencyId: z.string().min(1).max(64),
    kind: z.enum(EMERGENCY_KINDS),
    title: z.string().trim().min(1).max(60),
    instructions: z.string().trim().min(1).max(400),
    /** Test mode: the screen says so and the alarm plays at `testVolume`, and respects quiet hours. */
    testMode: z.boolean().default(false),
    testVolume: z.number().int().min(0).max(100).default(20),
    startedAt: z.number().int().nonnegative(),
  }),
);

export const emergencyClear = msg("emergency.clear", z.object({ emergencyId: z.string().min(1).max(64) }));

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

/** What the server decided about a card that was presented to a reader. */
export const CARD_OUTCOMES = [
  "maintenance",
  "recognised",
  "unknown",
  "disabled",
  "captured",
  "duplicate",
  "already_registered",
  "rate_limited",
] as const;
export type CardOutcome = (typeof CARD_OUTCOMES)[number];

/** What a maintenance menu may do. `status.set` changes the status of the room the terminal is linked to. */
export const MAINTENANCE_ACTIONS = ["status.set", "restart", "revoke"] as const;
export type MaintenanceAction = (typeof MAINTENANCE_ACTIONS)[number];

/** Offered with an accepted card so the menu needs no catalogue of its own. */
export const maintenanceMenu = z.object({
  statuses: z
    .array(z.object({ key: statusKey, label: z.string().max(40), color: hexColor, icon: z.enum(STATUS_ICONS) }))
    .max(50),
  /** Only administrators may take the terminal out of service. */
  canRevoke: z.boolean(),
});

/**
 * Answer to an `event.badge`, never queued: a card result that arrives late would open a maintenance
 * menu for someone who has already walked away. The device opens the menu only when `maintenance` is true.
 */
export const cardResult = msg(
  "card.result",
  z.object({
    /** Id of the `event.badge` this answers. */
    ref: z.string().regex(ULID_REGEX),
    outcome: z.enum(CARD_OUTCOMES),
    maintenance: z.boolean(),
    /** Present when the card belongs to someone, so the reader can greet them. */
    name: z.string().max(100).optional(),
    /** Present when `maintenance` is true. */
    menu: maintenanceMenu.optional(),
  }),
);

/** Answer to a `maintenance.action`. Like `card.result` it is never queued. */
export const maintenanceResult = msg(
  "maintenance.result",
  z.object({ ref: z.string().regex(ULID_REGEX), action: z.enum(MAINTENANCE_ACTIONS), ok: z.boolean(), error: z.string().max(200).optional() }),
);

/**
 * While active, cards presented to this reader are collected for enrolment instead of being treated
 * as logins. The device leaves the mode by itself at `expiresAt`, even when it is offline.
 */
export const registrationModeSet = msg(
  "registration.mode.set",
  z.object({
    sessionId: z.string().min(1).max(64),
    active: z.boolean(),
    expiresAt: z.number().int().optional(),
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

/** `badgeUid` is the card's serial number as read. The server normalises it, so any hex notation is fine. */
export const eventBadge = msg(
  "event.badge",
  z.object({ badgeUid: z.string().min(1).max(64), at: z.number().int(), granted: z.boolean().optional() }),
);

/**
 * An action chosen in the maintenance menu. The server accepts it only inside the grant it opened
 * with the card (same device, still valid, person still allowed), so a device cannot invent one.
 */
export const maintenanceAction = msg(
  "maintenance.action",
  z.object({ action: z.enum(MAINTENANCE_ACTIONS), status: statusKey.optional() }),
);

// ---- Unions ----------------------------------------------------------------------------

export const serverMessage = z.discriminatedUnion("type", [
  sessionReady,
  roomStatusSet,
  roomInfoSet,
  displayConfigSet,
  audioSettingsSet,
  announceShow,
  announceClear,
  audioPlay,
  emergencySet,
  emergencyClear,
  accessAclSync,
  cardResult,
  maintenanceResult,
  registrationModeSet,
]);

export const deviceMessage = z.discriminatedUnion("type", [ack, nack, stateReport, eventBadge, maintenanceAction]);

export type ServerMessage = z.infer<typeof serverMessage>;
export type DeviceMessage = z.infer<typeof deviceMessage>;
export type ServerMessageType = ServerMessage["type"];
export type DeviceMessageType = DeviceMessage["type"];

/** Server messages that must be acknowledged by the device and therefore go through the outbox. */
export const COMMAND_TYPES = [
  "room.status.set",
  "room.info.set",
  "display.config.set",
  "audio.settings.set",
  "announce.show",
  "announce.clear",
  "audio.play",
  "emergency.set",
  "emergency.clear",
  "access.acl.sync",
  "registration.mode.set",
] as const satisfies readonly ServerMessageType[];
export type CommandType = (typeof COMMAND_TYPES)[number];

export const isCommandType = (t: string): t is CommandType => (COMMAND_TYPES as readonly string[]).includes(t);

/** Payload type of a message type, e.g. `PayloadOf<"room.status.set">`. */
export type PayloadOf<T extends ServerMessageType | DeviceMessageType> = Extract<
  ServerMessage | DeviceMessage,
  { type: T }
>["payload"];
