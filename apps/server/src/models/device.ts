import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";

export const DEVICE_TYPES = ["door", "display", "access"] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

/**
 * pending: connection request waiting for an admin. active: may connect. denied: request refused.
 * revoked: was active, refused for good.
 */
export const DEVICE_STATUSES = ["pending", "active", "revoked", "denied"] as const;

const deviceSchema = new Schema(
  {
    // ULID chosen by the server at enrollment; the device presents it in `hello`.
    deviceId: { type: String, required: true, unique: true },
    type: { type: String, enum: DEVICE_TYPES, required: true },
    name: { type: String, trim: true, default: "" },
    status: { type: String, enum: DEVICE_STATUSES, default: "pending", required: true },
    // SPKI DER base64 (ECDSA P-256). The private key never leaves the device.
    publicKey: { type: String, required: true },
    fingerprint: { type: String, required: true, unique: true },
    // Only on connection requests (pending, or denied until the record is purged).
    enrollExpiresAt: { type: Date },
    requestIp: { type: String },
    requestUserAgent: { type: String },
    room: { type: Schema.Types.ObjectId, ref: "Room" },
    groups: { type: [String], default: [] },
    // Digital twin: what the admin wants vs what the device last reported.
    desired: { type: Schema.Types.Mixed, default: {} },
    reported: { type: Schema.Types.Mixed, default: {} },
    telemetry: { type: Schema.Types.Mixed, default: {} },
    lastSeenAt: { type: Date },
  },
  { timestamps: true, minimize: false },
);

// Unanswered and denied requests disappear on their own (the field is removed on approval).
deviceSchema.index(
  { enrollExpiresAt: 1 },
  { expireAfterSeconds: 0, partialFilterExpression: { enrollExpiresAt: { $exists: true } } },
);

export type DeviceDoc = HydratedDocument<InferSchemaType<typeof deviceSchema>>;
export const DeviceModel = model("Device", deviceSchema);

export const deviceDto = (d: DeviceDoc, online: boolean) => ({
  id: d.deviceId,
  type: d.type,
  name: d.name,
  status: d.status,
  fingerprint: d.fingerprint,
  room: d.room ? String(d.room) : null,
  groups: d.groups,
  desired: d.desired,
  reported: d.reported,
  telemetry: d.telemetry,
  online,
  lastSeenAt: d.lastSeenAt ?? null,
  createdAt: d.createdAt,
});

/** What the console shows for a connection request. */
export const requestDto = (d: DeviceDoc) => ({
  id: d.deviceId,
  type: d.type,
  name: d.name,
  fingerprint: d.fingerprint,
  ip: d.requestIp ?? null,
  userAgent: d.requestUserAgent ?? null,
  requestedAt: d.createdAt,
  expiresAt: d.enrollExpiresAt ?? null,
});
