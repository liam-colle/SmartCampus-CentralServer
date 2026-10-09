import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { HttpError } from "../lib/errors.js";
import { objectId, optionalText } from "../lib/http.js";
import { BuildingModel, buildingDto } from "../models/building.js";
import { RoomModel } from "../models/room.js";

export const buildingsRouter = Router();
buildingsRouter.use(requireAuth);

const canWrite = requireRole("admin", "operator");

export const buildingInput = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(100),
  address: optionalText(200),
});

buildingsRouter.get("/", async (_req, res) => {
  const [buildings, counts] = await Promise.all([
    BuildingModel.find().sort({ code: 1 }).lean(),
    RoomModel.aggregate<{ _id: unknown; n: number }>([{ $group: { _id: "$building", n: { $sum: 1 } } }]),
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c.n]));
  res.json({ items: buildings.map((b) => buildingDto(b, byId.get(String(b._id)) ?? 0)) });
});

buildingsRouter.post("/", canWrite, async (req, res) => {
  const building = await BuildingModel.create(buildingInput.parse(req.body));
  res.status(201).json(buildingDto(building));
});

buildingsRouter.patch("/:id", canWrite, async (req, res) => {
  const patch = buildingInput.partial().parse(req.body);
  const building = await BuildingModel.findByIdAndUpdate(objectId(req.params.id), patch, {
    new: true,
    runValidators: true,
  });
  if (!building) throw new HttpError(404, "Building not found");
  res.json(buildingDto(building));
});

buildingsRouter.delete("/:id", canWrite, async (req, res) => {
  const id = objectId(req.params.id);
  if (await RoomModel.exists({ building: id })) {
    throw new HttpError(409, "This building still has rooms. Delete or move them first.");
  }
  const result = await BuildingModel.deleteOne({ _id: id });
  if (!result.deletedCount) throw new HttpError(404, "Building not found");
  res.status(204).end();
});
