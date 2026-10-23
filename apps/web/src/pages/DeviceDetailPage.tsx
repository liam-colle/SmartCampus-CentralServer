import { ArrowLeft, Ban, Pencil, Send } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useParams } from "react-router-dom";
import { ConnectionBadge } from "@/components/DeviceBadges";
import { ErrorText, Field } from "@/components/Field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  type Device,
  type DeviceCommand,
  type Room,
} from "@/lib/types";
import { useFetch, useOnChange } from "@/lib/useFetch";
import { useRoomOptions } from "./DevicesPage";

const json = (v: unknown) => (v === undefined ? "–" : typeof v === "string" ? v : JSON.stringify(v, null, 2));

export function DeviceDetailPage() {
  const { id = "" } = useParams();
  const status = useDeviceStatus();
  const device = useFetch<Device>(`/devices/${id}`);
  const commands = useFetch<{ items: DeviceCommand[] }>(`/devices/${id}/commands`);
  const rooms = useRoomOptions();
  const [editing, setEditing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const reloadDevice = device.reload;
  const reloadCommands = commands.reload;
  // Online/offline changes and acknowledgements show up without a manual refresh.
  useOnChange(status.version, reloadDevice);
  useEffect(() => {
    const t = setInterval(() => {
      reloadCommands();
      reloadDevice();
    }, 3000);
    return () => clearInterval(t);
  }, [reloadCommands, reloadDevice]);

  const d = device.data;
  if (!d) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <ErrorText>{device.error}</ErrorText>
        {!device.error && <p className="text-muted-foreground">Loading…</p>}
      </div>
    );
  }

  const online = status.online ? status.online.has(d.id) : d.online;
  const drift = computeDrift(d);
  const revoked = d.status === "revoked";

  async function revoke() {
    if (!d) return;
    if (!confirm(`Revoke ${d.name || d.id}? It is disconnected immediately and can only come back by enrolling again with a new key.`)) return;
    setActionError(null);
    try {
      await api(`/devices/${d.id}/revoke`, { method: "POST" });
      reloadDevice();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Revocation failed");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <BackLink />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
            {d.name || d.id} <ConnectionBadge status={d.status} online={online} />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {DEVICE_TYPE_LABEL[d.type]}
            {d.room && rooms.label(d.room) ? ` · ${rooms.label(d.room)}` : ""} · last seen {online ? "now" : timeAgo(d.lastSeenAt)}
          </p>
        </div>
        {!revoked && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil /> Edit
            </Button>
            <Button variant="destructive" onClick={() => void revoke()}>
              <Ban /> Revoke
            </Button>
          </div>
        )}
      </div>
      <ErrorText>{actionError}</ErrorText>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Identity</CardTitle>
            <CardDescription>The public key registered at enrollment.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">Device id</dt>
              <dd className="font-mono break-all">{d.id}</dd>
              <dt className="text-muted-foreground">Fingerprint</dt>
              <dd className="font-mono text-xs break-words">{formatFingerprint(d.fingerprint)}</dd>
              <dt className="text-muted-foreground">Groups</dt>
              <dd>{d.groups.length ? d.groups.join(", ") : "–"}</dd>
              <dt className="text-muted-foreground">Enrolled</dt>
              <dd>{new Date(d.createdAt).toLocaleString()}</dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              State {!revoked && (drift.length === 0 ? <Badge variant="muted">In sync</Badge> : <Badge variant="destructive">{drift.length} not applied</Badge>)}
            </CardTitle>
            <CardDescription>What the console asked for, and what the device last reported.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <StateBlock title="Desired" value={d.desired} />
              <StateBlock title="Reported" value={d.reported} />
            </div>
            {drift.map((x) => (
              <p key={x.key} className="text-sm text-destructive">
                {x.key}: wants {json(x.desired)}, device shows {json(x.reported)}
              </p>
            ))}
            {Object.keys(d.telemetry).length > 0 && <StateBlock title="Telemetry" value={d.telemetry} />}
          </CardContent>
        </Card>
      </div>

      {!revoked && <CommandForm device={d} online={online} rooms={rooms.items} onSent={reloadCommands} />}

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Command history</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sent</TableHead>
              <TableHead>Command</TableHead>
              <TableHead>Payload</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {commands.data?.items.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="text-muted-foreground">{timeAgo(c.createdAt)}</TableCell>
                <TableCell className="font-mono text-xs">{c.type}</TableCell>
                <TableCell className="max-w-xs truncate font-mono text-xs text-muted-foreground" title={JSON.stringify(c.payload)}>
                  {JSON.stringify(c.payload)}
                </TableCell>
                <TableCell>
                  <CommandStatus c={c} />
                </TableCell>
              </TableRow>
            ))}
            {commands.data?.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  No commands yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>

      {editing && (
        <EditDialog
          device={d}
          rooms={rooms.items}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reloadDevice();
          }}
        />
      )}
    </div>
  );
}

const BackLink = () => (
  <Link to="/devices" className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
    <ArrowLeft className="size-4" /> All devices
  </Link>
);

function StateBlock({ title, value }: { title: string; value: Record<string, unknown> }) {
  return (
    <div>
      <div className="mb-1 font-mono text-xs tracking-wider text-muted-foreground uppercase">{title}</div>
      <pre className="max-h-48 overflow-auto rounded-md border bg-background p-3 font-mono text-xs">{Object.keys(value).length ? json(value) : "empty"}</pre>
    </div>
  );
}

function CommandStatus({ c }: { c: DeviceCommand }) {
  if (c.status === "acked") return <Badge>Acknowledged</Badge>;
  if (c.status === "nacked") return <Badge variant="destructive" title={c.nackReason ?? undefined}>Rejected{c.nackReason ? `: ${c.nackReason}` : ""}</Badge>;
  return <Badge variant="muted">{c.status === "sent" ? `Sent (${c.attempts}×), waiting` : "Waiting for device"}</Badge>;
}

const COMMANDS = [
  { value: "room.status.set", label: "Set room status" },
  { value: "announce.show", label: "Show announcement" },
  { value: "display.config.set", label: "Set display configuration" },
] as const;
type CommandKind = (typeof COMMANDS)[number]["value"];

const TTLS = [
  { value: 300, label: "5 minutes" },
  { value: 3600, label: "1 hour" },
  { value: 86_400, label: "24 hours" },
  { value: 604_800, label: "7 days" },
];

function CommandForm({ device, online, rooms, onSent }: { device: Device; online: boolean; rooms: Room[]; onSent: () => void }) {
  const room = rooms.find((r) => r.id === device.room);
  const [kind, setKind] = useState<CommandKind>("room.status.set");
  const [roomId, setRoomId] = useState(room ? `${room.building.code}-${room.code}` : "");
  const [roomStatus, setRoomStatus] = useState("occupied");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [priority, setPriority] = useState("normal");
  const [config, setConfig] = useState('{\n  "theme": "dark"\n}');
  const [ttl, setTtl] = useState(3600);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Fill the room id once the rooms have loaded.
  useEffect(() => {
    if (room && !roomId) setRoomId(`${room.building.code}-${room.code}`);
  }, [room, roomId]);

  function payload(): unknown {
    if (kind === "room.status.set") return { roomId, status: roomStatus };
    if (kind === "announce.show") return { announcementId: crypto.randomUUID(), ...(title && { title }), text, priority };
    try {
      return { config: JSON.parse(config) };
    } catch {
      throw new Error("The configuration is not valid JSON");
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const r = await api<{ delivered: boolean }>(`/devices/${device.id}/commands`, { body: { type: kind, payload: payload(), ttlSeconds: ttl } });
      setNotice(r.delivered ? "Sent to the device." : "Queued: the device is offline and will receive it when it reconnects.");
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the command");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Send a command</CardTitle>
        <CardDescription>
          {online ? "The device is online and receives it now." : "The device is offline: commands wait and are delivered, in order, when it reconnects."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Command" htmlFor="c-kind">
              <Select id="c-kind" value={kind} onChange={(e) => setKind(e.target.value as CommandKind)}>
                {COMMANDS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Expires after" htmlFor="c-ttl" hint="Undelivered commands are dropped after this.">
              <Select id="c-ttl" value={ttl} onChange={(e) => setTtl(Number(e.target.value))}>
                {TTLS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {kind === "room.status.set" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Room id" htmlFor="c-room">
                <Input id="c-room" required maxLength={64} value={roomId} onChange={(e) => setRoomId(e.target.value)} />
              </Field>
              <Field label="Status" htmlFor="c-status">
                <Select id="c-status" value={roomStatus} onChange={(e) => setRoomStatus(e.target.value)}>
                  <option value="free">Free</option>
                  <option value="occupied">Occupied</option>
                  <option value="reserved">Reserved</option>
                  <option value="closed">Closed</option>
                </Select>
              </Field>
            </div>
          )}

          {kind === "announce.show" && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Title (optional)" htmlFor="c-title">
                  <Input id="c-title" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
                </Field>
                <Field label="Priority" htmlFor="c-priority">
                  <Select id="c-priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="emergency">Emergency</option>
                  </Select>
                </Field>
              </div>
              <Field label="Message" htmlFor="c-text">
                <textarea
                  id="c-text"
                  required
                  maxLength={2000}
                  rows={3}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                />
              </Field>
            </>
          )}

          {kind === "display.config.set" && (
            <Field label="Configuration (JSON)" htmlFor="c-config">
              <textarea
                id="c-config"
                required
                rows={5}
                spellCheck={false}
                value={config}
                onChange={(e) => setConfig(e.target.value)}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              />
            </Field>
          )}

          <ErrorText>{error}</ErrorText>
          {notice && (
            <p role="status" className="text-sm">
              {notice}
            </p>
          )}
          <div>
            <Button type="submit" disabled={busy}>
              <Send /> {busy ? "Sending…" : "Send"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function EditDialog({ device, rooms, onClose, onSaved }: { device: Device; rooms: Room[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: device.name, room: device.room ?? "", groups: device.groups.join(", ") });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/devices/${device.id}`, {
        method: "PATCH",
        body: {
          name: form.name,
          room: form.room || null,
          groups: form.groups.split(",").map((g) => g.trim()).filter(Boolean),
        },
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit device</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field label="Name" htmlFor="d-name">
            <Input id="d-name" required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Room" htmlFor="d-room">
            <Select id="d-room" value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })}>
              <option value="">Not assigned</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.building.code} {r.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Groups" htmlFor="d-groups" hint="Comma separated.">
            <Input id="d-groups" value={form.groups} onChange={(e) => setForm({ ...form, groups: e.target.value })} />
          </Field>
          <ErrorText>{error}</ErrorText>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
