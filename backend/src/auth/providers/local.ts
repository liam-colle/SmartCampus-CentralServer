import { verifyPassword } from "../../lib/password.js";
import { UserModel, type UserDoc } from "../../models/user.js";

// Verified against when the email is unknown, so response time does not reveal which emails exist.
const DUMMY_HASH =
  "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64");

/** Email + password login. Returns the user, or null on any failure. */
export async function verifyCredentials(email: string, password: string): Promise<UserDoc | null> {
  const user = await UserModel.findOne({ email: email.toLowerCase().trim() });
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  return user && ok && !user.disabled ? user : null;
}
