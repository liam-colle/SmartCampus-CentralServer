import { Schema, model } from "mongoose";

const sessionSchema = new Schema({
  // SHA-256 of the cookie token. The raw token is never stored.
  tokenHash: { type: String, required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  provider: { type: String, required: true },
  userAgent: { type: String },
  ip: { type: String },
  createdAt: { type: Date, default: Date.now },
  // MongoDB removes the document automatically once this date passes.
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
});

export const SessionModel = model("Session", sessionSchema);
