import { HttpError } from "../lib/errors.js";
import { UserModel, isPrivileged, type Group, type PublicUser } from "../models/user.js";

/**
 * Who may manage whom, looking at the groups of the target account:
 *  - admin    : every account, every group
 *  - operator : accounts that are neither admin nor operator (students, plain staff), and cannot
 *               grant those two groups
 *  - staff    : nobody
 */
export function canManageGroups(actor: PublicUser, targetGroups: readonly Group[]): boolean {
  if (actor.role === "admin") return true;
  return actor.role === "operator" && !isPrivileged(targetGroups);
}

export function assertCanManage(actor: PublicUser, targetGroups: readonly Group[]): void {
  if (!canManageGroups(actor, targetGroups)) throw new HttpError(403, "You cannot manage this kind of account");
}

/** Refuses an operation that would leave the system without an active admin. */
export async function assertNotLastAdmin(userId: string): Promise<void> {
  const others = await UserModel.countDocuments({ groups: "admin", disabled: false, _id: { $ne: userId } });
  if (others === 0) throw new HttpError(409, "At least one active administrator is required");
}
