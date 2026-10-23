// Usage: pnpm user:create <email> <password> [name] [admin|operator|staff]
// The role maps to a group: admin and operator join that group, staff joins none.
import mongoose from "mongoose";
import { config } from "../config.js";
import { hashPassword } from "../lib/password.js";
import { ROLES, UserModel, type Role } from "../models/user.js";

const [email, password, name, role = "staff"] = process.argv.slice(2);

if (!email || !password || !ROLES.includes(role as Role)) {
  console.error("Usage: pnpm user:create <email> <password> [name] [admin|operator|staff]");
  process.exit(1);
}

await mongoose.connect(config.MONGO_URI);
try {
  await UserModel.create({
    email,
    name: name ?? email,
    groups: role === "staff" ? [] : [role],
    passwordHash: await hashPassword(password),
  });
  console.log(`Created ${role} ${email}`);
} finally {
  await mongoose.disconnect();
}
