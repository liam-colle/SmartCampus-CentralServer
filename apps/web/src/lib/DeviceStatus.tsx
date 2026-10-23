import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import { DEVICE_TYPE_LABEL, type Device, type DeviceType, type EnrollmentRequest } from "./types";

export interface Notice {
  key: string;
  kind: "offline" | "request";
  deviceId: string;
  /** Device name, or what a new device calls itself. */
  name: string;
}

interface DeviceStatusState {
  /** Ids of devices connected right now, from the live channel. null until the first snapshot. */
  online: Set<string> | null;
  /** True while the console channel (/ws/admin) is connected. */
  live: boolean;
  /** Connection requests waiting for a decision. */
  requests: EnrollmentRequest[];
  reloadRequests: () => void;
  notices: Notice[];
  dismiss: (key: string) => void;
  /** Bumped on every online/offline/enrollment event, so pages can refetch. */
  version: number;
}

const DeviceStatusContext = createContext<DeviceStatusState | null>(null);

function adminUrl() {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/admin`;
}

/**
 * Keeps one WebSocket to /ws/admin (same session cookie as the REST API) and exposes which devices
 * are online and which connection requests are waiting. Reconnects with backoff.
 */
export function DeviceStatusProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState<Set<string> | null>(null);
  const [live, setLive] = useState(false);
  const [requests, setRequests] = useState<EnrollmentRequest[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [version, setVersion] = useState(0);
  const known = useRef<Set<string> | null>(null);

  const reloadRequests = useCallback(() => {
    api<{ items: EnrollmentRequest[] }>("/devices/requests")
      .then((r) => setRequests(r.items))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;

    const bump = () => setVersion((v) => v + 1);
    const notify = (n: Omit<Notice, "key">) =>
      setNotices((all) => [{ ...n, key: `${n.kind}-${n.deviceId}-${Date.now()}` }, ...all].slice(0, 5));
    const update = (fn: (s: Set<string>) => void) => {
      const next = new Set(known.current ?? []);
      fn(next);
      known.current = next;
      setOnline(next);
      bump();
    };

    const connect = () => {
      ws = new WebSocket(adminUrl());
      ws.onopen = () => {
        attempt = 0;
        setLive(true);
        reloadRequests(); // anything that arrived while we were disconnected
      };
      ws.onmessage = (e) => {
        let msg: { type: string; deviceId?: string; deviceIds?: string[]; request?: EnrollmentRequest };
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        if (msg.type === "devices.online") {
          known.current = new Set(msg.deviceIds);
          setOnline(known.current);
          bump();
        } else if (msg.type === "device.online" && msg.deviceId) {
          update((s) => s.add(msg.deviceId!));
        } else if (msg.type === "device.offline" && msg.deviceId) {
          const id = msg.deviceId;
          update((s) => s.delete(id));
          // Only worth an alert for a device that is still supposed to be in service.
          api<Device>(`/devices/${id}`)
            .then((d) => d.status === "active" && notify({ kind: "offline", deviceId: id, name: d.name || id }))
            .catch(() => {});
        } else if (msg.type === "device.reported" || msg.type === "room.status.changed" || msg.type === "emergency.changed" || msg.type === "registration.card") {
          bump(); // open previews, room lists and card registrations refetch
        } else if (msg.type === "enrollment.requested" && msg.request) {
          const r = msg.request;
          setRequests((all) => (all.some((x) => x.id === r.id) ? all : [...all, r]));
          notify({ kind: "request", deviceId: r.id, name: r.name || DEVICE_TYPE_LABEL[r.type as DeviceType] || r.type });
        } else if (msg.type === "enrollment.resolved" && msg.deviceId) {
          const id = msg.deviceId;
          setRequests((all) => all.filter((x) => x.id !== id));
          setNotices((all) => all.filter((n) => !(n.kind === "request" && n.deviceId === id)));
          bump(); // an approved device now belongs in the list
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
  }, [reloadRequests]);

  const value = useMemo(
    () => ({
      online,
      live,
      requests,
      reloadRequests,
      notices,
      version,
      dismiss: (key: string) => setNotices((all) => all.filter((x) => x.key !== key)),
    }),
    [online, live, requests, reloadRequests, notices, version],
  );
  return <DeviceStatusContext.Provider value={value}>{children}</DeviceStatusContext.Provider>;
}

export function useDeviceStatus() {
  const ctx = useContext(DeviceStatusContext);
  if (!ctx) throw new Error("useDeviceStatus must be used inside <DeviceStatusProvider>");
  return ctx;
}

/** For components that also render for users without the live channel (staff). */
export function useOptionalDeviceStatus() {
  return useContext(DeviceStatusContext);
}
