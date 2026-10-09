import { Router } from "express";
import { z } from "zod";
import { assertCanManage, assertNotLastAdmin } from "../auth/permissions.js";
import { requireRole } from "../auth/middleware.js";
import { sendPasswordLink } from "../auth/passwordReset.js";
import { revokeUserSessions } from "../auth/sessions.js";
import { HttpError } from "../lib/errors.js";
import { escapeRegex, objectId, optionalText, pagination, passwordSchema } from "../lib/http.js";
import { hashPassword } from "../lib/password.js";
import { ROLES, UserModel } from "../models/user.js";
import { userDto } from "../models/userDto.js";

/** The staff directory and account management. Admins and operators only. */
export const usersRouter = Router();
usersRouter.use(requireRole("admin", "operator"));

export const userFields = {
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().min(1).max(100),
  role: z.enum(ROLES),
  department: optionalText(100),
  jobTitle: optionalText(100),
  phone: optionalText(40),
};

const createInput = z.object({
  ...userFields,
  role: userFields.role.default("staff"),
  password: passwordSchema.optional(),
  // Email the person a link to choose their own password.
  sendInvite: z.boolean().default(false),
});

const updateInput = z.object({
  ...userFields,
  password: passwordSchema,
  disabled: z.boolean(),
}).partial();

const listQuery = pagination.extend({
  q: z.string().trim().max(100).optional(),
  role: z.enum(ROLES).optional(),
});

usersRouter.get("/", async (req, res) => {
  const q = listQuery.parse(req.query);
  const filter: Record<string, unknown> = {};
  if (q.role) filter.role = q.role;
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), "i");
    filter.$or = [{ name: rx }, { email: rx }, { department: rx }];
  }
  const [users, total] = await Promise.all([
    UserModel.find(filter)
      .sort({ name: 1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    UserModel.countDocuments(filter),
  ]);
  res.json({ items: users.map(userDto), total, page: q.page, limit: q.limit });
});

usersRouter.post("/", async (req, res) => {
  const { password, sendInvite, ...input } = createInput.parse(req.body);
  assertCanManage(req.user!, input.role);
  if (!password && !sendInvite) {
    throw new HttpError(400, "Provide a password or send an invitation");
  }

  const user = await UserModel.create({
    ...input,
    passwordHash: password ? await hashPassword(password) : undefined,
  });
  if (sendInvite) await sendPasswordLink(user, "invite");
  res.status(201).json(userDto(user));
});

usersRouter.patch("/:id", async (req, res) => {
  const user = await UserModel.findById(objectId(req.params.id));
  if (!user) throw new HttpError(404, "User not found");
  const patch = updateInput.parse(req.body);
  const actor = req.user!;

  assertCanManage(actor, user.role);
  if (patch.role) assertCanManage(actor, patch.role);

  const losesAdmin =
    user.role === "admin" &&
    ((patch.role !== undefined && patch.role !== "admin") || patch.disabled === true);
  if (losesAdmin) {
    if (user.id === actor.id) throw new HttpError(409, "You cannot remove your own admin access");
    await assertNotLastAdmin(user.id);
  }
  if (patch.disabled && user.id === actor.id) throw new HttpError(409, "You cannot disable yourself");

  const { password, ...fields } = patch;
  user.set(fields);
  if (password) user.passwordHash = await hashPassword(password);
  await user.save();

  if (password || patch.disabled) await revokeUserSessions(user._id);
  res.json(userDto(user));
});

/** Sends a reset link to the user (for "I'm locked out" requests handled by an operator). */
usersRouter.post("/:id/invite", async (req, res) => {
  const user = await UserModel.findById(objectId(req.params.id));
  if (!user) throw new HttpError(404, "User not found");
  assertCanManage(req.user!, user.role);
  await sendPasswordLink(user, user.passwordHash ? "reset" : "invite");
  res.status(204).end();
});

usersRouter.delete("/:id", requireRole("admin"), async (req, res) => {
  const user = await UserModel.findById(objectId(req.params.id));
  if (!user) throw new HttpError(404, "User not found");
  if (user.id === req.user!.id) throw new HttpError(409, "You cannot delete yourself");
  if (user.role === "admin") await assertNotLastAdmin(user.id);

  await user.deleteOne();
  await revokeUserSessions(user._id);
  res.status(204).end();
});
