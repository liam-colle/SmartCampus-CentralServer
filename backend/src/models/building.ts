import { Schema, model, type Types } from "mongoose";

const buildingSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    address: { type: String, trim: true },
  },
  { timestamps: true },
);

export const BuildingModel = model("Building", buildingSchema);

export interface BuildingLike {
  _id: Types.ObjectId;
  code: string;
  name: string;
  address?: string | null;
}

export const buildingDto = (b: BuildingLike, roomCount?: number) => ({
  id: String(b._id),
  code: b.code,
  name: b.name,
  address: b.address ?? "",
  ...(roomCount !== undefined && { roomCount }),
});
