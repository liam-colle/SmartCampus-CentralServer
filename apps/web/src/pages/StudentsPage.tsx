import { Nfc, Plus, Search } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ErrorText, Field } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { useDeviceStatus } from "@/lib/DeviceStatus";
import { DEVICE_TYPE_LABEL, formatCardUid, type Device, type Page, type RegistrationSession, type StaffMember } from "@/lib/types";
import { useDebounced, useFetch, useOnChange } from "@/lib/useFetch";

const PAGE_SIZE = 25;

export function StudentsPage() {
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const params = new URLSearchParams({ group: "student", limit: String(PAGE_SIZE) });
  if (q) params.set("q", q);
  const list = useFetch<Page<StaffMember>>(`/users?${params}`);

  const [adding, setAdding] = useState(false);
  const [registering, setRegistering] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Students"
        description="People identified by their NFC card. They have no console login."
        actions={
          <>
            <Button variant="outline" onClick={() => setRegistering(true)}>
              <Nfc /> Register cards
            </Button>
            <Button onClick={() => setAdding(true)}>
              <Plus /> Add student
            </Button>
          </>
        }
      />

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input aria-label="Search students" placeholder="Search name…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <ErrorText>{list.error}</ErrorText>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Card</TableHead>
            <TableHead>Other groups</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.data?.items.map((s) => (
            <TableRow key={s.id} className={s.disabled ? "opacity-50" : undefined}>
              <TableCell>{s.name}</TableCell>
              <TableCell className="font-mono text-xs">{s.cardUid ? formatCardUid(s.cardUid) : "–"}</TableCell>
              <TableCell className="text-muted-foreground">{s.groups.filter((g) => g !== "student").join(", ") || "–"}</TableCell>
            </TableRow>
          ))}
          {!list.loading && list.data?.items.length === 0 && (
            <TableRow>
              <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                No students yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <p className="text-sm text-muted-foreground">
        {list.data?.total ?? 0} students. To make a student an operator or administrator, edit them on the Staff page.
      </p>

      {adding && <AddStudentDialog onClose={() => setAdding(false)} onSaved={() => (setAdding(false), list.reload())} />}
      {registering && <RegistrationDialog onClose={() => (setRegistering(false), list.reload())} />}
    </div>
  );
}

function AddStudentDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [cardUid, setCardUid] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("/students", { body: { name, cardUid } });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New student</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field label="Name" htmlFor="st-name">
            <Input id="st-name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Card serial number" htmlFor="st-card" hint="Hex, any notation (04:A2:2B:1C).">
            <Input id="st-card" required className="font-mono" maxLength={40} value={cardUid} onChange={(e) => setCardUid(e.target.value)} />
          </Field>
          <ErrorText>{error}</ErrorText>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Pick a reader, it collects every card presented until the admin stops it, then each card gets a
 * name. Cards that already belong to someone are listed but cannot be enrolled twice.
 */
function RegistrationDialog({ onClose }: { onClose: () => void }) {
  const devices = useFetch<{ items: Device[] }>("/devices");
  const readers = (devices.data?.items ?? []).filter((d) => d.status === "active" && (d.type === "access" || d.type === "door"));
  const [deviceId, setDeviceId] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const session = useFetch<RegistrationSession>(sessionId ? `/card-registration/${sessionId}` : null);
  // Each scanned card is refetched when the server reports it, see `registration.card` in DeviceStatus.
  const { version } = useDeviceStatus();
  useOnChange(version, session.reload);

  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const collecting = session.data?.status === "active";
  const free = (session.data?.cards ?? []).filter((c) => !c.ownerName);

  async function run(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    }
  }

  const start = () => run(async () => setSessionId((await api<RegistrationSession>("/card-registration", { body: { deviceId } })).id));
  const stop = () => run(async () => void (await api(`/card-registration/${sessionId}`, { method: "DELETE" }), session.reload()));

  const enrol = () =>
    run(async () => {
      const students = free.map((c) => ({ cardUid: c.cardUid, name: (names[c.cardUid] ?? "").trim() })).filter((s) => s.name);
      const r = await api<{ created: unknown[]; errors: { index: number; message: string }[] }>("/students/bulk", { body: { students } });
      setResult(`${r.created.length} students created${r.errors.length ? `, ${r.errors.length} refused: ${r.errors.map((e) => e.message).join("; ")}` : "."}`);
      setNames({});
      session.reload();
    });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Register cards</DialogTitle>
        </DialogHeader>
        {!sessionId ? (
          <div className="flex flex-col gap-4">
            <Field label="Reader" htmlFor="reg-device" hint="While it collects, the reader does not open its maintenance menu.">
              <Select id="reg-device" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                <option value="">Choose a reader…</option>
                {readers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name || d.id} ({DEVICE_TYPE_LABEL[d.type]})
                  </option>
                ))}
              </Select>
            </Field>
            <ErrorText>{error}</ErrorText>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={!deviceId} onClick={() => void start()}>
                Start collecting
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p role="status" className="text-sm">
              {collecting ? "Present the cards one by one to the reader." : "Collection finished."} {session.data?.cards.length ?? 0} read.
            </p>
            <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
              {session.data?.cards.map((c) => (
                <li key={c.cardUid} className="flex items-center gap-3">
                  <span className="font-mono text-xs">{formatCardUid(c.cardUid)}</span>
                  {c.ownerName ? (
                    <span className="text-sm text-muted-foreground">already belongs to {c.ownerName}</span>
                  ) : (
                    <Input
                      aria-label={`Name for card ${formatCardUid(c.cardUid)}`}
                      placeholder="Student name"
                      maxLength={100}
                      value={names[c.cardUid] ?? ""}
                      onChange={(e) => setNames({ ...names, [c.cardUid]: e.target.value })}
                    />
                  )}
                </li>
              ))}
            </ul>
            {result && <p role="status" className="text-sm">{result}</p>}
            <ErrorText>{error ?? session.error}</ErrorText>
            <DialogFooter>
              {collecting && (
                <Button variant="outline" onClick={() => void stop()}>
                  Stop collecting
                </Button>
              )}
              <Button disabled={!free.some((c) => names[c.cardUid]?.trim())} onClick={() => void enrol()}>
                Create students
              </Button>
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
