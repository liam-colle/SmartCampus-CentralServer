import { Radio, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AudioRecorder } from "@/components/AudioRecorder";
import { ErrorText, Field } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { emptyTargetState, TargetPicker, toTargets, type TargetState } from "@/components/TargetPicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { formatBytes, timeAgo, type Announcement, type Asset, type Page } from "@/lib/types";
import { useFetch } from "@/lib/useFetch";

export function IntercomPage() {
  const assets = useFetch<{ items: Asset[] }>("/assets");
  const broadcasts = useFetch<Page<Announcement>>("/announcements?kind=audio&limit=20");
  const [broadcasting, setBroadcasting] = useState<Asset | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function remove(a: Asset) {
    if (!confirm(`Delete the sound "${a.name}"?`)) return;
    setActionError(null);
    try {
      await api(`/assets/${a.id}`, { method: "DELETE" });
      assets.reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="InterCom" description="Record or import a sound, then play it on the speakers of the screens you choose." />

      <NewSound onSaved={assets.reload} />

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Sound library</h2>
        <ErrorText>{assets.error ?? actionError}</ErrorText>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Listen</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Added</TableHead>
              <TableHead className="w-40" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {assets.data?.items.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">{a.name}</TableCell>
                <TableCell>
                  <audio controls preload="none" src={`/api/assets/${a.id}/file`} className="h-8 max-w-56" aria-label={`Listen to ${a.name}`} />
                </TableCell>
                <TableCell className="text-muted-foreground">{formatBytes(a.size)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {a.createdBy}, {timeAgo(a.createdAt)}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button size="sm" onClick={() => setBroadcasting(a)}>
                      <Radio /> Broadcast
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={`Delete ${a.name}`} onClick={() => void remove(a)}>
                      <Trash2 />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!assets.loading && assets.data?.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No sound yet. Record or import one above.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Recent broadcasts</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sound</TableHead>
              <TableHead>Screens</TableHead>
              <TableHead>By</TableHead>
              <TableHead>When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {broadcasts.data?.items.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="font-medium">{b.title}</TableCell>
                <TableCell>{b.deviceCount}</TableCell>
                <TableCell className="text-muted-foreground">{b.createdBy}</TableCell>
                <TableCell className="text-muted-foreground">{timeAgo(b.createdAt)}</TableCell>
              </TableRow>
            ))}
            {!broadcasts.loading && broadcasts.data?.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                  Nothing broadcast yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>

      {broadcasting && (
        <BroadcastDialog
          asset={broadcasting}
          onClose={() => setBroadcasting(null)}
          onSent={() => {
            setBroadcasting(null);
            broadcasts.reload();
          }}
        />
      )}
    </div>
  );
}

/** Record in the browser or import a file; either way it ends up in the library after a name is given. */
function NewSound({ onSaved }: { onSaved: () => void }) {
  const [clip, setClip] = useState<Blob | null>(null);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!clip) return setClipUrl(null);
    const url = URL.createObjectURL(clip);
    setClipUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [clip]);

  function pick(blob: Blob, suggestedName: string) {
    setError(null);
    setClip(blob);
    setName((current) => current || suggestedName);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!clip) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/assets?name=${encodeURIComponent(name.trim())}`, { file: clip });
      setClip(null);
      setName("");
      if (fileInput.current) fileInput.current.value = "";
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New sound</CardTitle>
        <CardDescription>WAV, MP3, Ogg, WebM or M4A, up to the size the server allows.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <AudioRecorder onRecorded={(blob) => pick(blob, `Recording ${new Date().toLocaleTimeString()}`)} onError={setError} />
            <Button type="button" variant="outline" onClick={() => fileInput.current?.click()}>
              <Upload /> Import a file
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="audio/*"
              className="sr-only"
              aria-label="Audio file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) pick(file, file.name.replace(/\.[^.]+$/, ""));
              }}
            />
          </div>
          {clip && clipUrl && (
            <div className="flex flex-col gap-4">
              <audio controls src={clipUrl} className="h-10 w-full max-w-md" aria-label="Preview of the new sound" />
              <Field label="Name" htmlFor="sound-name">
                <Input id="sound-name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} className="max-w-md" />
              </Field>
              <div>
                <Button type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Save to library"}
                </Button>
              </div>
            </div>
          )}
          <ErrorText>{error}</ErrorText>
        </form>
      </CardContent>
    </Card>
  );
}

function BroadcastDialog({ asset, onClose, onSent }: { asset: Asset; onClose: () => void; onSent: () => void }) {
  const [targets, setTargets] = useState<TargetState>(emptyTargetState());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const chosen = toTargets(targets);
    if (!chosen) return setError("Choose where to play it");
    setBusy(true);
    setError(null);
    try {
      await api("/intercom/broadcasts", { body: { assetId: asset.id, targets: chosen } });
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Broadcast failed");
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Broadcast "{asset.name}"</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <TargetPicker value={targets} onChange={setTargets} />
          <p className="text-sm text-muted-foreground">
            Screens that are offline play it only if they come back within <Badge variant="muted">5 minutes</Badge>. Devices skip it during their quiet hours.
          </p>
          <ErrorText>{error}</ErrorText>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Sending…" : "Play now"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
