import { Schema, model } from "mongoose";

/**
 * A reader put into registration mode by an admin or operator: cards presented to it are collected
 * here until the person is done, then turned into students. Closed sessions are kept for a while
 * for the audit trail and removed by MongoDB afterwards.
 */
const registrationSessionSchema = new Schema(
  {
    sessionId: { type: String, required: true, unique: true },
    deviceId: { type: String, required: true, index: true },
    status: { type: String, enum: ["active", "closed"], default: "active", required: true },
    startedById: { type: String, required: true },
    startedByName: { type: String, required: true },
    // After this time the session no longer collects cards, whatever its status says.
    expiresAt: { type: Date, required: true },
    cards: {
      type: [new Schema({ uid: { type: String, required: true }, scannedAt: { type: Date, required: true } }, { _id: false })],
      default: [],
    },
    removeAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true },
);

export const RegistrationSessionModel = model("RegistrationSession", registrationSessionSchema);
