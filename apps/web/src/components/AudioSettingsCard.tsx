import { Save } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ErrorText, Field } from "@/components/Field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { DEFAULT_AUDIO_SETTINGS, type AudioSettings, type Device } from "@/lib/types";

/** Speaker volume and quiet hours of one device. The device enforces them, also while offline. */
export function AudioSettingsCard({ device, online }: { device: Device; online: boolean }) {
  const current = (device.desired.audioSettings as AudioSettings | undefined) ?? DEFAULT_AUDIO_SETTINGS;
  const [form, setForm] = useState<AudioSettings>(current);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(`/devices/${device.id}/audio-settings`, { method: "PUT", body: form });
      setNotice(online ? "Sent to the device." : "Saved. The device is offline and will apply it when it reconnects.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the audio settings");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Audio</CardTitle>
        <CardDescription>InterCom broadcasts that arrive during quiet hours are acknowledged but not played.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field label={`Volume: ${form.volume}%`} htmlFor="audio-volume">
            <input
              id="audio-volume"
              type="range"
              min={0}
              max={100}
              step={5}
              className="w-full accent-primary"
              value={form.volume}
              onChange={(e) => setForm({ ...form, volume: Number(e.target.value) })}
            />
          </Field>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-medium">Quiet hours</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-primary"
                checked={form.quietHours.enabled}
                onChange={(e) => setForm({ ...form, quietHours: { ...form.quietHours, enabled: e.target.checked } })}
              />
              Stay silent during a time window
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="From" htmlFor="quiet-from">
                <Input id="quiet-from" type="time" disabled={!form.quietHours.enabled} value={form.quietHours.from} onChange={(e) => setForm({ ...form, quietHours: { ...form.quietHours, from: e.target.value } })} />
              </Field>
              <Field label="To" htmlFor="quiet-to">
                <Input id="quiet-to" type="time" disabled={!form.quietHours.enabled} value={form.quietHours.to} onChange={(e) => setForm({ ...form, quietHours: { ...form.quietHours, to: e.target.value } })} />
              </Field>
            </div>
          </fieldset>
          <ErrorText>{error}</ErrorText>
          {notice && (
            <p role="status" className="text-sm">
              {notice}
            </p>
          )}
          <div>
            <Button type="submit" disabled={busy}>
              <Save /> {busy ? "Saving…" : "Save and send"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
