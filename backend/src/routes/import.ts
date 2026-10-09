import express, { Router, type Request } from "express";
import { z } from "zod";
import { requireRole } from "../auth/middleware.js";
import { canManageRole } from "../auth/permissions.js";
import { sendPasswordLink } from "../auth/passwordReset.js";
import { HttpError } from "../lib/errors.js";
import { parseTable, type CsvRow } from "../lib/csv.js";
import { BuildingModel } from "../models/building.js";
import { ROOM_TYPES, RoomModel } from "../models/room.js";
import { UserModel } from "../models/user.js";
import { roomInput } from "./rooms.js";
import { userFields } from "./users.js";

/**
 * CSV import. Send the raw CSV as the request body (Content-Type: text/csv).
 *  ?dryRun=true         validate and report without writing anything
 *  ?sendInvites=true    (users) email new accounts a link to choose their password
 * Rows are upserted: rooms by (building, code), users by email. Bad rows are reported, the rest go through.
 */
export const importRouter = Router();
importRouter.use(requireRole("admin", "operator"));
importRouter.use(express.text({ type: ["text/csv", "text/plain"], limit: "2mb" }));

const MAX_ROWS = 5000;

interface ImportResult {
  dryRun: boolean;
  total: number;
  created: number;
  updated: number;
  errors: { line: number; message: string }[];
}

function readBody(req: Request, required: string[]): CsvRow[] {
  if (typeof req.body !== "string" || !req.body.trim()) throw new HttpError(400, "Empty file");
  const { headers, rows } = parseTable(req.body);
  const missing = required.filter((h) => !headers.includes(h));
  if (missing.length) throw new HttpError(400, `Missing column(s): ${missing.join(", ")}`);
  if (rows.length > MAX_ROWS) throw new HttpError(413, `Too many rows (max ${MAX_ROWS})`);
  return rows;
}

const describe = (err: unknown) =>
  err instanceof z.ZodError
    ? err.issues.map((i) => `${i.path.join(".") || "row"}: ${i.message}`).join("; ")
    : err instanceof Error
      ? err.message
      : "Invalid row";

const flag = (v: unknown) => v === "true" || v === "1";

// Columns: building (code), code, name, floor, capacity, type
importRouter.post("/rooms", async (req, res) => {
  const dryRun = flag(req.query.dryRun);
  const rows = readBody(req, ["building", "code", "floor"]);
  const result: ImportResult = { dryRun, total: rows.length, created: 0, updated: 0, errors: [] };

  const buildings = new Map((await BuildingModel.find().lean()).map((b) => [b.code, b._id]));
  const seen = new Set<string>();

  for (const { line, data } of rows) {
    try {
      const buildingId = buildings.get((data.building ?? "").toUpperCase());
      if (!buildingId) throw new Error(`Unknown building "${data.building}"`);

      const type = (data.type ?? "").toLowerCase().replace(/[\s-]+/g, "_") || "other";
      if (!ROOM_TYPES.includes(type as (typeof ROOM_TYPES)[number])) {
        throw new Error(`Unknown type "${data.type}" (${ROOM_TYPES.join(", ")})`);
      }
      const input = roomInput.parse({
        building: String(buildingId),
        code: data.code,
        name: data.name,
        floor: data.floor,
        capacity: data.capacity ? data.capacity : undefined,
        type,
      });

      const key = `${input.building}/${input.code}`;
      if (seen.has(key)) throw new Error("Duplicate of an earlier row in this file");
      seen.add(key);

      const existing = await RoomModel.exists({ building: buildingId, code: input.code });
      if (!dryRun) await RoomModel.updateOne({ building: buildingId, code: input.code }, input, { upsert: true });
      result[existing ? "updated" : "created"]++;
    } catch (err) {
      result.errors.push({ line, message: describe(err) });
    }
  }
  res.json(result);
});

// Columns: email, name, department, job title, phone, role (defaults to staff)
importRouter.post("/users", async (req, res) => {
  const dryRun = flag(req.query.dryRun);
  const sendInvites = flag(req.query.sendInvites);
  const actor = req.user!;
  const rows = readBody(req, ["email", "name"]);
  const result: ImportResult = { dryRun, total: rows.length, created: 0, updated: 0, errors: [] };

  const rowSchema = z.object(userFields).extend({ role: userFields.role.default("staff") });
  const seen = new Set<string>();

  for (const { line, data } of rows) {
    try {
      const input = rowSchema.parse({
        email: data.email,
        name: data.name,
        role: data.role ? data.role.toLowerCase() : undefined,
        department: data.department,
        jobTitle: data.jobtitle,
        phone: data.phone,
      });
      if (!canManageRole(actor, input.role)) throw new Error(`You cannot import "${input.role}" accounts`);
      if (seen.has(input.email)) throw new Error("Duplicate of an earlier row in this file");
      seen.add(input.email);

      const existing = await UserModel.findOne({ email: input.email });
      if (existing && !canManageRole(actor, existing.role)) {
        throw new Error("Existing account you cannot manage");
      }
      // Never let an import demote the last admin, lock someone out or touch the caller's own role.
      if (existing && existing.id === actor.id && input.role !== existing.role) {
        throw new Error("You cannot change your own role");
      }
      if (existing?.role === "admin" && input.role !== "admin") {
        throw new Error("Change an admin's role from the staff page, not by import");
      }

      if (!dryRun) {
        if (existing) {
          existing.set(input);
          await existing.save();
        } else {
          const user = await UserModel.create(input);
          if (sendInvites) await sendPasswordLink(user, "invite");
        }
      }
      result[existing ? "updated" : "created"]++;
    } catch (err) {
      result.errors.push({ line, message: describe(err) });
    }
  }
  res.json(result);
});
