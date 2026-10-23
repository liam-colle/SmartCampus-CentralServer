import { useMemo } from "react";
import { Field } from "@/components/Field";
import { Select } from "@/components/ui/select";
import { floorLabel, type Building, type Device, type Targets } from "@/lib/types";
import { useFetch } from "@/lib/useFetch";

export type TargetScope = "all" | "buildings" | "floor" | "groups" | "devices";

const SCOPES: { value: TargetScope; label: string }[] = [
  { value: "all", label: "Every screen" },
  { value: "buildings", label: "Buildings" },
  { value: "floor", label: "A floor of a building" },
  { value: "groups", label: "Device groups" },
  { value: "devices", label: "Specific devices" },
];

export interface TargetState {
  scope: TargetScope;
  buildings: string[];
  floorBuilding: string;
  floor: string;
  groups: string[];
  devices: string[];
}

export const emptyTargetState = (): TargetState => ({ scope: "all", buildings: [], floorBuilding: "", floor: "", groups: [], devices: [] });

/** Turns the picker state into the API shape. Returns null while nothing valid is chosen. */
export function toTargets(t: TargetState): Targets | null {
  if (t.scope === "all") return { all: true };
  if (t.scope === "buildings") return t.buildings.length ? { buildings: t.buildings } : null;
  if (t.scope === "floor") return t.floorBuilding && t.floor !== "" ? { floors: [{ building: t.floorBuilding, floor: Number(t.floor) }] } : null;
  if (t.scope === "groups") return t.groups.length ? { groups: t.groups } : null;
  return t.devices.length ? { devices: t.devices } : null;
}

const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

function CheckList({ legend, items, checked, onToggle, empty }: { legend: string; items: { value: string; label: string }[]; checked: string[]; onToggle: (v: string) => void; empty: string }) {
  return (
    <fieldset className="flex max-h-44 flex-col gap-1 overflow-y-auto rounded-lg border bg-background p-2">
      <legend className="sr-only">{legend}</legend>
      {items.length === 0 && <p className="px-2 py-1 text-sm text-muted-foreground">{empty}</p>}
      {items.map((item) => (
        <label key={item.value} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50">
          <input type="checkbox" className="accent-primary" checked={checked.includes(item.value)} onChange={() => onToggle(item.value)} />
          {item.label}
        </label>
      ))}
    </fieldset>
  );
}

/** Chooses which screens a message is for: everyone, buildings, a floor, groups or devices. */
export function TargetPicker({ value, onChange }: { value: TargetState; onChange: (next: TargetState) => void }) {
  const buildings = useFetch<{ items: Building[] }>("/buildings");
  const devices = useFetch<{ items: Device[] }>("/devices");
  const floors = useFetch<{ items: number[] }>(value.scope === "floor" && value.floorBuilding ? `/rooms/floors?building=${value.floorBuilding}` : null);

  const screens = useMemo(() => (devices.data?.items ?? []).filter((d) => d.status === "active" && d.type !== "access"), [devices.data]);
  const groups = useMemo(() => [...new Set(screens.flatMap((d) => d.groups))].sort(), [screens]);
  const set = (patch: Partial<TargetState>) => onChange({ ...value, ...patch });

  return (
    <div className="flex flex-col gap-3">
      <Field label="Send to" htmlFor="t-scope">
        <Select id="t-scope" value={value.scope} onChange={(e) => set({ scope: e.target.value as TargetScope })}>
          {SCOPES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </Field>

      {value.scope === "all" && <p className="text-sm text-muted-foreground">{screens.length} active screen{screens.length === 1 ? "" : "s"}.</p>}

      {value.scope === "buildings" && (
        <CheckList
          legend="Buildings"
          items={(buildings.data?.items ?? []).map((b) => ({ value: b.id, label: `${b.code} – ${b.name}` }))}
          checked={value.buildings}
          onToggle={(id) => set({ buildings: toggle(value.buildings, id) })}
          empty="No building yet."
        />
      )}

      {value.scope === "floor" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Select aria-label="Building" value={value.floorBuilding} onChange={(e) => set({ floorBuilding: e.target.value, floor: "" })}>
            <option value="">Building…</option>
            {buildings.data?.items.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} – {b.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Floor" value={value.floor} disabled={!value.floorBuilding} onChange={(e) => set({ floor: e.target.value })}>
            <option value="">Floor…</option>
            {floors.data?.items.map((f) => (
              <option key={f} value={f}>
                {floorLabel(f)}
              </option>
            ))}
          </Select>
        </div>
      )}

      {value.scope === "groups" && (
        <CheckList
          legend="Device groups"
          items={groups.map((g) => ({ value: g, label: g }))}
          checked={value.groups}
          onToggle={(g) => set({ groups: toggle(value.groups, g) })}
          empty="No device has a group yet. Add groups in a device's settings."
        />
      )}

      {value.scope === "devices" && (
        <CheckList
          legend="Devices"
          items={screens.map((d) => ({ value: d.id, label: d.name || d.id }))}
          checked={value.devices}
          onToggle={(id) => set({ devices: toggle(value.devices, id) })}
          empty="No active screen."
        />
      )}
    </div>
  );
}
