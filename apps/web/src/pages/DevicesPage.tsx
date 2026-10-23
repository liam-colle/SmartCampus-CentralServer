import { Check, PlugZap, Radio, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ConnectionBadge } from "@/components/DeviceBadges";
import { ErrorText } from "@/components/Field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { useDeviceStatus } from "@/lib/DeviceStatus";
import {
  computeDrift,
  DEVICE_TYPE_LABEL,
  formatFingerprint,
  timeAgo,
  timeLeft,
  type Device,
  type EnrollmentRequest,
  type Page,
  type Room,
} from "@/lib/types";
import { useFetch, useOnChange } from "@/lib/useFetch";

export function useRoomOptions() {
  const rooms = useFetch<Page<Room>>("/rooms?limit=200");
  const items = rooms.data?.items ?? [];
  const label = (id: string | null) => {
    const r = items.find((x) => x.id === id);
    return r ? `${r.building.code} ${r.code}` : "";
  };
  return { items, label, truncated: (rooms.data?.total ?? 0) > items.length };
}

export function DevicesPage() {
  const status = useDeviceStatus();
  const devices = useFetch<{ items: Device[] }>("/devices");
  const rooms = useRoomOptions();

  // Refetch when a device connects or disconnects, or a request is resolved, so the list stays fresh.
  useOnChange(status.version, devices.reload);

  const items = devices.data?.items ?? [];
  const isOnline = (d: Device) => (status.online ? status.online.has(d.id) : d.online);
  const onlineCount = useMemo(() => items.filter((d) => d.status === "active" && isOnline(d)).length, [items, status.online]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = items.filter((d) => d.status === "active").length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Devices</h1>
        <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
          <Radio className={status.live ? "size-4 text-primary" : "size-4"} />
          {status.live ? `Live: ${onlineCount} of ${active} online` : "Live updates unavailable, showing the last known state"}
        </p>
      </div>

      <section aria-labelledby="requests-title" className="flex flex-col gap-3">
        <h2 id="requests-title" className="flex items-center gap-2 text-base font-semibold">
          <PlugZap className="size-5" /> Connection requests
          {status.requests.length > 0 && <Badge>{status.requests.length}</Badge>}
        </h2>
        {status.requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No device is waiting. When a new device is started it asks to connect and appears here at once, ready to approve or deny.
          </p>
        ) : (
          status.requests.map((r) => <RequestCard key={r.id} request={r} rooms={rooms.items} onDone={status.reloadRequests} />)
        )}
      </section>

      <ErrorText>{devices.error}</ErrorText>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Room</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last seen</TableHead>
            <TableHead>State</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((d) => {
            const online = isOnline(d);
            const drift = computeDrift(d);
            return (
              <TableRow key={d.id} className={d.status === "revoked" ? "opacity-60" : undefined}>
                <TableCell>
                  <Link to={`/devices/${d.id}`} className="font-medium underline-offset-4 hover:underline">
                    {d.name || d.id}
                  </Link>
                  {d.groups.length > 0 && <div className="text-xs text-muted-foreground">{d.groups.join(", ")}</div>}
                </TableCell>
                <TableCell>{DEVICE_TYPE_LABEL[d.type]}</TableCell>
                <TableCell>{rooms.label(d.room) || "–"}</TableCell>
                <TableCell>
                  <ConnectionBadge status={d.status} online={online} />
                </TableCell>
                <TableCell className="text-muted-foreground">{online ? "now" : timeAgo(d.lastSeenAt)}</TableCell>
                <TableCell>
                  {d.status !== "active" ? "–" : drift.length === 0 ? <span className="text-muted-foreground">In sync</span> : <Badge variant="destructive">{drift.length} pending</Badge>}
                </TableCell>
              </TableRow>
            );
          })}
          {!devices.loading && items.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                No devices yet. Start a device and approve its connection request above.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

/** One device asking to connect. The fingerprint is there to compare with the one on the device's own screen. */
function RequestCard({ request, rooms, onDone }: { request: EnrollmentRequest; rooms: Room[]; onDone: () => void }) {
  const [name, setName] = useState(request.name);
  const [room, setRoom] = useState("");
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const label = request.name || DEVICE_TYPE_LABEL[request.type];

  async function resolve(action: "approve" | "deny") {
    if (action === "deny" && !confirm(`Deny the request from ${label}? That key cannot ask again for an hour.`)) return;
    setBusy(action);
    setError(null);
    try {
      await api(`/devices/requests/${request.id}/${action}`, {
        method: "POST",
        body: action === "approve" ? { ...(name.trim() && { name: name.trim() }), ...(room && { room }) } : {},
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(null);
      onDone(); // the request may have been answered by someone else meanwhile
    }
  }

  return (
    <Card className="gap-4 border-primary/40 py-5">
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-medium">
              {label} <Badge variant="muted">{DEVICE_TYPE_LABEL[request.type]}</Badge>
            </div>
            <dl className="mt-2 grid grid-cols-[6rem_1fr] gap-y-1 text-sm">
              <dt className="text-muted-foreground">Fingerprint</dt>
              <dd className="font-mono text-xs break-words">{formatFingerprint(request.fingerprint)}</dd>
              <dt className="text-muted-foreground">From</dt>
              <dd className="font-mono text-xs">{request.ip ?? "unknown address"}</dd>
              <dt className="text-muted-foreground">Requested</dt>
              <dd>
                {timeAgo(request.requestedAt)} <span className="text-muted-foreground">· {timeLeft(request.expiresAt)}</span>
              </dd>
            </dl>
          </div>
        </div>

        <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <div className="flex flex-col gap-2">
            <label htmlFor={`n-${request.id}`} className="text-sm font-medium">
              Name
            </label>
            <Input id={`n-${request.id}`} maxLength={100} placeholder={request.id} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor={`r-${request.id}`} className="text-sm font-medium">
              Room
            </label>
            <Select id={`r-${request.id}`} value={room} onChange={(e) => setRoom(e.target.value)}>
              <option value="">Not assigned</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.building.code} {r.code}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => void resolve("approve")} disabled={busy !== null}>
              <Check /> {busy === "approve" ? "Approving…" : "Approve"}
            </Button>
            <Button variant="outline" onClick={() => void resolve("deny")} disabled={busy !== null}>
              <X /> Deny
            </Button>
          </div>
        </div>
        <ErrorText>{error}</ErrorText>
      </CardContent>
    </Card>
  );
}
