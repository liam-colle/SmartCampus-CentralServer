import { fingerprint, loadPublicKey } from "@smartcampus/handshake";
import { CloseCode, ulid } from "@smartcampus/protocol";
import { config } from "../config.js";
import { HttpError } from "../lib/errors.js";
import { DeviceModel, requestDto, type DeviceDoc, type DeviceType } from "../models/device.js";
import { consoleBus } from "../gateway/consoleBus.js";
import { registry } from "../gateway/registry.js";

/** A denied request is remembered this long, so the same key cannot keep re-asking. */
const DENIED_RETENTION_MS = 60 * 60_000;

/**
 * Step 1, called by the device on first boot. It sends only its PUBLIC key (the private key never
 * leaves it) and waits. The request shows up in the console, where an admin approves or denies it.
 * Asking again with the same key while the request is pending returns the same request, so a device
 * that lost the response can simply retry.
 */
export async function requestEnrollment(input: {
  publicKey: string;
  type: DeviceType;
  name?: string;
  ip?: string;
  userAgent?: string;
}) {
  let fp: string;
  try {
    loadPublicKey(input.publicKey);
    fp = fingerprint(input.publicKey);
  } catch {
    throw new HttpError(400, "publicKey must be an ECDSA P-256 SPKI public key (base64 DER)");
  }

  const now = new Date();
  const existing = await DeviceModel.findOne({ fingerprint: fp });
  if (existing) {
    const expired = existing.enrollExpiresAt && existing.enrollExpiresAt <= now;
    if (existing.status === "pending" && !expired) {
      return { deviceId: existing.deviceId, fingerprint: fp, expiresAt: existing.enrollExpiresAt! };
    }
    if (existing.status === "denied" && !expired) throw new HttpError(403, "This request was denied");
    if (existing.status === "active" || existing.status === "revoked") {
      throw new HttpError(409, "This key is already enrolled. Generate a new key pair to enroll again.");
    }
    await existing.deleteOne(); // expired request: the same key may ask again
  }

  const waiting = await DeviceModel.countDocuments({ status: "pending", enrollExpiresAt: { $gt: now } });
  if (waiting >= config.MAX_PENDING_ENROLLMENTS) throw new HttpError(429, "Too many pending requests, try again later");

  const device = await DeviceModel.create({
    deviceId: ulid(),
    type: input.type,
    name: input.name ?? "",
    publicKey: input.publicKey,
    fingerprint: fp,
    enrollExpiresAt: new Date(now.getTime() + config.ENROLL_REQUEST_TTL_MINUTES * 60_000),
    requestIp: input.ip,
    requestUserAgent: input.userAgent?.slice(0, 200),
  });
  consoleBus.emit("enrollment.requested", requestDto(device));
  return { deviceId: device.deviceId, fingerprint: fp, expiresAt: device.enrollExpiresAt! };
}

/** What a device may learn about its own request (it knows its unguessable id). */
export async function enrollmentStatus(
  deviceId: string,
): Promise<"pending" | "active" | "denied" | "revoked" | "expired" | "unknown"> {
  const d = await DeviceModel.findOne({ deviceId }, { status: 1, enrollExpiresAt: 1 });
  if (!d) return "unknown";
  if ((d.status === "pending" || d.status === "denied") && d.enrollExpiresAt && d.enrollExpiresAt <= new Date()) {
    return d.status === "pending" ? "expired" : "unknown";
  }
  return d.status;
}

export function listPendingRequests() {
  return DeviceModel.find({ status: "pending", enrollExpiresAt: { $gt: new Date() } }).sort({ createdAt: 1 });
}

/** Step 2a, from the console: the device becomes active and can complete the handshake. */
export async function approveRequest(
  deviceId: string,
  input: { name?: string; room?: string; groups?: string[] },
): Promise<DeviceDoc> {
  const set: Record<string, unknown> = { status: "active" };
  if (input.name) set.name = input.name;
  if (input.room) set.room = input.room;
  if (input.groups) set.groups = input.groups;

  // Atomic: a request can only be resolved once, and only while it has not expired.
  const device = await DeviceModel.findOneAndUpdate(
    { deviceId, status: "pending", enrollExpiresAt: { $gt: new Date() } },
    { $set: set, $unset: { enrollExpiresAt: 1 } },
    { new: true },
  );
  if (!device) throw new HttpError(404, "Request not found or expired");
  if (!device.name) {
    device.name = device.deviceId;
    await device.save();
  }
  consoleBus.emit("enrollment.resolved", { deviceId, outcome: "approved" });
  return device;
}

/** Step 2b: refuse. The record stays for a while so the same key cannot immediately ask again. */
export async function denyRequest(deviceId: string): Promise<DeviceDoc> {
  const device = await DeviceModel.findOneAndUpdate(
    { deviceId, status: "pending", enrollExpiresAt: { $gt: new Date() } },
    { $set: { status: "denied", enrollExpiresAt: new Date(Date.now() + DENIED_RETENTION_MS) } },
    { new: true },
  );
  if (!device) throw new HttpError(404, "Request not found or expired");
  consoleBus.emit("enrollment.resolved", { deviceId, outcome: "denied" });
  return device;
}

/** Closes the live socket immediately; later handshakes are refused because the device is not active. */
export async function revokeDevice(deviceId: string): Promise<DeviceDoc> {
  const device = await DeviceModel.findOneAndUpdate(
    { deviceId },
    { status: "revoked", $unset: { enrollExpiresAt: 1 } },
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
  consoleBus.emit("device.reported", { deviceId });
}

export async function touchLastSeen(deviceId: string): Promise<void> {
  await DeviceModel.updateOne({ deviceId }, { $set: { lastSeenAt: new Date() } });
}
