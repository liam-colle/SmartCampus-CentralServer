import type { MaintenanceAction } from "@smartcampus/protocol";
import { recordAudit } from "../lib/audit.js";
import { DeviceModel } from "../models/device.js";
import { RoomStatusModel } from "../models/roomStatus.js";
import { UserModel, roleOf, type Group } from "../models/user.js";
import { revokeDevice } from "./devices.js";
import { setRoomStatus } from "./roomStatus.js";

/**
 * A card opens a grant on the connection it was read on. The menu's actions are only honoured inside
 * it, so the card is checked once and not on every button, and a device that was not shown the menu
 * cannot ask for its actions. The grant is sliding and short: the menu itself closes after a minute idle.
 */
const GRANT_TTL_MS = 2 * 60_000;

interface Grant {
  userId: string;
  userName: string;
  expiresAt: number;
}

const grants = new Map<string, Grant>();

export function openGrant(deviceId: string, user: { id: string; name: string }, now = Date.now()): void {
  grants.set(deviceId, { userId: user.id, userName: user.name, expiresAt: now + GRANT_TTL_MS });
}

/** Called when the device disconnects: a menu does not survive the link it was opened on. */
export function closeGrant(deviceId: string): void {
  grants.delete(deviceId);
}

/** The menu shown with an accepted card: every status the person may choose, and whether they may revoke. */
export async function menuFor(groups: readonly Group[]) {
  const statuses = await RoomStatusModel.find({}, { key: 1, label: 1, color: 1, icon: 1 }).sort({ builtIn: -1, label: 1 }).lean();
  return {
    statuses: statuses.map((s) => ({ key: s.key, label: s.label, color: s.color, icon: s.icon })),
    canRevoke: roleOf(groups as Group[]) === "admin",
  };
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const refuse = (error: string): ActionResult => ({ ok: false, error });

/** Runs one menu action for the person who opened the grant. Re-checks them: they may have been removed meanwhile. */
export async function runMaintenanceAction(
  deviceId: string,
  action: MaintenanceAction,
  status: string | undefined,
  now = Date.now(),
): Promise<ActionResult> {
  const grant = grants.get(deviceId);
  if (!grant || grant.expiresAt <= now) {
    grants.delete(deviceId);
    return refuse("The maintenance session expired. Present the card again");
  }
  const user = await UserModel.findById(grant.userId);
  const role = user && !user.disabled ? roleOf(user.groups as Group[]) : "staff";
  if (role === "staff") {
    grants.delete(deviceId);
    return refuse("This card no longer gives access to the menu");
  }
  grant.expiresAt = now + GRANT_TTL_MS;

  const actor = { id: grant.userId, name: grant.userName };
  const target = { type: "device", id: deviceId };

  if (action === "restart") {
    await recordAudit(actor, "maintenance.restart", target);
    return { ok: true };
  }
  if (action === "revoke") {
    if (role !== "admin") return refuse("Only an administrator can revoke a terminal");
    await recordAudit(actor, "maintenance.revoke", target);
    grants.delete(deviceId);
    // The device is told by the closing socket; the answer to the action is sent before it.
    setImmediate(() => void revokeDevice(deviceId).catch((err) => console.error("revoke failed", err)));
    return { ok: true };
  }
  if (!status) return refuse("Choose a status");
  const device = await DeviceModel.findOne({ deviceId, status: "active" }, { room: 1 });
  if (!device?.room) return refuse("This terminal is not linked to a room");
  try {
    await setRoomStatus(String(device.room), status, actor);
  } catch (err) {
    return refuse(err instanceof Error ? err.message : "Could not change the status");
  }
  return { ok: true };
}
