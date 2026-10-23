import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../auth/middleware.js";
import { assertCardFree, cardUidSchema } from "../domain/cards.js";
import { recordAudit } from "../lib/audit.js";
import { HttpError } from "../lib/errors.js";
import { UserModel } from "../models/user.js";
import { userDto } from "../models/userDto.js";
import { personFields } from "./users.js";

/**
 * Students are people identified by their NFC card. They have no password and, usually, no email,
 * so they cannot sign in to the console. Admins and operators only.
 */
export const studentsRouter = Router();
studentsRouter.use(requireRole("admin", "operator"));

const MAX_BULK_STUDENTS = 200;

const studentInput = z.object({
  name: personFields.name,
  cardUid: cardUidSchema,
  email: personFields.email.optional(),
  department: personFields.department,
});

const bulkInput = z.object({
  students: z.array(z.object({ name: personFields.name, cardUid: cardUidSchema })).min(1).max(MAX_BULK_STUDENTS),
});

async function createStudent(input: z.infer<typeof studentInput>) {
  await assertCardFree(input.cardUid);
  return UserModel.create({ ...input, groups: ["student"] });
}

studentsRouter.post("/", async (req, res) => {
  const student = await createStudent(studentInput.parse(req.body));
  await recordAudit(req.user!, "student.create", { type: "user", id: student.id });
  res.status(201).json(userDto(student));
});

/**
 * Creates the students of a registration session in one go. Rows are independent: the ones that
 * fail (card taken, bad name) are reported and the others still go through.
 */
studentsRouter.post("/bulk", async (req, res) => {
  const { students } = bulkInput.parse(req.body);
  const created = [];
  const errors: { index: number; message: string }[] = [];

  for (const [index, row] of students.entries()) {
    try {
      created.push(userDto(await createStudent(row)));
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      errors.push({ index, message: err.message });
    }
  }
  await recordAudit(req.user!, "student.bulk-create", { type: "user", id: "bulk" }, { created: created.length, failed: errors.length });
  res.status(201).json({ created, errors });
});
