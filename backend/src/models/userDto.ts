import type { Role, UserDoc } from "./user.js";

export interface UserLike {
  _id: unknown;
  email: string;
  name: string;
  role: Role;
  department?: string | null;
  jobTitle?: string | null;
  phone?: string | null;
  disabled: boolean;
  passwordHash?: string | null;
  createdAt?: Date;
}

/** Full record for the staff directory (admin/operator views). */
export const userDto = (u: UserLike | UserDoc) => ({
  id: String(u._id),
  email: u.email,
  name: u.name,
  role: u.role,
  department: u.department ?? "",
  jobTitle: u.jobTitle ?? "",
  phone: u.phone ?? "",
  disabled: u.disabled,
  hasPassword: Boolean(u.passwordHash),
  createdAt: u.createdAt,
});
