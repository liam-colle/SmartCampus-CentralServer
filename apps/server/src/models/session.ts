import { Schema, model } from "mongoose";

const sessionSchema = new Schema({
  // SHA-256 of the cookie token. The raw token is never stored.
  tokenHash: { type: String, required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  provider: { type: String, required: true },
  userAgent: { type: String },
  ip: { type: String },
  createdAt: { type: Date, default: Date.now },
  // Sliding expiry (idle timeout), pushed forward on activity. MongoDB deletes the document
  // once this date passes.
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  // Hard limit that the sliding expiry can never exceed.
  absoluteExpiresAt: { type: Date, required: true },
});

export const SessionModel = model("Session", sessionSchema);
