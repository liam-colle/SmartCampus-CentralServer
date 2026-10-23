import { createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";
import { HttpError } from "../lib/errors.js";
import { sendMail } from "../lib/mail.js";
import { hashPassword } from "../lib/password.js";
import { PasswordTokenModel } from "../models/passwordToken.js";
import { UserModel, type UserDoc } from "../models/user.js";
import { revokeUserSessions } from "./sessions.js";

type Purpose = "reset" | "invite";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Creates a token (replacing older ones for the user) and mails the link. */
export async function sendPasswordLink(user: UserDoc, purpose: Purpose): Promise<void> {
  // Students enrolled with a card only have no mailbox to write to.
  if (!user.email) throw new HttpError(400, "This person has no email address");
  const token = randomBytes(32).toString("base64url");
  const ttlMs =
    purpose === "invite" ? config.INVITE_TTL_HOURS * 3_600_000 : config.RESET_TOKEN_TTL_MINUTES * 60_000;

  await PasswordTokenModel.deleteMany({ userId: user._id });
  await PasswordTokenModel.create({
    tokenHash: hash(token),
    userId: user._id,
    purpose,
    expiresAt: new Date(Date.now() + ttlMs),
  });

  const link = `${config.APP_URL}/reset-password?token=${token}`;
  if (purpose === "invite") {
    await sendMail(
      user.email,
      "Your SmartCampus account",
      `Hello ${user.name},\n\nAn account was created for you on SmartCampus. Choose your password here:\n${link}\n\nThis link is valid for ${config.INVITE_TTL_HOURS} hours.`,
    );
  } else {
    await sendMail(
      user.email,
      "Reset your SmartCampus password",
      `Hello ${user.name},\n\nUse this link to choose a new password:\n${link}\n\nIt is valid for ${config.RESET_TOKEN_TTL_MINUTES} minutes. If you did not ask for this, ignore this message.`,
    );
  }
}

/** Starts a reset for an email. Silent when the account is unknown, to not reveal which exist. */
export async function requestReset(email: string): Promise<void> {
  const user = await UserModel.findOne({ email: email.toLowerCase().trim() });
  if (user && !user.disabled) await sendPasswordLink(user, "reset");
}

/** Consumes a token and sets the password. All of the user's sessions are revoked. */
export async function completeReset(token: string, password: string): Promise<void> {
  const record = await PasswordTokenModel.findOneAndDelete({
    tokenHash: hash(token),
    expiresAt: { $gt: new Date() },
  });
  const user = record && (await UserModel.findById(record.userId));
  if (!user || user.disabled) throw new HttpError(400, "This link is invalid or has expired");

  user.passwordHash = await hashPassword(password);
  await user.save();
  await revokeUserSessions(user._id);
}
