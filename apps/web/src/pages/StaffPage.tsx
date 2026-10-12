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
import { ROLE_LABEL, type Page, type Role, type StaffMember } from "@/lib/types";
import { useDebounced, useFetch } from "@/lib/useFetch";

const PAGE_SIZE = 25;

export function StaffPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  // Operators manage staff accounts only.
  const assignable: Role[] = isAdmin ? ["staff", "operator", "admin"] : ["staff"];
  const canManage = (m: StaffMember) => isAdmin || m.role === "staff";

  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  useEffect(() => setPage(1), [q, role]);

  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (q) params.set("q", q);
  if (role) params.set("role", role);
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
        <h1 className="font-mono text-2xl">Staff</h1>
        <Button onClick={() => setEditing("new")}>
          <Plus /> Add person
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search people" placeholder="Search name, email, department…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">All roles</option>
          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
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
            <TableHead>Role</TableHead>
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
              <TableCell className="font-mono text-xs">{m.email}</TableCell>
              <TableCell>{ROLE_LABEL[m.role]}</TableCell>
              <TableCell>{m.department || "–"}</TableCell>
              <TableCell className="text-muted-foreground">{m.disabled ? "Disabled" : m.hasPassword ? "Active" : "Invite pending"}</TableCell>
              <TableCell>
                {canManage(m) && (
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={m.hasPassword ? `Send password reset to ${m.email}` : `Send invitation to ${m.email}`}
                      title={m.hasPassword ? "Send password reset" : "Send invitation"}
                      onClick={() => void run(() => api(`/users/${m.id}/invite`, { method: "POST" }), `Email sent to ${m.email}.`)}
                    >
                      <Mail />
                    </Button>
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
          roles={assignable}
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
  roles,
  self,
  onClose,
  onSaved,
}: {
  member: StaffMember | null;
  roles: Role[];
  self: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: member?.name ?? "",
    email: member?.email ?? "",
    role: (member?.role ?? "staff") as Role,
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
    const { password, sendInvite, disabled, ...fields } = form;
    try {
      if (member) {
        await api(`/users/${member.id}`, {
          method: "PATCH",
          body: { ...fields, disabled, ...(password && { password }) },
        });
      } else {
        await api("/users", { body: { ...fields, ...(password && { password }), sendInvite } });
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
            <Field label="Role" htmlFor="s-role">
              <Select id="s-role" value={form.role} disabled={self} onChange={set("role")}>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Email" htmlFor="s-email">
            <Input id="s-email" type="email" required value={form.email} onChange={set("email")} />
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
