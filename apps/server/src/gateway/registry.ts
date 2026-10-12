import { EventEmitter } from "node:events";
import type { DeviceConnection } from "./deviceConnection.js";

export interface RegistryEvents {
  online: [deviceId: string];
  offline: [deviceId: string];
}

/**
 * deviceId -> live connection. One connection per device: a new one replaces the old one.
 * Admin sockets subscribe to online/offline events.
 */
export class DeviceRegistry extends EventEmitter<RegistryEvents> {
  private readonly connections = new Map<string, DeviceConnection>();

  /** Registers `conn`. Returns the connection it replaced, if any (the caller closes it). */
  register(conn: DeviceConnection): DeviceConnection | undefined {
    const previous = this.connections.get(conn.deviceId);
    this.connections.set(conn.deviceId, conn);
    // The device stays "online" across a takeover, so no offline/online flap.
    if (!previous) this.emit("online", conn.deviceId);
    return previous;
  }

  /** Only removes `conn` if it is still the registered one (a replaced connection must not unregister its successor). */
  unregister(conn: DeviceConnection): void {
    if (this.connections.get(conn.deviceId) !== conn) return;
    this.connections.delete(conn.deviceId);
    this.emit("offline", conn.deviceId);
  }

  get(deviceId: string): DeviceConnection | undefined {
    return this.connections.get(deviceId);
  }

  isOnline(deviceId: string): boolean {
    return this.connections.has(deviceId);
  }

  onlineIds(): string[] {
    return [...this.connections.keys()];
  }
}

export const registry = new DeviceRegistry();
