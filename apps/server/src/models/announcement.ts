import { ANNOUNCE_PRIORITIES } from "@smartcampus/protocol";
import { Schema, model } from "mongoose";

/** Who sees an announcement. Selectors add up (union); `all` means every screen. */
const targetsSchema = new Schema(
  {
    all: { type: Boolean, default: false },
    devices: { type: [String], default: [] },
    groups: { type: [String], default: [] },
    buildings: { type: [String], default: [] },
    floors: { type: [{ building: String, floor: Number, _id: false }], default: [] },
  },
  { _id: false },
);

const announcementSchema = new Schema(
  {
    // ULID. Also the `announcementId` devices receive, so cancelling and replay refer to the same thing.
    announcementId: { type: String, required: true, unique: true },
    title: { type: String, trim: true, default: "" },
    text: { type: String, required: true, trim: true },
    priority: { type: String, enum: ANNOUNCE_PRIORITIES, default: "info", required: true },
    targets: { type: targetsSchema, required: true },
    // Devices the targets resolved to when the announcement was created (later enrollments do not receive it).
    deviceIds: { type: [String], default: [] },
    expiresAt: { type: Date },
    status: { type: String, enum: ["active", "cancelled"], default: "active", required: true },
    createdByName: { type: String, required: true },
    cancelledAt: { type: Date },
  },
  { timestamps: true },
);

announcementSchema.index({ createdAt: -1 });

export const AnnouncementModel = model("Announcement", announcementSchema);

export type AnnouncementState = "active" | "expired" | "cancelled";

export function announcementState(a: { status: string; expiresAt?: Date | null }, now = Date.now()): AnnouncementState {
  if (a.status === "cancelled") return "cancelled";
  return a.expiresAt && a.expiresAt.getTime() <= now ? "expired" : "active";
}
