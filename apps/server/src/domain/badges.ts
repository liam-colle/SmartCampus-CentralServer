import type { CardOutcome } from "@smartcampus/protocol";
import { AttemptLimiter } from "../gateway/rateLimit.js";
import { consoleBus } from "../gateway/consoleBus.js";
import { recordAudit } from "../lib/audit.js";
import { DeviceModel } from "../models/device.js";
import { UserModel, isPrivileged, type Group } from "../models/user.js";
import { normalizeCardUid } from "./cards.js";
import { menuFor, openGrant } from "./maintenance.js";
import { READER_DEVICE_TYPES, activeSessionOf, captureCard } from "./registration.js";

/**
 * Cards a single reader may present per minute before it is told to slow down. A serial number is
 * not a secret, so this is what keeps a device from probing the user table for valid ones.
 */
const BADGES_PER_MINUTE = 30;
const limiter = new AttemptLimiter(BADGES_PER_MINUTE, 60_000);

export interface CardDecision {
  outcome: CardOutcome;
  /** True only for an enabled admin or operator: the reader opens its maintenance menu. */
  maintenance: boolean;
  name?: string;
  menu?: Awaited<ReturnType<typeof menuFor>>;
}

const rejected = (outcome: CardOutcome): CardDecision => ({ outcome, maintenance: false });

/**
 * Decides what a presented card means. In registration mode it is collected, otherwise it is looked
 * up: admins and operators open the maintenance menu, anyone else is simply recognised.
 *
 * Why the decision lives here and not on the reader: the group list changes in the console, and a
 * reader that decided by itself would keep opening the menu for someone removed from the group.
 * The cost is that the menu needs the link to the server.
 */
export async function decideCard(deviceId: string, rawUid: string): Promise<CardDecision> {
  if (!limiter.allow(deviceId)) return rejected("rate_limited");

  const device = await DeviceModel.findOne({ deviceId, status: "active" }, { type: 1 });
  const cardUid = normalizeCardUid(rawUid);
  if (!device || !READER_DEVICE_TYPES.includes(device.type) || !cardUid) return rejected("unknown");

  const session = await activeSessionOf(deviceId);
  if (session) {
    const { outcome, ownerName } = await captureCard(session, cardUid);
    consoleBus.emit("registration.card", { sessionId: session.sessionId, deviceId, cardUid, outcome, ownerName });
    return rejected(outcome);
  }

  const user = await UserModel.findOne({ cardUid });
  if (!user) return rejected("unknown");
  if (user.disabled) return rejected("disabled");

  if (isPrivileged(user.groups as Group[])) {
    await recordAudit({ id: user.id, name: user.name }, "maintenance.open", { type: "device", id: deviceId });
    openGrant(deviceId, { id: user.id, name: user.name });
    return { outcome: "maintenance", maintenance: true, name: user.name, menu: await menuFor(user.groups as Group[]) };
  }
  return { outcome: "recognised", maintenance: false, name: user.name };
}
