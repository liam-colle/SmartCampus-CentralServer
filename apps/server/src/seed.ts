import { config } from "./config.js";
import { hashPassword } from "./lib/password.js";
import { UserModel } from "./models/user.js";

/** Creates the bootstrap admin from SEED_ADMIN_* if it does not exist yet. */
export async function seedAdmin(): Promise<void> {
  const { SEED_ADMIN_EMAIL: email, SEED_ADMIN_PASSWORD: password, SEED_ADMIN_NAME: name } = config;
  if (!email || !password) return;
  if (await UserModel.exists({ email: email.toLowerCase() })) return;

  await UserModel.create({
    email,
    name,
    role: "admin",
    passwordHash: await hashPassword(password),
  });
  console.log(`Seeded admin user ${email}`);
}
