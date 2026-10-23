import { ulid } from "@smartcampus/protocol";
import { HttpError } from "../lib/errors.js";
import { recordAudit } from "../lib/audit.js";
import { DeviceModel } from "../models/device.js";
import { RegistrationSessionModel } from "../models/registrationSession.js";
import { UserModel, type PublicUser } from "../models/user.js";
import { enqueueCommand } from "./commands.js";

type Actor = Pick<PublicUser, "id" | "name">;

/**
 * A reader left in registration mode cannot open its maintenance menu, so the window is short and
 * closes by itself if the person walks away. Extend it by starting a new session.
 */
export const REGISTRATION_WINDOW_MS = 10 * 60_000;
/** Bounds the size of one session document. A class is far smaller than this. */
export const MAX_CARDS_PER_SESSION = 500;
/** How long a closed session stays readable (audit trail) before MongoDB removes it. */
const KEEP_AFTER_EXPIRY_MS = 24 * 3_600_000;
/** Commands for a registration window are useless once it has closed. */
const COMMAND_TTL_SECONDS = Math.ceil(REGISTRATION_WINDOW_MS / 1000);

/** Readers that have an NFC antenna. Faculty displays are screens only. */
export const READER_DEVICE_TYPES = ["access", "door"];

type SessionDoc = NonNullable<Awaited<ReturnType<typeof activeSessionOf>>>;

const isOpen = (session: { status: string; expiresAt: Date }) => session.status === "active" && session.expiresAt.getTime() > Date.now();

/** The session a reader is currently collecting for, if any. */
export async function activeSessionOf(deviceId: string) {
  const session = await RegistrationSessionModel.findOne({ deviceId, status: "active" }).sort({ createdAt: -1 });
  return session && isOpen(session) ? session : null;
}

/** Puts a reader into registration mode. Any session it already had is closed first. */
export async function startRegistration(deviceId: string, actor: Actor) {
  const device = await DeviceModel.findOne({ deviceId, status: "active" }, { type: 1 });
  if (!device) throw new HttpError(404, "Active device not found");
  if (!READER_DEVICE_TYPES.includes(device.type)) throw new HttpError(400, "This device has no card reader");

  await RegistrationSessionModel.updateMany({ deviceId, status: "active" }, { $set: { status: "closed" } });
  const expiresAt = new Date(Date.now() + REGISTRATION_WINDOW_MS);
  const session = await RegistrationSessionModel.create({
    sessionId: ulid(),
    deviceId,
    startedById: actor.id,
    startedByName: actor.name,
    expiresAt,
    removeAt: new Date(expiresAt.getTime() + KEEP_AFTER_EXPIRY_MS),
  });

  await enqueueCommand(
    deviceId,
    "registration.mode.set",
    { sessionId: session.sessionId, active: true, expiresAt: expiresAt.getTime() },
    COMMAND_TTL_SECONDS,
  );
  await recordAudit(actor, "registration.start", { type: "device", id: deviceId }, { sessionId: session.sessionId });
  return session;
}

/** Ends the session and takes the reader out of registration mode. Collected cards stay readable. */
export async function stopRegistration(sessionId: string, actor: Actor) {
  const session = await RegistrationSessionModel.findOneAndUpdate(
    { sessionId, status: "active" },
    { $set: { status: "closed" } },
    { new: true },
  );
  if (!session) throw new HttpError(404, "Active registration session not found");

  await enqueueCommand(session.deviceId, "registration.mode.set", { sessionId, active: false }, COMMAND_TTL_SECONDS);
  await recordAudit(actor, "registration.stop", { type: "device", id: session.deviceId }, {
    sessionId,
    cards: session.cards.length,
  });
  return session;
}

export type CaptureOutcome = "captured" | "duplicate" | "already_registered" | "rate_limited";

/** Records a card presented to a reader in registration mode. */
export async function captureCard(
  session: SessionDoc,
  cardUid: string,
): Promise<{ outcome: CaptureOutcome; ownerName?: string }> {
  const owner = await UserModel.findOne({ cardUid }, { name: 1 });
  if (owner) return { outcome: "already_registered", ownerName: owner.name };
  if (session.cards.some((c) => c.uid === cardUid)) return { outcome: "duplicate" };
  if (session.cards.length >= MAX_CARDS_PER_SESSION) return { outcome: "rate_limited" };

  // The filter repeats the checks above so two quick taps of the same card cannot both be stored.
  const pushed = await RegistrationSessionModel.updateOne(
    { sessionId: session.sessionId, status: "active", "cards.uid": { $ne: cardUid } },
    { $push: { cards: { uid: cardUid, scannedAt: new Date() } } },
  );
  return { outcome: pushed.modifiedCount === 1 ? "captured" : "duplicate" };
}

/** Collected cards with, for each, the person who already owns it (a card can be enrolled in between). */
export async function describeSession(session: SessionDoc) {
  const owners = await UserModel.find({ cardUid: { $in: session.cards.map((c) => c.uid) } }, { name: 1, cardUid: 1 }).lean();
  const ownerByCard = new Map(owners.map((o) => [o.cardUid, o.name]));
  return {
    id: session.sessionId,
    deviceId: session.deviceId,
    status: session.status === "active" && !isOpen(session) ? "closed" : session.status,
    expiresAt: session.expiresAt,
    startedBy: session.startedByName,
    cards: session.cards.map((c) => ({ cardUid: c.uid, scannedAt: c.scannedAt, ownerName: ownerByCard.get(c.uid) ?? null })),
  };
}
