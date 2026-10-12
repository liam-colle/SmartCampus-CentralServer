import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { HttpError } from "./errors.js";

/** Validates a :id route param; malformed ids are simply "not found". */
export function objectId(id: unknown): string {
  if (typeof id !== "string" || !isValidObjectId(id)) throw new HttpError(404, "Not found");
  return id;
}

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Optional free-text field. An empty string clears the value on PATCH. */
export const optionalText = (max: number) => z.string().trim().max(max).optional();

export const passwordSchema = z.string().min(10, "At least 10 characters").max(128);
