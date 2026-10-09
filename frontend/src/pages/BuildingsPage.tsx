import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { canEditCampus, useAuth } from "@/auth/AuthContext";
import { ErrorText, Field } from "@/components/Field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import type { Building } from "@/lib/types";
import { useFetch } from "@/lib/useFetch";

export function BuildingsPage() {
  const { user } = useAuth();
  const editable = canEditCampus(user);
  const { data, loading, error, reload } = useFetch<{ items: Building[] }>("/buildings");
  const [editing, setEditing] = useState<Building | "new" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function remove(b: Building) {
    if (!confirm(`Delete building ${b.code} – ${b.name}?`)) return;
    setActionError(null);
    try {
      await api(`/buildings/${b.id}`, { method: "DELETE" });
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="font-mono text-2xl">Buildings</h1>
        {editable && (
          <Button onClick={() => setEditing("new")}>
            <Plus /> Add building
          </Button>
        )}
      </div>
      <ErrorText>{error ?? actionError}</ErrorText>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Address</TableHead>
            <TableHead className="text-right">Rooms</TableHead>
            {editable && <TableHead className="w-24" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data?.items.map((b) => (
            <TableRow key={b.id}>
              <TableCell className="font-mono">{b.code}</TableCell>
              <TableCell>{b.name}</TableCell>
              <TableCell className="text-muted-foreground">{b.address || "–"}</TableCell>
              <TableCell className="text-right font-mono">{b.roomCount ?? 0}</TableCell>
              {editable && (
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" aria-label={`Edit ${b.code}`} onClick={() => setEditing(b)}>
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={`Delete ${b.code}`} onClick={() => void remove(b)}>
                      <Trash2 />
                    </Button>
                  </div>
                </TableCell>
              )}
            </TableRow>
          ))}
          {!loading && data?.items.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                No buildings yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {editing && (
        <BuildingDialog
          building={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function BuildingDialog({ building, onClose, onSaved }: { building: Building | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ code: building?.code ?? "", name: building?.name ?? "", address: building?.address ?? "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(building ? `/buildings/${building.id}` : "/buildings", {
        method: building ? "PATCH" : "POST",
        body: form,
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
          <DialogTitle>{building ? "Edit building" : "New building"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field label="Code" htmlFor="b-code" hint="Short unique identifier, e.g. A">
            <Input id="b-code" required maxLength={20} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </Field>
          <Field label="Name" htmlFor="b-name">
            <Input id="b-name" required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Address" htmlFor="b-address">
            <Input id="b-address" maxLength={200} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
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
