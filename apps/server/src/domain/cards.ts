import { z } from "zod";
import { HttpError } from "../lib/errors.js";
import { UserModel } from "../models/user.js";

/**
 * Readers report the serial number in whatever notation they like ("04:a2:2b:1c", "04-A2-2B-1C",
 * "04A22B1C"). Stored and compared as upper-case hex without separators.
 * ISO 14443 UIDs are 4, 7 or 10 bytes, hence 8, 14 or 20 hex digits.
 */
const CARD_UID_PATTERN = /^([0-9A-F]{8}|[0-9A-F]{14}|[0-9A-F]{20})$/;

export function normalizeCardUid(raw: string): string | null {
  const uid = raw.replace(/[\s:-]/g, "").toUpperCase();
  return CARD_UID_PATTERN.test(uid) ? uid : null;
}

/** For request bodies: accepts any notation, yields the normalised form. */
export const cardUidSchema = z
  .string()
  .max(40)
  .transform((raw, ctx) => {
    const uid = normalizeCardUid(raw);
    if (!uid) ctx.addIssue({ code: "custom", message: "Not a card serial number (expected 4, 7 or 10 bytes in hex)" });
    return uid ?? z.NEVER;
  });

/** Refuses a card that already identifies someone else. */
export async function assertCardFree(cardUid: string, exceptUserId?: string): Promise<void> {
  const owner = await UserModel.findOne({ cardUid }, { name: 1 });
  if (owner && owner.id !== exceptUserId) throw new HttpError(409, `This card already belongs to ${owner.name}`);
}
