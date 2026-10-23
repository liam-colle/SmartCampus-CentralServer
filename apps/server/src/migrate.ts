import { ROLES, UserModel, type Role } from "./models/user.js";

/**
 * Brings existing user documents in line with the group model. Safe to run on every start.
 *
 * Before: one stored `role` (admin | operator | staff) and a mandatory, globally unique email.
 * Now: `groups`, an optional card, and an email that is only unique when present. The old role
 * becomes the matching group (staff joins none), then the stored field is dropped so it cannot
 * drift from the groups.
 */
export async function migrateUsers(): Promise<void> {
  const legacy = UserModel.collection;
  for (const role of ROLES.filter((r): r is Exclude<Role, "staff"> => r !== "staff")) {
    await legacy.updateMany({ role, groups: { $exists: false } }, { $set: { groups: [role] } });
  }
  await legacy.updateMany({ groups: { $exists: false } }, { $set: { groups: [] } });
  await legacy.updateMany({ role: { $exists: true } }, { $unset: { role: "" } });
  // The old email index was a plain unique one, which would refuse a second student without email.
  await UserModel.syncIndexes();
}
