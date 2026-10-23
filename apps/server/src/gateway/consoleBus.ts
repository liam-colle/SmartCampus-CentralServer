import { EventEmitter } from "node:events";

export interface EnrollmentRequestEvent {
  id: string;
  type: string;
  name: string;
  fingerprint: string;
  ip: string | null;
  userAgent: string | null;
  requestedAt: Date | undefined;
  expiresAt: Date | null;
}

export interface ConsoleEvents {
  "enrollment.requested": [request: EnrollmentRequestEvent];
  "enrollment.resolved": [event: { deviceId: string; outcome: "approved" | "denied" }];
  "device.reported": [event: { deviceId: string }];
  "room.status.changed": [event: { roomId: string; status: string }];
}

/** Things that happen on the server and that open consoles should hear about at once. */
export const consoleBus = new EventEmitter<ConsoleEvents>();
