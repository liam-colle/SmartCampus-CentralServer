import { ShieldAlert, X } from "lucide-react";
import { useState } from "react";
import { EmergencyPreview } from "@/components/EmergencyPreview";
import { ErrorText, Field } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { emptyTargetState, TargetPicker, toTargets, type TargetState } from "@/components/TargetPicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { useDeviceStatus } from "@/lib/DeviceStatus";
import { timeAgo, type Emergency, type EmergencyInfo, type EmergencyKind, type Page } from "@/lib/types";
import { useFetch, useOnChange } from "@/lib/useFetch";

export function EmergencyPage() {
  const catalogue = useFetch<{ items: EmergencyInfo[] }>("/emergencies/catalogue");
  const active = useFetch<Page<Emergency>>("/emergencies?status=active&limit=50");
  const history = useFetch<Page<Emergency>>("/emergencies?limit=20");
  const { version } = useDeviceStatus();

  const reloadAll = () => {
    active.reload();
    history.reload();
  };
  // Another console may trigger or clear an alert, and a screen starts reporting it: stay current.
  useOnChange(version, reloadAll);
  const infoOf = (kind: EmergencyKind) => catalogue.data?.items.find((i) => i.kind === kind);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Emergency alerts"
        description="Takes over the door screens and sounds an alarm until you end it. A test uses the same screens with a quiet alarm."
      />
      <ErrorText>{catalogue.error ?? active.error}</ErrorText>

      {active.data && active.data.items.length > 0 && <ActiveAlerts alerts={active.data.items} onChanged={reloadAll} />}

      {catalogue.data && <Trigger catalogue={catalogue.data.items} onTriggered={reloadAll} />}

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">History</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Alert</TableHead>
              <TableHead>Screens</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Ended</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.data?.items.map((e) => (
              <TableRow key={e.id}>
                <TableCell>
                  <span className="mr-2 inline-block size-2 rounded-full align-middle" style={{ background: infoOf(e.kind)?.color }} aria-hidden />
                  <span className="font-medium">{e.title}</span>
                  {e.testMode && <Badge variant="muted" className="ml-2">Test</Badge>}
                </TableCell>
                <TableCell>{e.deviceCount}</TableCell>
                <TableCell className="text-muted-foreground">
                  {e.startedBy}, {timeAgo(e.startedAt)}
                </TableCell>
                <TableCell className="text-muted-foreground">{e.clearedAt ? `${e.clearedBy}, ${timeAgo(e.clearedAt)}` : "–"}</TableCell>
                <TableCell>
                  <Badge variant={e.status === "active" ? "destructive" : "muted"}>{e.status === "active" ? "Sounding" : "Ended"}</Badge>
                </TableCell>
              </TableRow>
            ))}
            {!history.loading && history.data?.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  <ShieldAlert className="mx-auto mb-2 size-6" /> No alert has been triggered yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function ActiveAlerts({ alerts, onChanged }: { alerts: Emergency[]; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);

  async function end(alert: Emergency) {
    setError(null);
    try {
      await api(`/emergencies/${alert.id}`, { method: "DELETE" });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not end the alert");
    }
  }

  return (
    <section aria-label="Active alerts" className="flex flex-col gap-3 rounded-xl border border-destructive/50 bg-destructive/5 p-4">
      <h2 className="text-base font-semibold text-destructive">{alerts.length === 1 ? "An alert is active" : `${alerts.length} alerts are active`}</h2>
      <ErrorText>{error}</ErrorText>
      {alerts.map((alert) => (
        <ActiveAlert key={alert.id} alert={alert} onEnd={() => void end(alert)} />
      ))}
    </section>
  );
}

function ActiveAlert({ alert, onEnd }: { alert: Emergency; onEnd: () => void }) {
  const { version } = useDeviceStatus();
  const detail = useFetch<{ delivery: { deviceId: string; name: string; showing: boolean }[] }>(`/emergencies/${alert.id}`);
  useOnChange(version, detail.reload);

  const showing = detail.data?.delivery.filter((d) => d.showing).length ?? 0;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="font-medium">
          {alert.title}
          {alert.testMode && <Badge variant="muted" className="ml-2">Test</Badge>}
        </div>
        <div className="text-sm text-muted-foreground">
          Started by {alert.startedBy}, {timeAgo(alert.startedAt)}. Showing on {showing} of {alert.deviceCount} screen{alert.deviceCount === 1 ? "" : "s"}.
        </div>
      </div>
      <Button variant="destructive" onClick={onEnd}>
        <X /> End alert
      </Button>
    </div>
  );
}

function Trigger({ catalogue, onTriggered }: { catalogue: EmergencyInfo[]; onTriggered: () => void }) {
  const [kind, setKind] = useState<EmergencyKind>("fire");
  const [testMode, setTestMode] = useState(true);
  const [testVolume, setTestVolume] = useState(20);
  const [targets, setTargets] = useState<TargetState>(emptyTargetState());
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const info = catalogue.find((i) => i.kind === kind)!;

  async function send() {
    const chosen = toTargets(targets);
    if (!chosen) return setError("Choose which screens to alert");
    setBusy(true);
    setError(null);
    try {
      await api("/emergencies", { body: { kind, targets: chosen, testMode, testVolume } });
      setConfirming(false);
      onTriggered();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not trigger the alert");
    } finally {
      setBusy(false);
    }
  }

  function onClick() {
    // A test needs no second click; a real alert does, because it sounds a full-volume alarm in the building.
    if (testMode || confirming) void send();
    else setConfirming(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trigger an alert</CardTitle>
        <CardDescription>Choose the emergency, whether it is a test, and where to send it.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <div role="group" aria-label="Kind of emergency" className="grid grid-cols-2 gap-2">
            {catalogue.map((i) => (
              <button
                key={i.kind}
                type="button"
                aria-pressed={i.kind === kind}
                onClick={() => {
                  setKind(i.kind);
                  setConfirming(false);
                }}
                className="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/40 aria-pressed:bg-accent aria-pressed:font-medium"
                style={i.kind === kind ? { borderColor: i.color } : undefined}
              >
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: i.color }} aria-hidden />
                {i.title}
              </button>
            ))}
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 accent-primary"
              checked={testMode}
              onChange={(e) => {
                setTestMode(e.target.checked);
                setConfirming(false);
              }}
            />
            <span>
              <span className="font-medium">Test mode</span>
              <span className="block text-muted-foreground">The screen says it is a test and the alarm plays quietly. Quiet hours still apply.</span>
            </span>
          </label>

          {testMode ? (
            <Field label={`Test volume: ${testVolume}%`} htmlFor="e-volume">
              <input id="e-volume" type="range" min={0} max={100} step={5} value={testVolume} onChange={(e) => setTestVolume(Number(e.target.value))} className="w-full accent-primary" />
            </Field>
          ) : (
            <p className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
              {info.loud ? "Real alert: the alarm plays at full volume and ignores each screen's volume and quiet hours." : "Real alert: a soft chime plays. It ignores quiet hours."}
            </p>
          )}

          <TargetPicker value={targets} onChange={(t) => (setTargets(t), setConfirming(false))} />
          <ErrorText>{error}</ErrorText>

          <div className="flex gap-2">
            <Button variant={testMode ? "default" : "destructive"} disabled={busy} onClick={onClick}>
              {busy ? "Sending…" : testMode ? "Start test" : confirming ? "Confirm: sound the alarm" : "Trigger alert"}
            </Button>
            {confirming && (
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">What the door screens will show</h3>
          <EmergencyPreview kind={kind} color={info.color} title={info.title} instructions={info.instructions} testMode={testMode} />
        </div>
      </CardContent>
    </Card>
  );
}
