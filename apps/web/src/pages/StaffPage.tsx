import { Mail, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/auth/AuthContext";
import { ErrorText, Field } from "@/components/Field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { GROUPS, GROUP_LABEL, type Group, type Page, type StaffMember } from "@/lib/types";
import { useDebounced, useFetch } from "@/lib/useFetch";

const PAGE_SIZE = 25;

export function StaffPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  // Operators manage students and plain staff, and cannot grant the admin or operator group.
  const assignable: Group[] = isAdmin ? GROUPS : ["student"];
  const canManage = (m: StaffMember) => isAdmin || !m.groups.some((g) => g === "admin" || g === "operator");

  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("");
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  useEffect(() => setPage(1), [q, group]);

  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (q) params.set("q", q);
  if (group) params.set("group", group);
  const list = useFetch<Page<StaffMember>>(`/users?${params}`);

  const [editing, setEditing] = useState<StaffMember | "new" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>, done?: string) {
    setActionError(null);
    setNotice(null);
    try {
      await fn();
      if (done) setNotice(done);
      list.reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Action failed");
    }
  }

  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Staff</h1>
        <Button onClick={() => setEditing("new")}>
          <Plus /> Add person
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search people" placeholder="Search name, email, department…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select aria-label="Group" value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="">All groups</option>
          {GROUPS.map((g) => (
            <option key={g} value={g}>
              {GROUP_LABEL[g]}
            </option>
          ))}
        </Select>
      </div>

      <ErrorText>{list.error ?? actionError}</ErrorText>
      {notice && <p role="status" className="text-sm">{notice}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Groups</TableHead>
            <TableHead>Department</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-32" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.data?.items.map((m) => (
            <TableRow key={m.id} className={m.disabled ? "opacity-50" : undefined}>
              <TableCell>
                {m.name}
                {m.jobTitle && <div className="text-xs text-muted-foreground">{m.jobTitle}</div>}
              </TableCell>
              <TableCell className="font-mono text-xs">{m.email ?? "–"}</TableCell>
              <TableCell>{m.groups.length ? m.groups.map((g) => GROUP_LABEL[g]).join(", ") : "–"}</TableCell>
              <TableCell>{m.department || "–"}</TableCell>
              <TableCell className="text-muted-foreground">{m.disabled ? "Disabled" : m.hasPassword ? "Active" : m.email ? "Invite pending" : "Card only"}</TableCell>
              <TableCell>
                {canManage(m) && (
                  <div className="flex justify-end gap-1">
                    {m.email && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={m.hasPassword ? `Send password reset to ${m.email}` : `Send invitation to ${m.email}`}
                      title={m.hasPassword ? "Send password reset" : "Send invitation"}
                      onClick={() => void run(() => api(`/users/${m.id}/invite`, { method: "POST" }), `Email sent to ${m.email}.`)}
                    >
                      <Mail />
                    </Button>
                    )}
                    <Button variant="ghost" size="icon" aria-label={`Edit ${m.name}`} onClick={() => setEditing(m)}>
                      <Pencil />
                    </Button>
                    {isAdmin && m.id !== user?.id && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${m.name}`}
                        onClick={() => confirm(`Delete ${m.name}? This cannot be undone.`) && void run(() => api(`/users/${m.id}`, { method: "DELETE" }))}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
          {!list.loading && list.data?.items.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                No one matches.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{total} {total === 1 ? "person" : "people"}</span>
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
        <StaffDialog
          member={editing === "new" ? null : editing}
          assignable={assignable}
          self={editing !== "new" && editing.id === user?.id}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            list.reload();
          }}
        />
      )}
    </div>
  );
}

function StaffDialog({
  member,
  assignable,
  self,
  onClose,
  onSaved,
}: {
  member: StaffMember | null;
  assignable: Group[];
  self: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: member?.name ?? "",
    email: member?.email ?? "",
    groups: member?.groups ?? ([] as Group[]),
    cardUid: member?.cardUid ?? "",
    department: member?.department ?? "",
    jobTitle: member?.jobTitle ?? "",
    phone: member?.phone ?? "",
    password: "",
    sendInvite: !member,
    disabled: member?.disabled ?? false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { password, sendInvite, disabled, cardUid, email, ...fields } = form;
    try {
      if (member) {
        // An empty card field removes the card.
        await api(`/users/${member.id}`, {
          method: "PATCH",
          body: { ...fields, email: email || undefined, cardUid: cardUid || null, disabled, ...(password && { password }) },
        });
      } else {
        await api("/users", {
          body: { ...fields, email: email || undefined, ...(cardUid && { cardUid }), ...(password && { password }), sendInvite },
        });
      }
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
          <DialogTitle>{member ? "Edit person" : "New person"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name" htmlFor="s-name">
              <Input id="s-name" required maxLength={100} value={form.name} onChange={set("name")} />
            </Field>
            <Field label="Email" htmlFor="s-email" hint="Not needed for someone who only uses a card.">
              <Input id="s-email" type="email" value={form.email} onChange={set("email")} />
            </Field>
          </div>
          <fieldset className="flex flex-col gap-2" disabled={self}>
            <legend className="mb-1 text-sm font-medium">Groups</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {GROUPS.map((g) => (
                <label key={g} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={form.groups.includes(g)}
                    // Keep a group the operator cannot grant as it is, so saving does not silently drop it.
                    disabled={!assignable.includes(g)}
                    onChange={(e) => setForm({ ...form, groups: e.target.checked ? [...form.groups, g] : form.groups.filter((x) => x !== g) })}
                  />
                  {GROUP_LABEL[g]}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Administrators and operators open the maintenance menu when their card is read. A person can be a student and an operator.
            </p>
          </fieldset>
          <Field label="Card serial number" htmlFor="s-card" hint="Hex, any notation (04:A2:2B:1C). Empty removes the card.">
            <Input id="s-card" className="font-mono" maxLength={40} value={form.cardUid} onChange={set("cardUid")} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Department" htmlFor="s-dept">
              <Input id="s-dept" maxLength={100} value={form.department} onChange={set("department")} />
            </Field>
            <Field label="Job title" htmlFor="s-title">
              <Input id="s-title" maxLength={100} value={form.jobTitle} onChange={set("jobTitle")} />
            </Field>
          </div>
          <Field label="Phone" htmlFor="s-phone">
            <Input id="s-phone" type="tel" maxLength={40} value={form.phone} onChange={set("phone")} />
          </Field>
          <Field
            label={member ? "Set a new password" : "Password"}
            htmlFor="s-pass"
            hint={member ? "Leave empty to keep the current one. Changing it signs the person out everywhere." : "Optional when sending an invitation."}
          >
            <Input id="s-pass" type="password" minLength={10} autoComplete="new-password" value={form.password} onChange={set("password")} />
          </Field>
          {!member && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-primary" checked={form.sendInvite} onChange={(e) => setForm({ ...form, sendInvite: e.target.checked })} />
              Email an invitation to choose a password
            </label>
          )}
          {member && !self && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-primary" checked={form.disabled} onChange={(e) => setForm({ ...form, disabled: e.target.checked })} />
              Account disabled
            </label>
          )}
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
