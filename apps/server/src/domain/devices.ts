import { createHash, randomInt } from "node:crypto";
import { fingerprint, loadPublicKey } from "@smartcampus/handshake";
import { CloseCode, ulid } from "@smartcampus/protocol";
import { config } from "../config.js";
import { HttpError } from "../lib/errors.js";
import { DeviceModel, type DeviceDoc, type DeviceType } from "../models/device.js";
import { registry } from "../gateway/registry.js";

// No 0/O, 1/I/L: the code is read from a screen and typed by a person.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

const hashCode = (code: string) =>
  createHash("sha256").update(code.toUpperCase().replace(/[\s-]/g, "")).digest("hex");

const newCode = () => Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");

const normalizeFingerprint = (fp: string) => fp.toLowerCase().replace(/[^0-9a-f]/g, "");

/**
 * Step 1, called by the device on first boot. It sends only its PUBLIC key; the private key never leaves it.
 * The device then shows `code` and `fingerprint` so an admin can confirm them in the console.
 */
export async function requestEnrollment(input: { publicKey: string; type: DeviceType; name?: string }) {
  let fp: string;
  try {
    loadPublicKey(input.publicKey);
    fp = fingerprint(input.publicKey);
  } catch {
    throw new HttpError(400, "publicKey must be an ECDSA P-256 SPKI public key (base64 DER)");
  }
  if (await DeviceModel.exists({ fingerprint: fp })) {
    throw new HttpError(409, "This key is already enrolled. Generate a new key pair to re-enroll.");
  }

  const code = newCode();
  const enrollExpiresAt = new Date(Date.now() + config.ENROLL_CODE_TTL_MINUTES * 60_000);
  const device = await DeviceModel.create({
    deviceId: ulid(),
    type: input.type,
    name: input.name ?? "",
    publicKey: input.publicKey,
    fingerprint: fp,
    enrollCodeHash: hashCode(code),
    enrollExpiresAt,
  });
  return { deviceId: device.deviceId, code, fingerprint: fp, expiresAt: enrollExpiresAt };
}

/** What a device may learn about its own enrollment (it knows its unguessable id). */
export async function enrollmentStatus(deviceId: string): Promise<"pending" | "active" | "revoked" | "unknown"> {
  const d = await DeviceModel.findOne({ deviceId }, { status: 1, enrollExpiresAt: 1 });
  if (!d) return "unknown";
  if (d.status === "pending" && d.enrollExpiresAt && d.enrollExpiresAt < new Date()) return "unknown";
  return d.status;
}

/**
 * Step 2, called by an admin from the console. Requiring the fingerprint forces the admin to compare
 * it with the one shown on the device, which protects against a swapped public key at enrollment.
 */
export async function approveEnrollment(input: {
  code: string;
  fingerprint: string;
  name: string;
  room?: string;
  groups?: string[];
}): Promise<DeviceDoc> {
  const device = await DeviceModel.findOne({
    status: "pending",
    enrollCodeHash: hashCode(input.code),
    enrollExpiresAt: { $gt: new Date() },
  });
  if (!device) throw new HttpError(404, "Unknown or expired enrollment code");
  if (normalizeFingerprint(input.fingerprint) !== device.fingerprint) {
    throw new HttpError(400, "The fingerprint does not match the one shown by the device");
  }

  device.status = "active";
  device.name = input.name;
  if (input.room) device.room = input.room as never;
  if (input.groups) device.groups = input.groups;
  device.enrollCodeHash = undefined;
  device.enrollExpiresAt = undefined;
  await device.save(); // single use: the code no longer exists
  return device;
}

/** Closes the live socket immediately; later handshakes are refused because the device is not active. */
export async function revokeDevice(deviceId: string): Promise<DeviceDoc> {
  const device = await DeviceModel.findOneAndUpdate(
    { deviceId },
    { status: "revoked", $unset: { enrollCodeHash: 1, enrollExpiresAt: 1 } },
    { new: true },
  );
  if (!device) throw new HttpError(404, "Device not found");
  registry.get(deviceId)?.close(CloseCode.Revoked, "revoked");
  return device;
}

/** Public key used to verify the handshake. Only active devices can authenticate. */
export async function activePublicKey(deviceId: string): Promise<string | null> {
  const d = await DeviceModel.findOne({ deviceId, status: "active" }, { publicKey: 1 });
  return d?.publicKey ?? null;
}

export async function desiredState(deviceId: string): Promise<Record<string, unknown>> {
  const d = await DeviceModel.findOne({ deviceId }, { desired: 1 });
  return (d?.desired as Record<string, unknown> | undefined) ?? {};
}

/** Merges into the desired state (the digital twin target). */
export async function patchDesired(deviceId: string, patch: Record<string, unknown>): Promise<void> {
  const set = Object.fromEntries(Object.entries(patch).map(([k, v]) => [`desired.${k}`, v]));
  await DeviceModel.updateOne({ deviceId }, { $set: set });
}

export async function recordReport(
  deviceId: string,
  state: Record<string, unknown>,
  telemetry?: Record<string, unknown>,
): Promise<void> {
  await DeviceModel.updateOne(
    { deviceId },
    { $set: { reported: state, ...(telemetry && { telemetry }), lastSeenAt: new Date() } },
  );
}

export async function touchLastSeen(deviceId: string): Promise<void> {
  await DeviceModel.updateOne({ deviceId }, { $set: { lastSeenAt: new Date() } });
}
