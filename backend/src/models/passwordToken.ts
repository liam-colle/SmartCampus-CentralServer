import { Schema, model } from "mongoose";

/** Single-use token for "forgot password" (reset) and first-login invitations (invite). */
const passwordTokenSchema = new Schema({
  tokenHash: { type: String, required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  purpose: { type: String, enum: ["reset", "invite"], required: true },
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
});

export const PasswordTokenModel = model("PasswordToken", passwordTokenSchema);
