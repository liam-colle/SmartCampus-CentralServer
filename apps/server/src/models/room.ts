import { Schema, model, type Types } from "mongoose";

export const ROOM_TYPES = ["classroom", "lecture_hall", "lab", "office", "meeting", "other"] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

const roomSchema = new Schema(
  {
    building: { type: Schema.Types.ObjectId, ref: "Building", required: true, index: true },
    // Room number / identifier, unique inside its building (e.g. "A.102").
    code: { type: String, required: true, trim: true },
    name: { type: String, trim: true },
    // 0 = ground floor, negative = basement.
    floor: { type: Number, required: true, min: -10, max: 200 },
    capacity: { type: Number, min: 0 },
    type: { type: String, enum: ROOM_TYPES, default: "other", required: true },
    // Key of a RoomStatus. Not a reference: custom statuses can be removed only when unused.
    status: { type: String, default: "free", required: true },
    statusSince: { type: Date },
  },
  { timestamps: true },
);

roomSchema.index({ building: 1, code: 1 }, { unique: true });
roomSchema.index({ building: 1, floor: 1 });

export const RoomModel = model("Room", roomSchema);

export interface RoomLike {
  _id: Types.ObjectId;
  code: string;
  name?: string | null;
  floor: number;
  capacity?: number | null;
  type: string;
  status?: string | null;
  statusSince?: Date | null;
  building: { _id: Types.ObjectId; code: string; name: string };
}

export const roomDto = (r: RoomLike) => ({
  id: String(r._id),
  code: r.code,
  name: r.name ?? "",
  floor: r.floor,
  capacity: r.capacity ?? null,
  type: r.type,
  status: r.status ?? "free",
  statusSince: r.statusSince ?? null,
  building: { id: String(r.building._id), code: r.building.code, name: r.building.name },
});
