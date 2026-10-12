import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { HttpError } from "../lib/errors.js";
import { escapeRegex, objectId, optionalText, pagination } from "../lib/http.js";
import { BuildingModel } from "../models/building.js";
import { ROOM_TYPES, RoomModel, roomDto, type RoomLike } from "../models/room.js";

export const roomsRouter = Router();
roomsRouter.use(requireAuth);

const canWrite = requireRole("admin", "operator");

export const roomInput = z.object({
  building: z.string().min(1),
  code: z.string().trim().min(1).max(30),
  name: optionalText(100),
  floor: z.coerce.number({ invalid_type_error: "must be a number" }).int().min(-10).max(200),
  capacity: z.coerce.number().int().min(0).max(100_000).optional(),
  type: z.enum(ROOM_TYPES).default("other"),
});

const listQuery = pagination.extend({
  building: z.string().optional(),
  floor: z.coerce.number().int().optional(),
  type: z.enum(ROOM_TYPES).optional(),
  q: z.string().trim().max(100).optional(),
});

function buildFilter(q: z.infer<typeof listQuery>) {
  const filter: Record<string, unknown> = {};
  if (q.building) filter.building = objectId(q.building);
  if (q.floor !== undefined) filter.floor = q.floor;
  if (q.type) filter.type = q.type;
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), "i");
    filter.$or = [{ code: rx }, { name: rx }];
  }
  return filter;
}

async function loadRoom(id: string) {
  const room = await RoomModel.findById(id).populate("building", "code name").lean();
  if (!room) throw new HttpError(404, "Room not found");
  return roomDto(room as unknown as RoomLike);
}

/** Search + filter by building and/or floor, paginated. */
roomsRouter.get("/", async (req, res) => {
  const q = listQuery.parse(req.query);
  const filter = buildFilter(q);

  const [rooms, total] = await Promise.all([
    RoomModel.find(filter)
      .sort({ building: 1, floor: 1, code: 1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .populate("building", "code name")
      .lean(),
    RoomModel.countDocuments(filter),
  ]);
  res.json({ items: rooms.map((r) => roomDto(r as unknown as RoomLike)), total, page: q.page, limit: q.limit });
});

/** Floors that actually have rooms, optionally within one building (feeds the floor filter). */
roomsRouter.get("/floors", async (req, res) => {
  const building = typeof req.query.building === "string" ? objectId(req.query.building) : undefined;
  const floors = await RoomModel.distinct("floor", building ? { building } : {});
  res.json({ items: floors.sort((a: number, b: number) => a - b) });
});

roomsRouter.get("/:id", async (req, res) => {
  res.json(await loadRoom(objectId(req.params.id)));
});

roomsRouter.post("/", canWrite, async (req, res) => {
  const input = roomInput.parse(req.body);
  if (!(await BuildingModel.exists({ _id: objectId(input.building) }))) {
    throw new HttpError(400, "Unknown building");
  }
  const room = await RoomModel.create(input);
  res.status(201).json(await loadRoom(room.id));
});

roomsRouter.patch("/:id", canWrite, async (req, res) => {
  const id = objectId(req.params.id);
  const patch = roomInput.partial().parse(req.body);
  if (patch.building && !(await BuildingModel.exists({ _id: objectId(patch.building) }))) {
    throw new HttpError(400, "Unknown building");
  }
  const room = await RoomModel.findByIdAndUpdate(id, patch, { new: true, runValidators: true });
  if (!room) throw new HttpError(404, "Room not found");
  res.json(await loadRoom(id));
});

roomsRouter.delete("/:id", canWrite, async (req, res) => {
  const result = await RoomModel.deleteOne({ _id: objectId(req.params.id) });
  if (!result.deletedCount) throw new HttpError(404, "Room not found");
  res.status(204).end();
});
