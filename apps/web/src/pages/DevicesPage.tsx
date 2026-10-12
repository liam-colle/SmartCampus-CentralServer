import { Plus, Radio } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ConnectionBadge } from "@/components/DeviceBadges";
import { ErrorText, Field } from "@/components/Field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { useDeviceStatus } from "@/lib/DeviceStatus";
import { computeDrift, DEVICE_TYPE_LABEL, timeAgo, type Device, type Page, type Room } from "@/lib/types";
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
  const [enrolling, setEnrolling] = useState(false);

  // Refetch when a device connects or disconnects so last-seen and reported state stay fresh.
  useOnChange(status.version, devices.reload);

  const items = devices.data?.items ?? [];
  const isOnline = (d: Device) => (status.online ? status.online.has(d.id) : d.online);
  const onlineCount = useMemo(() => items.filter((d) => d.status === "active" && isOnline(d)).length, [items, status.online]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = items.filter((d) => d.status === "active").length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-mono text-2xl">Devices</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <Radio className={status.live ? "size-4 text-primary" : "size-4"} />
            {status.live ? `Live: ${onlineCount} of ${active} online` : "Live updates unavailable, showing the last known state"}
          </p>
        </div>
        <Button onClick={() => setEnrolling(true)}>
          <Plus /> Enroll device
        </Button>
      </div>

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
                No devices yet. Start a device, then use “Enroll device” with the code it shows.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {enrolling && <EnrollDialog rooms={rooms.items} onClose={() => setEnrolling(false)} />}
    </div>
  );
}

function EnrollDialog({ rooms, onClose }: { rooms: Room[]; onClose: () => void }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ code: "", fingerprint: "", name: "", room: "", groups: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const device = await api<Device>("/devices/enroll", {
        body: {
          code: form.code.replace(/[\s-]/g, "").toUpperCase(),
          fingerprint: form.fingerprint,
          name: form.name,
          ...(form.room && { room: form.room }),
          groups: form.groups.split(",").map((g) => g.trim()).filter(Boolean),
        },
      });
      navigate(`/devices/${device.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enrollment failed");
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enroll a device</DialogTitle>
          <DialogDescription>
            A new device shows an 8-character code and the fingerprint of its key. Enter both exactly as shown. The fingerprint must match: it proves the key you approve is the one on the device.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field label="Code" htmlFor="e-code">
            <Input id="e-code" required autoFocus autoComplete="off" spellCheck={false} className="font-mono tracking-widest uppercase" maxLength={12} value={form.code} onChange={set("code")} />
          </Field>
          <Field label="Key fingerprint" htmlFor="e-fp" hint="64 hexadecimal characters, spaces optional.">
            <Input id="e-fp" required autoComplete="off" spellCheck={false} className="font-mono text-xs" value={form.fingerprint} onChange={set("fingerprint")} />
          </Field>
          <Field label="Name" htmlFor="e-name">
            <Input id="e-name" required maxLength={100} placeholder="Door B2-104" value={form.name} onChange={set("name")} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Room" htmlFor="e-room">
              <Select id="e-room" value={form.room} onChange={set("room")}>
                <option value="">Not assigned</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.building.code} {r.code}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Groups" htmlFor="e-groups" hint="Comma separated.">
              <Input id="e-groups" placeholder="floor-2, west-wing" value={form.groups} onChange={set("groups")} />
            </Field>
          </div>
          <ErrorText>{error}</ErrorText>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Enrolling…" : "Approve device"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
