import { HttpError } from "../lib/errors.js";
import { UserModel, type PublicUser, type Role } from "../models/user.js";

/**
 * Who may manage whom:
 *  - admin    : every account, every role
 *  - operator : staff accounts only (cannot touch admins/operators or grant those roles)
 *  - staff    : nobody
 */
export function canManageRole(actor: PublicUser, targetRole: Role): boolean {
  if (actor.role === "admin") return true;
  return actor.role === "operator" && targetRole === "staff";
}

export function assertCanManage(actor: PublicUser, targetRole: Role): void {
  if (!canManageRole(actor, targetRole)) throw new HttpError(403, "You cannot manage this kind of account");
}

/** Refuses an operation that would leave the system without an active admin. */
export async function assertNotLastAdmin(userId: string): Promise<void> {
  const others = await UserModel.countDocuments({ role: "admin", disabled: false, _id: { $ne: userId } });
  if (others === 0) throw new HttpError(409, "At least one active administrator is required");
}
