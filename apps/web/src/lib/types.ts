export type Role = "admin" | "operator" | "staff";

export const ROLE_LABEL: Record<Role, string> = { admin: "Admin", operator: "Operator", staff: "Staff" };

export const ROOM_TYPES = ["classroom", "lecture_hall", "lab", "office", "meeting", "other"] as const;
export type RoomType = (typeof ROOM_TYPES)[number];
export const ROOM_TYPE_LABEL: Record<RoomType, string> = {
  classroom: "Classroom",
  lecture_hall: "Lecture hall",
  lab: "Lab",
  office: "Office",
  meeting: "Meeting room",
  other: "Other",
};

export interface Building {
  id: string;
  code: string;
  name: string;
  address: string;
  roomCount?: number;
}

export interface Room {
  id: string;
  /** Key of a RoomStatusDef. */
  status: string;
  statusSince: string | null;
  code: string;
  name: string;
  floor: number;
  capacity: number | null;
  type: RoomType;
  building: { id: string; code: string; name: string };
}

export interface StaffMember {
  id: string;
  email: string;
  name: string;
  role: Role;
  department: string;
  jobTitle: string;
  phone: string;
  disabled: boolean;
  hasPassword: boolean;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface ImportResult {
  dryRun: boolean;
  total: number;
  created: number;
  updated: number;
  errors: { line: number; message: string }[];
}

export const floorLabel = (f: number) => (f === 0 ? "Ground floor" : f < 0 ? `Basement ${-f}` : `Floor ${f}`);

export const DEVICE_TYPES = ["door", "display", "access"] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];
export const DEVICE_TYPE_LABEL: Record<DeviceType, string> = {
  door: "Door unit",
  display: "Faculty display",
  access: "Access unit",
};

export interface Device {
  id: string;
  type: DeviceType;
  name: string;
  status: "active" | "revoked" | "pending" | "denied";
  fingerprint: string;
  /** Mongo id of the room this device is assigned to. */
  room: string | null;
  groups: string[];
  desired: Record<string, unknown>;
  reported: Record<string, unknown>;
  telemetry: Record<string, unknown>;
  online: boolean;
  lastSeenAt: string | null;
  createdAt: string;
}

/** A device asking to be connected, waiting for an admin or operator to approve or deny it. */
export interface EnrollmentRequest {
  id: string;
  type: DeviceType;
  name: string;
  fingerprint: string;
  ip: string | null;
  userAgent: string | null;
  requestedAt: string;
  expiresAt: string | null;
}

export interface DeviceCommand {
  id: string;
  type: string;
  payload: unknown;
  status: "pending" | "sent" | "acked" | "nacked" | "superseded";
  attempts: number;
  nackReason: string | null;
  createdAt: string;
  ackedAt: string | null;
}

export const formatFingerprint = (fp: string) => (fp.toUpperCase().match(/.{1,4}/g) ?? []).join(" ");

/** Where the device state differs from what was asked: the digital twin has not converged. */
export function computeDrift(d: Pick<Device, "desired" | "reported">): { key: string; desired: unknown; reported: unknown }[] {
  const drift: { key: string; desired: unknown; reported: unknown }[] = [];
  const desiredRoom = (d.desired.roomStatus as { status?: string } | undefined)?.status;
  if (desiredRoom !== undefined && desiredRoom !== d.reported.roomStatus) {
    drift.push({ key: "roomStatus", desired: desiredRoom, reported: d.reported.roomStatus });
  }
  if (d.desired.displayConfig !== undefined && JSON.stringify(d.desired.displayConfig) !== JSON.stringify(d.reported.displayConfig)) {
    drift.push({ key: "displayConfig", desired: d.desired.displayConfig, reported: d.reported.displayConfig });
  }
  return drift;
}

export const timeLeft = (iso: string | null): string => {
  if (!iso) return "";
  const m = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  return m <= 0 ? "expiring" : m < 60 ? `${m} min left` : `${Math.round(m / 60)} h left`;
};

export const timeAgo = (iso: string | null): string => {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
};

// ---- Room statuses, announcements, audio, display config ----------------------------------

/** Mirrors STATUS_ICONS of @smartcampus/protocol (the package uses node:crypto, so the browser cannot import it). */
export const STATUS_ICONS = ["check", "user", "lock", "wrench", "calendar", "clock", "alert", "info", "book", "coffee", "ban", "wifi-off"] as const;
export type StatusIconName = (typeof STATUS_ICONS)[number];

export interface RoomStatusDef {
  key: string;
  label: string;
  color: string;
  icon: StatusIconName;
  builtIn: boolean;
}

export interface StatusChange {
  id: string;
  from: string;
  to: string;
  label: string;
  color: string;
  by: string;
  at: string;
}

export const ANNOUNCE_PRIORITIES = ["info", "important", "urgent"] as const;
export type AnnouncePriority = (typeof ANNOUNCE_PRIORITIES)[number];
export const PRIORITY_LABEL: Record<AnnouncePriority, string> = { info: "Info", important: "Important", urgent: "Urgent" };

export interface Targets {
  all?: boolean;
  devices?: string[];
  groups?: string[];
  buildings?: string[];
  floors?: { building: string; floor: number }[];
}

export interface Announcement {
  id: string;
  kind: "text" | "audio";
  assetId: string | null;
  title: string;
  text: string;
  priority: AnnouncePriority;
  targets: Targets;
  deviceCount: number;
  expiresAt: string | null;
  state: "active" | "expired" | "cancelled";
  createdBy: string;
  createdAt: string;
}

export interface Asset {
  id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  createdBy: string;
  createdAt: string;
}

export interface TimeWindow {
  enabled: boolean;
  from: string;
  to: string;
}

export interface DisplayConfig {
  layout: "standard" | "compact" | "split";
  theme: "dark" | "light";
  accentColor: string;
  show: { roomName: boolean; building: boolean; floor: boolean; capacity: boolean; clock: boolean; announcements: boolean };
  sleep: TimeWindow;
}

export const DEFAULT_DISPLAY_CONFIG: DisplayConfig = {
  layout: "standard",
  theme: "dark",
  accentColor: "#00a86b",
  show: { roomName: true, building: true, floor: true, capacity: true, clock: true, announcements: true },
  sleep: { enabled: false, from: "22:00", to: "06:00" },
};

export interface AudioSettings {
  volume: number;
  quietHours: TimeWindow;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = { volume: 80, quietHours: { enabled: false, from: "22:00", to: "06:00" } };

/** True when `now` falls in the window; a window whose start is after its end crosses midnight. */
export function isInWindow(w: TimeWindow, now: Date = new Date()): boolean {
  if (!w.enabled) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const from = toMinutes(w.from);
  const to = toMinutes(w.to);
  return from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

export const formatBytes = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
