import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { canEditCampus, useAuth } from "@/auth/AuthContext";
import { ErrorText, Field } from "@/components/Field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { floorLabel, ROOM_TYPES, ROOM_TYPE_LABEL, type Building, type Page, type Room, type RoomType } from "@/lib/types";
import { useDebounced, useFetch } from "@/lib/useFetch";

const PAGE_SIZE = 25;

export function RoomsPage() {
  const { user } = useAuth();
  const editable = canEditCampus(user);

  const [search, setSearch] = useState("");
  const [building, setBuilding] = useState("");
  const [floor, setFloor] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const q = useDebounced(search);

  // Any filter change goes back to the first page.
  useEffect(() => setPage(1), [q, building, floor, type]);

  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (q) params.set("q", q);
  if (building) params.set("building", building);
  if (floor !== "") params.set("floor", floor);
  if (type) params.set("type", type);

  const buildings = useFetch<{ items: Building[] }>("/buildings");
  const floors = useFetch<{ items: number[] }>(`/rooms/floors${building ? `?building=${building}` : ""}`);
  const rooms = useFetch<Page<Room>>(`/rooms?${params}`);

  const [editing, setEditing] = useState<Room | "new" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function pickBuilding(id: string) {
    setBuilding(id);
    setFloor(""); // floors depend on the building
  }

  async function remove(r: Room) {
    if (!confirm(`Delete room ${r.building.code}/${r.code}?`)) return;
    setActionError(null);
    try {
      await api(`/rooms/${r.id}`, { method: "DELETE" });
      rooms.reload();
      floors.reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  const total = rooms.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="font-mono text-2xl">Rooms</h1>
        {editable && (
          <Button onClick={() => setEditing("new")}>
            <Plus /> Add room
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search rooms" placeholder="Search code or name…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select aria-label="Building" value={building} onChange={(e) => pickBuilding(e.target.value)}>
          <option value="">All buildings</option>
          {buildings.data?.items.map((b) => (
            <option key={b.id} value={b.id}>
              {b.code} – {b.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Floor" value={floor} onChange={(e) => setFloor(e.target.value)}>
          <option value="">All floors</option>
          {floors.data?.items.map((f) => (
            <option key={f} value={f}>
              {floorLabel(f)}
            </option>
          ))}
        </Select>
        <Select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {ROOM_TYPES.map((t) => (
            <option key={t} value={t}>
              {ROOM_TYPE_LABEL[t]}
            </option>
          ))}
        </Select>
      </div>

      <ErrorText>{rooms.error ?? actionError}</ErrorText>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Building</TableHead>
            <TableHead>Room</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Floor</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Capacity</TableHead>
            {editable && <TableHead className="w-24" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rooms.data?.items.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-mono">{r.building.code}</TableCell>
              <TableCell className="font-mono">{r.code}</TableCell>
              <TableCell>{r.name || "–"}</TableCell>
              <TableCell>{floorLabel(r.floor)}</TableCell>
              <TableCell>{ROOM_TYPE_LABEL[r.type]}</TableCell>
              <TableCell className="text-right font-mono">{r.capacity ?? "–"}</TableCell>
              {editable && (
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" aria-label={`Edit ${r.code}`} onClick={() => setEditing(r)}>
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={`Delete ${r.code}`} onClick={() => void remove(r)}>
                      <Trash2 />
                    </Button>
                  </div>
                </TableCell>
              )}
            </TableRow>
          ))}
          {!rooms.loading && rooms.data?.items.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                No rooms match.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{total} room{total === 1 ? "" : "s"}</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="font-mono">{page} / {pages}</span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      </div>

      {editing && (
        <RoomDialog
          room={editing === "new" ? null : editing}
          buildings={buildings.data?.items ?? []}
          defaultBuilding={building}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            rooms.reload();
            floors.reload();
          }}
        />
      )}
    </div>
  );
}

function RoomDialog({
  room,
  buildings,
  defaultBuilding,
  onClose,
  onSaved,
}: {
  room: Room | null;
  buildings: Building[];
  defaultBuilding: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    building: room?.building.id ?? defaultBuilding ?? "",
    code: room?.code ?? "",
    name: room?.name ?? "",
    floor: String(room?.floor ?? 0),
    capacity: room?.capacity != null ? String(room.capacity) : "",
    type: (room?.type ?? "classroom") as RoomType,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(room ? `/rooms/${room.id}` : "/rooms", {
        method: room ? "PATCH" : "POST",
        body: {
          building: form.building,
          code: form.code,
          name: form.name,
          floor: Number(form.floor),
          capacity: form.capacity === "" ? undefined : Number(form.capacity),
          type: form.type,
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
          <DialogTitle>{room ? "Edit room" : "New room"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field label="Building" htmlFor="r-building">
            <Select id="r-building" required value={form.building} onChange={set("building")}>
              <option value="" disabled>
                Choose a building…
              </option>
              {buildings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} – {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Room number" htmlFor="r-code">
              <Input id="r-code" required maxLength={30} value={form.code} onChange={set("code")} />
            </Field>
            <Field label="Floor" htmlFor="r-floor" hint="0 = ground floor, negative = basement">
              <Input id="r-floor" type="number" required min={-10} max={200} step={1} value={form.floor} onChange={set("floor")} />
            </Field>
          </div>
          <Field label="Name" htmlFor="r-name">
            <Input id="r-name" maxLength={100} value={form.name} onChange={set("name")} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Type" htmlFor="r-type">
              <Select id="r-type" value={form.type} onChange={set("type")}>
                {ROOM_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ROOM_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Capacity" htmlFor="r-capacity">
              <Input id="r-capacity" type="number" min={0} step={1} value={form.capacity} onChange={set("capacity")} />
            </Field>
          </div>
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
