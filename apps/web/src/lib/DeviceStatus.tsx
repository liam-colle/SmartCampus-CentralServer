import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import type { Device } from "./types";

export interface OfflineAlert {
  key: string;
  deviceId: string;
  name: string;
  at: number;
}

interface DeviceStatusState {
  /** Ids of devices connected right now, from the live channel. null until the first snapshot. */
  online: Set<string> | null;
  /** True while the console channel (/ws/admin) is connected. */
  live: boolean;
  alerts: OfflineAlert[];
  dismiss: (key: string) => void;
  /** Bumped on every online/offline event, so pages can refetch. */
  version: number;
}

const DeviceStatusContext = createContext<DeviceStatusState | null>(null);

function adminUrl() {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/admin`;
}

/**
 * Keeps one WebSocket to /ws/admin (same session cookie as the REST API) and exposes which devices
 * are online. Reconnects with backoff. Raises an alert when a device that was online goes offline.
 */
export function DeviceStatusProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState<Set<string> | null>(null);
  const [live, setLive] = useState(false);
  const [alerts, setAlerts] = useState<OfflineAlert[]>([]);
  const [version, setVersion] = useState(0);
  const known = useRef<Set<string> | null>(null);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;

    const update = (fn: (s: Set<string>) => void) => {
      const next = new Set(known.current ?? []);
      fn(next);
      known.current = next;
      setOnline(next);
      setVersion((v) => v + 1);
    };

    const connect = () => {
      ws = new WebSocket(adminUrl());
      ws.onopen = () => {
        attempt = 0;
        setLive(true);
      };
      ws.onmessage = (e) => {
        let msg: { type: string; deviceId?: string; deviceIds?: string[] };
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        if (msg.type === "devices.online") {
          known.current = new Set(msg.deviceIds);
          setOnline(known.current);
          setVersion((v) => v + 1);
        } else if (msg.type === "device.online" && msg.deviceId) {
          update((s) => s.add(msg.deviceId!));
        } else if (msg.type === "device.offline" && msg.deviceId) {
          const id = msg.deviceId;
          update((s) => s.delete(id));
          // Only worth an alert for a device that is still supposed to be in service.
          api<Device>(`/devices/${id}`)
            .then((d) => {
              if (d.status !== "active") return;
              setAlerts((a) => [{ key: `${id}-${Date.now()}`, deviceId: id, name: d.name || id, at: Date.now() }, ...a].slice(0, 5));
            })
            .catch(() => {});
        }
      };
      ws.onclose = () => {
        setLive(false);
        known.current = null;
        setOnline(null); // unknown again: pages fall back to the REST value
        if (stopped) return;
        timer = setTimeout(connect, Math.min(1000 * 2 ** attempt++, 30_000) * (0.5 + Math.random() / 2));
      };
    };
    connect();

    return () => {
      stopped = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, []);

  const value = useMemo(
    () => ({ online, live, alerts, version, dismiss: (key: string) => setAlerts((a) => a.filter((x) => x.key !== key)) }),
    [online, live, alerts, version],
  );
  return <DeviceStatusContext.Provider value={value}>{children}</DeviceStatusContext.Provider>;
}

export function useDeviceStatus() {
  const ctx = useContext(DeviceStatusContext);
  if (!ctx) throw new Error("useDeviceStatus must be used inside <DeviceStatusProvider>");
  return ctx;
}
