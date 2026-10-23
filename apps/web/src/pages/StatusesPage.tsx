import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ErrorText, Field } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge, StatusIcon } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { STATUS_ICONS, type RoomStatusDef, type StatusIconName } from "@/lib/types";
import { useFetch } from "@/lib/useFetch";

export function StatusesPage() {
  const statuses = useFetch<{ items: RoomStatusDef[] }>("/room-statuses");
  const [editing, setEditing] = useState<RoomStatusDef | "new" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function remove(s: RoomStatusDef) {
    if (!confirm(`Delete the status "${s.label}"?`)) return;
    setActionError(null);
    try {
      await api(`/room-statuses/${s.key}`, { method: "DELETE" });
      statuses.reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <div>
      <PageHeader
        title="Room statuses"
        description="What a door screen can show. Free, occupied, closed and works are built in; add your own with a label, colour and icon."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus /> Add status
          </Button>
        }
      />
      <ErrorText>{statuses.error ?? actionError}</ErrorText>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Status</TableHead>
            <TableHead>Key</TableHead>
            <TableHead>Colour</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {statuses.data?.items.map((s) => (
            <TableRow key={s.key}>
              <TableCell>
                <span className="flex items-center gap-3">
                  <StatusBadge label={s.label} color={s.color} icon={s.icon} />
                  {s.builtIn && <Badge variant="muted">Built in</Badge>}
                </span>
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">{s.key}</TableCell>
              <TableCell className="font-mono text-xs">{s.color}</TableCell>
              <TableCell>
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="icon" aria-label={`Edit ${s.label}`} onClick={() => setEditing(s)}>
                    <Pencil />
                  </Button>
                  {!s.builtIn && (
                    <Button variant="ghost" size="icon" aria-label={`Delete ${s.label}`} onClick={() => void remove(s)}>
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {editing && (
        <StatusDialog
          status={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            statuses.reload();
          }}
        />
      )}
    </div>
  );
}

/** "Exam in progress" becomes "exam-in-progress", the key rooms and devices refer to. */
const keyFromLabel = (label: string) =>
  label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

function StatusDialog({ status, onClose, onSaved }: { status: RoomStatusDef | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    label: status?.label ?? "",
    color: status?.color ?? "#7c8aa5",
    icon: (status?.icon ?? "info") as StatusIconName,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (status) await api(`/room-statuses/${status.key}`, { method: "PATCH", body: form });
      else await api("/room-statuses", { body: { ...form, key: keyFromLabel(form.label) } });
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
          <DialogTitle>{status ? `Edit ${status.label}` : "New status"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field label="Label" htmlFor="s-label" hint={status ? undefined : `Key: ${keyFromLabel(form.label) || "–"}`}>
            <Input id="s-label" required maxLength={40} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </Field>
          <Field label="Colour" htmlFor="s-color">
            <div className="flex items-center gap-3">
              <input id="s-color" type="color" className="h-9 w-14 cursor-pointer rounded-lg border border-input bg-background p-1" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
              <span className="font-mono text-xs text-muted-foreground">{form.color}</span>
            </div>
          </Field>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Icon</legend>
            <div className="grid grid-cols-6 gap-2">
              {STATUS_ICONS.map((name) => (
                <label key={name} className="cursor-pointer">
                  <input type="radio" name="icon" value={name} className="peer sr-only" checked={form.icon === name} onChange={() => setForm({ ...form, icon: name })} />
                  <span className="grid h-10 place-items-center rounded-lg border bg-background text-muted-foreground peer-checked:border-primary peer-checked:text-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring/60">
                    <StatusIcon name={name} className="size-5" />
                    <span className="sr-only">{name}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <div className="mb-1 text-sm text-muted-foreground">Preview</div>
            <StatusBadge label={form.label || "Label"} color={form.color} icon={form.icon} />
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
