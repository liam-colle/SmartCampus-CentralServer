import { ArrowLeft, Ban, Pencil, Send } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useParams } from "react-router-dom";
import { AudioSettingsCard } from "@/components/AudioSettingsCard";
import { ConnectionBadge } from "@/components/DeviceBadges";
import { DisplayConfigEditor } from "@/components/DisplayConfigEditor";
import { DoorPreview, type PreviewAnnouncement, type PreviewRoom, type PreviewStatus } from "@/components/DoorPreview";
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
  DEFAULT_DISPLAY_CONFIG,
  DEVICE_TYPE_LABEL,
  floorLabel,
  formatFingerprint,
  timeAgo,
  type AnnouncePriority,
  type Device,
  type DeviceCommand,
  type DisplayConfig,
  type Room,
  type RoomStatusDef,
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
  const statuses = useFetch<{ items: RoomStatusDef[] }>("/room-statuses");
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<TabId>("overview");
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
  const hasScreen = d.type !== "access";
  const tabs = TABS.filter((t) => !revoked && (t.id !== "display" || hasScreen));
  const activeTab = tabs.some((t) => t.id === tab) ? tab : "overview";

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
            {d.room && rooms.describe(d.room) ? ` · ${rooms.describe(d.room)}` : " · not placed in a room"} · last seen {online ? "now" : timeAgo(d.lastSeenAt)}
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

      <div role="tablist" aria-label="Device sections" className="flex gap-1 border-b">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={activeTab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${
              activeTab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${activeTab}`} aria-labelledby={`tab-${activeTab}`} className="flex flex-col gap-6">
        {activeTab === "overview" && (
          <>
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
    
          {hasScreen && (
            <Card>
              <CardHeader>
                <CardTitle>Live preview</CardTitle>
                <CardDescription>What the screen shows right now.</CardDescription>
              </CardHeader>
              <CardContent className="max-w-xl">
                <DoorPreview {...previewOf(d, rooms.items, statuses.data?.items ?? [], online)} config={displayConfigOf(d)} />
              </CardContent>
            </Card>
          )}
          </>
        )}
        {activeTab === "display" && (
          <DisplayConfigEditor device={d} preview={previewOf(d, rooms.items, statuses.data?.items ?? [], online)} />
        )}
        {activeTab === "audio" && <AudioSettingsCard device={d} online={online} />}
        {activeTab === "commands" && (
          <>
            {!revoked && <CommandForm device={d} online={online} onSent={reloadCommands} />}
            <CommandHistory commands={commands.data?.items} />
          </>
        )}
      </div>

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

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "display", label: "Display" },
  { id: "audio", label: "Audio" },
  { id: "commands", label: "Commands" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/** Room, status and announcements as the screen has them: what it reported, else what was asked for. */
function previewOf(d: Device, rooms: Room[], statuses: RoomStatusDef[], online: boolean) {
  const desiredRoom = d.desired.room as PreviewRoom | undefined;
  const linked = rooms.find((r) => r.id === d.room);
  const room: PreviewRoom | null =
    desiredRoom ?? (linked ? { code: linked.code, name: linked.name, building: linked.building.name, floor: linked.floor, capacity: linked.capacity } : null);

  const desiredStatus = d.desired.roomStatus as (PreviewStatus & { status: string }) | undefined;
  const key = typeof d.reported.roomStatus === "string" ? d.reported.roomStatus : desiredStatus?.status;
  const known = statuses.find((s) => s.key === key);
  const status: PreviewStatus | null = known ?? (desiredStatus && desiredStatus.status === key ? desiredStatus : null);

  const wanted = Object.values((d.desired.announcements as Record<string, PreviewAnnouncement & { expiresAt?: number }> | undefined) ?? {}).filter(
    (a) => a.expiresAt === undefined || a.expiresAt > Date.now(),
  );
  const shown = Array.isArray(d.reported.announcements) ? (d.reported.announcements as string[]) : null;
  const announcements = (shown ? wanted.filter((a) => shown.includes(a.id ?? (a as { announcementId?: string }).announcementId ?? "")) : wanted).map((a) => ({
    id: (a as { announcementId?: string }).announcementId ?? a.id,
    title: a.title,
    text: a.text,
    priority: a.priority as AnnouncePriority,
  }));
  return { room, status, announcements, online };
}

const displayConfigOf = (d: Device): DisplayConfig => ({ ...DEFAULT_DISPLAY_CONFIG, ...((d.desired.displayConfig as Partial<DisplayConfig> | undefined) ?? {}) });

function CommandHistory({ commands }: { commands: DeviceCommand[] | undefined }) {
  return (
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
          {commands?.map((c) => (
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
          {commands?.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                No commands yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </section>
  );
}

/** Raw command, for testing a device. Everyday actions have their own screens (statuses, announcements, display, audio). */
const RAW_COMMANDS = ["room.status.set", "room.info.set", "announce.show", "announce.clear", "display.config.set", "audio.settings.set"] as const;

const RAW_TEMPLATES: Record<(typeof RAW_COMMANDS)[number], unknown> = {
  "room.status.set": { roomId: "B2-104", status: "occupied", label: "Occupied", color: "#f5a524", icon: "user" },
  "room.info.set": { roomId: "B2-104", code: "B2-104", name: "Lab", building: "Building 2", floor: 1, capacity: 24 },
  "announce.show": { announcementId: "test-1", text: "Hello", priority: "info" },
  "announce.clear": { announcementId: "test-1" },
  "display.config.set": { config: {} },
  "audio.settings.set": { volume: 60, quietHours: { enabled: false, from: "22:00", to: "06:00" } },
};

const TTLS = [
  { value: 300, label: "5 minutes" },
  { value: 3600, label: "1 hour" },
  { value: 86_400, label: "24 hours" },
  { value: 604_800, label: "7 days" },
];

function CommandForm({ device, online, onSent }: { device: Device; online: boolean; onSent: () => void }) {
  const [kind, setKind] = useState<(typeof RAW_COMMANDS)[number]>("room.status.set");
  const [payload, setPayload] = useState(JSON.stringify(RAW_TEMPLATES["room.status.set"], null, 2));
  const [ttl, setTtl] = useState(3600);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function pick(next: (typeof RAW_COMMANDS)[number]) {
    setKind(next);
    setPayload(JSON.stringify(RAW_TEMPLATES[next], null, 2));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return setError("The payload is not valid JSON");
    }
    setBusy(true);
    try {
      const r = await api<{ delivered: boolean }>(`/devices/${device.id}/commands`, { body: { type: kind, payload: parsed, ttlSeconds: ttl } });
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
        <CardTitle>Send a raw command</CardTitle>
        <CardDescription>
          For testing. {online ? "The device is online and receives it now." : "The device is offline: commands wait and are delivered, in order, when it reconnects."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Command" htmlFor="c-kind">
              <Select id="c-kind" value={kind} onChange={(e) => pick(e.target.value as (typeof RAW_COMMANDS)[number])}>
                {RAW_COMMANDS.map((c) => (
                  <option key={c} value={c}>
                    {c}
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
          <Field label="Payload (JSON)" htmlFor="c-payload">
            <textarea
              id="c-payload"
              required
              rows={7}
              spellCheck={false}
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            />
          </Field>
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
          <Field label="Location" htmlFor="d-room" hint="Building, floor and room of the screen. It shows that room's status.">
            <Select id="d-room" value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })}>
              <option value="">Not placed in a room</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.building.code} · {floorLabel(r.floor)} · {r.code}
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
