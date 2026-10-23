import { Schema, model } from "mongoose";

/**
 * Who did what, and when. Entries are only ever appended. `meta` holds small, non-secret facts
 * (ids, names, counts), never passwords, tokens or key material.
 */
const auditLogSchema = new Schema({
  at: { type: Date, default: () => new Date(), index: true },
  actorId: { type: String },
  actorName: { type: String, required: true },
  action: { type: String, required: true, index: true },
  targetType: { type: String, required: true },
  targetId: { type: String, required: true },
  meta: { type: Schema.Types.Mixed, default: {} },
});

export const AuditLogModel = model("AuditLog", auditLogSchema);
