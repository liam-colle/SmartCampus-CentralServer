import { Copy, Save } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { DoorPreview, type PreviewAnnouncement, type PreviewRoom, type PreviewStatus } from "@/components/DoorPreview";
import { ErrorText, Field } from "@/components/Field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";
import { DEFAULT_DISPLAY_CONFIG, type Device, type DisplayConfig } from "@/lib/types";
import { useFetch } from "@/lib/useFetch";

const LAYOUTS = [
  { value: "standard", label: "Standard: room, status and one announcement" },
  { value: "compact", label: "Compact: smaller room name, more room for the banner" },
  { value: "split", label: "Split: room on the left, announcements on the right" },
] as const;

const ELEMENTS: { key: keyof DisplayConfig["show"]; label: string }[] = [
  { key: "roomName", label: "Room name" },
  { key: "building", label: "Building" },
  { key: "floor", label: "Floor" },
  { key: "capacity", label: "Capacity" },
  { key: "clock", label: "Clock" },
  { key: "announcements", label: "Announcements" },
];

interface PreviewData {
  room: PreviewRoom | null;
  status: PreviewStatus | null;
  announcements: PreviewAnnouncement[];
  online: boolean;
}

/** Layout, theme, visible elements and night sleep of a door screen, with a live preview of the draft. */
export function DisplayConfigEditor({ device, preview }: { device: Device; preview: PreviewData }) {
  const saved = useFetch<DisplayConfig>(`/devices/${device.id}/display-config`);
  const [draft, setDraft] = useState<DisplayConfig>(DEFAULT_DISPLAY_CONFIG);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    if (saved.data) setDraft(saved.data);
  }, [saved.data]);

  const dirty = saved.data !== null && JSON.stringify(saved.data) !== JSON.stringify(draft);
  const patch = (p: Partial<DisplayConfig>) => setDraft((d) => ({ ...d, ...p }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(`/devices/${device.id}/display-config`, { method: "PUT", body: draft });
      setNotice(preview.online ? "Sent to the screen." : "Saved. The screen is offline and will apply it when it reconnects.");
      saved.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the configuration");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Display configuration</CardTitle>
          <CardDescription>The screen applies it as soon as it receives it, and keeps it through an outage.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <Field label="Layout" htmlFor="cfg-layout">
              <Select id="cfg-layout" value={draft.layout} onChange={(e) => patch({ layout: e.target.value as DisplayConfig["layout"] })}>
                {LAYOUTS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Theme" htmlFor="cfg-theme">
                <Select id="cfg-theme" value={draft.theme} onChange={(e) => patch({ theme: e.target.value as DisplayConfig["theme"] })}>
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </Select>
              </Field>
              <Field label="Accent colour" htmlFor="cfg-accent">
                <input
                  id="cfg-accent"
                  type="color"
                  className="h-9 w-full cursor-pointer rounded-lg border border-input bg-background p-1"
                  value={draft.accentColor}
                  onChange={(e) => patch({ accentColor: e.target.value })}
                />
              </Field>
            </div>

            <fieldset>
              <legend className="mb-2 text-sm font-medium">Shown on the screen</legend>
              <div className="grid grid-cols-2 gap-2">
                {ELEMENTS.map(({ key, label }) => (
                  <label key={key} className="flex cursor-pointer items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      className="accent-primary"
                      checked={draft.show[key]}
                      onChange={(e) => patch({ show: { ...draft.show, [key]: e.target.checked } })}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-sm font-medium">Night sleep</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="accent-primary" checked={draft.sleep.enabled} onChange={(e) => patch({ sleep: { ...draft.sleep, enabled: e.target.checked } })} />
                Turn the screen off at night
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="From" htmlFor="cfg-sleep-from">
                  <Input id="cfg-sleep-from" type="time" disabled={!draft.sleep.enabled} value={draft.sleep.from} onChange={(e) => patch({ sleep: { ...draft.sleep, from: e.target.value } })} />
                </Field>
                <Field label="To" htmlFor="cfg-sleep-to">
                  <Input id="cfg-sleep-to" type="time" disabled={!draft.sleep.enabled} value={draft.sleep.to} onChange={(e) => patch({ sleep: { ...draft.sleep, to: e.target.value } })} />
                </Field>
              </div>
            </fieldset>

            <ErrorText>{error ?? saved.error}</ErrorText>
            {notice && (
              <p role="status" className="text-sm">
                {notice}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={busy || !dirty}>
                <Save /> {busy ? "Saving…" : "Save and send"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setCopying(true)} disabled={dirty} title={dirty ? "Save first, the copy uses the saved configuration" : undefined}>
                <Copy /> Duplicate to other screens
              </Button>
              {dirty && <Badge variant="muted">Unsaved changes</Badge>}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preview</CardTitle>
          <CardDescription>Shows your draft with the room, status and announcements the screen has now.</CardDescription>
        </CardHeader>
        <CardContent>
          <DoorPreview {...preview} config={draft} />
        </CardContent>
      </Card>

      {copying && <CopyDialog source={device} onClose={() => setCopying(false)} />}
    </div>
  );
}

interface CopyResult {
  deviceId: string;
  ok: boolean;
  error?: string;
}

function CopyDialog({ source, onClose }: { source: Device; onClose: () => void }) {
  const devices = useFetch<{ items: Device[] }>("/devices");
  const [chosen, setChosen] = useState<string[]>([]);
  const [results, setResults] = useState<CopyResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const targets = (devices.data?.items ?? []).filter((d) => d.status === "active" && d.type !== "access" && d.id !== source.id);
  const nameOf = (id: string) => targets.find((d) => d.id === id)?.name || id;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ results: CopyResult[] }>(`/devices/${source.id}/display-config/copy`, { body: { targetIds: chosen } });
      setResults(r.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Copy failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Duplicate the configuration of {source.name || source.id}</DialogTitle>
        </DialogHeader>
        {results ? (
          <ul className="flex flex-col gap-2 text-sm" aria-label="Result per screen">
            {results.map((r) => (
              <li key={r.deviceId} className="flex items-center justify-between gap-3">
                <span>{nameOf(r.deviceId)}</span>
                {r.ok ? <Badge>Sent</Badge> : <Badge variant="destructive">{r.error ?? "Failed"}</Badge>}
              </li>
            ))}
          </ul>
        ) : (
          <fieldset className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-lg border bg-background p-2">
            <legend className="sr-only">Screens to copy to</legend>
            {targets.length === 0 && <p className="px-2 py-1 text-sm text-muted-foreground">No other screen.</p>}
            {targets.map((d) => (
              <label key={d.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={chosen.includes(d.id)}
                  onChange={() => setChosen((c) => (c.includes(d.id) ? c.filter((x) => x !== d.id) : [...c, d.id]))}
                />
                {d.name || d.id}
              </label>
            ))}
          </fieldset>
        )}
        <ErrorText>{error}</ErrorText>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {results ? "Close" : "Cancel"}
          </Button>
          {!results && (
            <Button type="button" disabled={busy || chosen.length === 0} onClick={() => void send()}>
              {busy ? "Sending…" : `Copy to ${chosen.length} screen${chosen.length === 1 ? "" : "s"}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
