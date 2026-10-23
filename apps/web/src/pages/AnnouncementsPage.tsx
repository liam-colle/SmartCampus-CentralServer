import { Megaphone, Plus, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ErrorText, Field } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { emptyTargetState, TargetPicker, toTargets, type TargetState } from "@/components/TargetPicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { ANNOUNCE_PRIORITIES, PRIORITY_LABEL, timeAgo, type Announcement, type AnnouncePriority, type Page } from "@/lib/types";
import { useFetch } from "@/lib/useFetch";

export const PriorityBadge = ({ priority }: { priority: AnnouncePriority }) => (
  <Badge variant={priority === "urgent" ? "destructive" : priority === "important" ? "default" : "muted"}>{PRIORITY_LABEL[priority]}</Badge>
);

const STATE_LABEL = { active: "Showing", expired: "Expired", cancelled: "Cancelled" } as const;

export function AnnouncementsPage() {
  const list = useFetch<Page<Announcement>>("/announcements?kind=text&limit=100");
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function cancel(a: Announcement) {
    if (!confirm(`Take "${a.title || a.text.slice(0, 40)}" off ${a.deviceCount} screen${a.deviceCount === 1 ? "" : "s"}?`)) return;
    setActionError(null);
    try {
      await api(`/announcements/${a.id}`, { method: "DELETE" });
      list.reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Cancel failed");
    }
  }

  return (
    <div>
      <PageHeader
        title="Announcements"
        description="Messages shown on door and faculty screens. Screens hide them by themselves at the expiry time, even when offline."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> New announcement
          </Button>
        }
      />
      <ErrorText>{list.error ?? actionError}</ErrorText>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Message</TableHead>
            <TableHead>Priority</TableHead>
            <TableHead>Screens</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.data?.items.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="max-w-sm">
                <div className="truncate font-medium">{a.title || a.text}</div>
                {a.title && <div className="truncate text-xs text-muted-foreground">{a.text}</div>}
                <div className="text-xs text-muted-foreground">
                  {a.createdBy}, {timeAgo(a.createdAt)}
                </div>
              </TableCell>
              <TableCell>
                <PriorityBadge priority={a.priority} />
              </TableCell>
              <TableCell>{a.deviceCount}</TableCell>
              <TableCell className="text-muted-foreground">{a.expiresAt ? new Date(a.expiresAt).toLocaleString() : "Until cancelled"}</TableCell>
              <TableCell>
                <Badge variant={a.state === "active" ? "default" : "muted"}>{STATE_LABEL[a.state]}</Badge>
              </TableCell>
              <TableCell>
                {a.state === "active" && (
                  <Button variant="ghost" size="icon" aria-label="Take off screens" onClick={() => void cancel(a)}>
                    <X />
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
          {!list.loading && list.data?.items.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                <Megaphone className="mx-auto mb-2 size-6" /> No announcement yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {creating && (
        <AnnouncementDialog
          onClose={() => setCreating(false)}
          onSent={() => {
            setCreating(false);
            list.reload();
          }}
        />
      )}
    </div>
  );
}

/** Local date and time of an `<input type="datetime-local">`, to an ISO string. Empty means no expiry. */
const toIso = (local: string) => (local ? new Date(local).toISOString() : undefined);

function AnnouncementDialog({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const [form, setForm] = useState({ title: "", text: "", priority: "info" as AnnouncePriority, expires: "" });
  const [targets, setTargets] = useState<TargetState>(emptyTargetState());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const chosen = toTargets(targets);
    if (!chosen) return setError("Choose where to send it");
    setBusy(true);
    setError(null);
    try {
      await api("/announcements", { body: { title: form.title || undefined, text: form.text, priority: form.priority, targets: chosen, expiresAt: toIso(form.expires) } });
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the announcement");
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New announcement</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field label="Title (optional)" htmlFor="a-title">
            <Input id="a-title" maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="Message" htmlFor="a-text">
            <textarea
              id="a-text"
              required
              maxLength={2000}
              rows={3}
              value={form.text}
              onChange={(e) => setForm({ ...form, text: e.target.value })}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Priority" htmlFor="a-priority">
              <Select id="a-priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as AnnouncePriority })}>
                {ANNOUNCE_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Expires (optional)" htmlFor="a-expires" hint="Empty: stays until cancelled.">
              <Input id="a-expires" type="datetime-local" value={form.expires} onChange={(e) => setForm({ ...form, expires: e.target.value })} />
            </Field>
          </div>
          <TargetPicker value={targets} onChange={setTargets} />
          <ErrorText>{error}</ErrorText>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Sending…" : "Send"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
