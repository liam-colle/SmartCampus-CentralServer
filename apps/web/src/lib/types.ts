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
  status: "active" | "revoked" | "pending";
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

export interface DeviceCommand {
  id: string;
  type: string;
  payload: unknown;
  status: "pending" | "sent" | "acked" | "nacked";
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

export const timeAgo = (iso: string | null): string => {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
};
