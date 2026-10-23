import type { PublicUser } from "../models/user.js";
import { AuditLogModel } from "../models/auditLog.js";

export interface AuditTarget {
  type: string;
  id: string;
}

/**
 * Appends an audit entry. A failure to write is logged but never blocks the action itself:
 * refusing to change a room status or send an alert because the log is down would be worse.
 */
export async function recordAudit(
  actor: Pick<PublicUser, "id" | "name"> | null,
  action: string,
  target: AuditTarget,
  meta: Record<string, unknown> = {},
): Promise<void> {
  try {
    await AuditLogModel.create({
      actorId: actor?.id,
      actorName: actor?.name ?? "system",
      action,
      targetType: target.type,
      targetId: target.id,
      meta,
    });
  } catch (err) {
    console.error(`audit write failed for ${action}`, err instanceof Error ? err.message : err);
  }
}
