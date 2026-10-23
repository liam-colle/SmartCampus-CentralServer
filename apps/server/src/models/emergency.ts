import { EMERGENCY_KINDS } from "@smartcampus/protocol";
import { Schema, model } from "mongoose";

/** Which screens an emergency was sent to, as chosen in the console. Selectors add up. */
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

/** One emergency alert, from its trigger to its end. The record stays as history. */
const emergencySchema = new Schema(
  {
    // ULID, also the `emergencyId` devices receive.
    emergencyId: { type: String, required: true, unique: true },
    kind: { type: String, enum: EMERGENCY_KINDS, required: true },
    title: { type: String, required: true },
    instructions: { type: String, required: true },
    // A test runs the same screens with a quieter alarm; it is kept in the history like a real alert.
    testMode: { type: Boolean, default: false },
    testVolume: { type: Number, default: 20 },
    targets: { type: targetsSchema, required: true },
    // Devices the targets resolved to at trigger time.
    deviceIds: { type: [String], default: [] },
    status: { type: String, enum: ["active", "cleared"], default: "active", required: true },
    startedByName: { type: String, required: true },
    clearedByName: { type: String },
    clearedAt: { type: Date },
  },
  { timestamps: true },
);

emergencySchema.index({ createdAt: -1 });
emergencySchema.index({ status: 1 });

export const EmergencyModel = model("Emergency", emergencySchema);
