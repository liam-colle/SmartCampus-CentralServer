import { STATUS_ICONS, statusKey } from "@smartcampus/protocol";
import { Schema, model } from "mongoose";
import { z } from "zod";

/** A status a room can be in. Built-in ones cannot be deleted; admins may add their own. */
const roomStatusSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    label: { type: String, required: true, trim: true },
    color: { type: String, required: true },
    icon: { type: String, enum: STATUS_ICONS, required: true },
    builtIn: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const RoomStatusModel = model("RoomStatus", roomStatusSchema);

/** Free, occupied, closed and works: what the calendar asks for out of the box. */
export const BUILT_IN_STATUSES = [
  { key: "free", label: "Free", color: "#00a86b", icon: "check" },
  { key: "occupied", label: "Occupied", color: "#f5a524", icon: "user" },
  { key: "closed", label: "Closed", color: "#e5484d", icon: "lock" },
  { key: "maintenance", label: "Works", color: "#8b95a1", icon: "wrench" },
] as const;

export const DEFAULT_STATUS_KEY = "free";

export const statusInput = z.object({
  key: statusKey,
  label: z.string().trim().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "expected a colour like #00a86b"),
  icon: z.enum(STATUS_ICONS),
});

export const roomStatusDto = (s: { key: string; label: string; color: string; icon: string; builtIn?: boolean | null }) => ({
  key: s.key,
  label: s.label,
  color: s.color,
  icon: s.icon,
  builtIn: Boolean(s.builtIn),
});
