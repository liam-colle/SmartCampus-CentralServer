import { Schema, model } from "mongoose";

/** superseded: a newer command of the same kind replaced it before the device acknowledged it. */
export const COMMAND_STATUSES = ["pending", "sent", "acked", "nacked", "superseded"] as const;

/**
 * Outbox: every command is stored here before it is sent. It is replayed on reconnection until the
 * device acknowledges it or it expires (MongoDB removes it after `expiresAt`).
 */
const commandSchema = new Schema(
  {
    // ULID, reused as the envelope id on every (re)send: the device uses it for idempotence.
    commandId: { type: String, required: true, unique: true },
    deviceId: { type: String, required: true },
    type: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    status: { type: String, enum: COMMAND_STATUSES, default: "pending", required: true },
    attempts: { type: Number, default: 0 },
    nackReason: { type: String },
    sentAt: { type: Date },
    ackedAt: { type: Date },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true },
);

commandSchema.index({ deviceId: 1, status: 1 });

export const CommandModel = model("Command", commandSchema);
