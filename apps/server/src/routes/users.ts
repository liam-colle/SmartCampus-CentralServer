import { Router } from "express";
import { z } from "zod";
import { assertCanManage, assertNotLastAdmin } from "../auth/permissions.js";
import { requireRole } from "../auth/middleware.js";
import { sendPasswordLink } from "../auth/passwordReset.js";
import { revokeUserSessions } from "../auth/sessions.js";
import { HttpError } from "../lib/errors.js";
import { escapeRegex, objectId, optionalText, pagination, passwordSchema } from "../lib/http.js";
import { hashPassword } from "../lib/password.js";
import { assertCardFree, cardUidSchema } from "../domain/cards.js";
import { recordAudit } from "../lib/audit.js";
import { GROUPS, UserModel, type Group, type PublicUser, type UserDoc } from "../models/user.js";
import { userDto } from "../models/userDto.js";

/** The staff directory and account management. Admins and operators only. */
export const usersRouter = Router();
usersRouter.use(requireRole("admin", "operator"));

/** Fields every kind of person has. The CSV import uses these on their own. */
export const personFields = {
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().min(1).max(100),
  department: optionalText(100),
  jobTitle: optionalText(100),
  phone: optionalText(40),
};

/** A set, whatever order or repetition the client sends. */
const groupsField = z.array(z.enum(GROUPS)).max(GROUPS.length).transform((g) => [...new Set(g)] as Group[]);

export const userFields = {
  ...personFields,
  groups: groupsField,
  cardUid: cardUidSchema,
};

const createInput = z.object({
  ...userFields,
  // A person who only uses a card has no mailbox. Sending an invitation needs one (checked at send time).
  email: personFields.email.optional(),
  groups: userFields.groups.default([]),
  cardUid: userFields.cardUid.optional(),
  password: passwordSchema.optional(),
  // Email the person a link to choose their own password.
  sendInvite: z.boolean().default(false),
});

const updateInput = z.object({
  ...userFields,
  // null removes the card (lost or returned).
  cardUid: userFields.cardUid.nullable(),
  password: passwordSchema,
  disabled: z.boolean(),
}).partial();

const listQuery = pagination.extend({
  q: z.string().trim().max(100).optional(),
  group: z.enum(GROUPS).optional(),
});

usersRouter.get("/", async (req, res) => {
  const q = listQuery.parse(req.query);
  const filter: Record<string, unknown> = {};
  if (q.group) filter.groups = q.group;
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
  assertCanManage(req.user!, input.groups);
  if (!password && !sendInvite) {
    throw new HttpError(400, "Provide a password or send an invitation");
  }
  if (input.cardUid) await assertCardFree(input.cardUid);

  const user = await UserModel.create({
    ...input,
    passwordHash: password ? await hashPassword(password) : undefined,
  });
  if (sendInvite) await sendPasswordLink(user, "invite");
  await auditAccess(req.user!, user, { created: true });
  res.status(201).json(userDto(user));
});

usersRouter.patch("/:id", async (req, res) => {
  const user = await UserModel.findById(objectId(req.params.id));
  if (!user) throw new HttpError(404, "User not found");
  const patch = updateInput.parse(req.body);
  const actor = req.user!;

  assertCanManage(actor, user.groups as Group[]);
  if (patch.groups) assertCanManage(actor, patch.groups);
  if (patch.cardUid) await assertCardFree(patch.cardUid, user.id);

  const losesAdmin =
    user.groups.includes("admin") &&
    ((patch.groups !== undefined && !patch.groups.includes("admin")) || patch.disabled === true);
  if (losesAdmin) {
    if (user.id === actor.id) throw new HttpError(409, "You cannot remove your own admin access");
    await assertNotLastAdmin(user.id);
  }
  if (patch.disabled && user.id === actor.id) throw new HttpError(409, "You cannot disable yourself");

  const before = { groups: [...user.groups], hadCard: Boolean(user.cardUid) };
  const { password, cardUid, ...fields } = patch;
  user.set(fields);
  // `undefined` leaves the card alone, `null` removes it.
  if (cardUid !== undefined) user.cardUid = cardUid ?? undefined;
  if (password) user.passwordHash = await hashPassword(password);
  await user.save();
  await auditAccess(actor, user, { before });

  if (password || patch.disabled) await revokeUserSessions(user._id);
  res.json(userDto(user));
});

/** Sends a reset link to the user (for "I'm locked out" requests handled by an operator). */
usersRouter.post("/:id/invite", async (req, res) => {
  const user = await UserModel.findById(objectId(req.params.id));
  if (!user) throw new HttpError(404, "User not found");
  assertCanManage(req.user!, user.groups as Group[]);
  await sendPasswordLink(user, user.passwordHash ? "reset" : "invite");
  res.status(204).end();
});

usersRouter.delete("/:id", requireRole("admin"), async (req, res) => {
  const user = await UserModel.findById(objectId(req.params.id));
  if (!user) throw new HttpError(404, "User not found");
  if (user.id === req.user!.id) throw new HttpError(409, "You cannot delete yourself");
  if (user.groups.includes("admin")) await assertNotLastAdmin(user.id);

  await user.deleteOne();
  await revokeUserSessions(user._id);
  res.status(204).end();
});

/**
 * Group and card changes decide who may open a maintenance menu, so they are audited. The card
 * number is never written to the log, only whether the person has one.
 */
async function auditAccess(actor: PublicUser, user: UserDoc, meta: Record<string, unknown>) {
  await recordAudit(actor, "user.access.change", { type: "user", id: user.id }, {
    ...meta,
    groups: user.groups,
    hasCard: Boolean(user.cardUid),
  });
}
