import { Schema, model } from "mongoose";

/** One row per status change of a room, kept for the history view. */
const roomStatusChangeSchema = new Schema({
  room: { type: Schema.Types.ObjectId, ref: "Room", required: true },
  from: { type: String, required: true },
  to: { type: String, required: true },
  // Label and colour as they were at the time, so renaming a status does not rewrite history.
  toLabel: { type: String, required: true },
  toColor: { type: String, required: true },
  actorName: { type: String, required: true },
  at: { type: Date, default: () => new Date() },
});

roomStatusChangeSchema.index({ room: 1, at: -1 });

export const RoomStatusChangeModel = model("RoomStatusChange", roomStatusChangeSchema);
