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
