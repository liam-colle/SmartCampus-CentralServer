import { Building2, DoorOpen, Radio, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { canEditCampus, useAuth } from "@/auth/AuthContext";
import { ConnectionBadge } from "@/components/DeviceBadges";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDeviceStatus } from "@/lib/DeviceStatus";
import { useFetch } from "@/lib/useFetch";
import { DEVICE_TYPE_LABEL, type Building, type Device, type Page, type StaffMember } from "@/lib/types";

function Stat({ to, icon, label, value }: { to: string; icon: ReactNode; label: string; value: number | string }) {
  return (
    <Link to={to} className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
      <Card className="gap-3 transition-colors hover:border-primary/40">
        <CardContent className="flex items-center justify-between">
          <div>
            <div className="text-sm text-muted-foreground">{label}</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums">{value}</div>
          </div>
          <div className="grid size-10 place-items-center rounded-lg bg-accent text-primary [&_svg]:size-5">{icon}</div>
        </CardContent>
      </Card>
    </Link>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const manager = canEditCampus(user);
  const buildings = useFetch<{ items: Building[] }>("/buildings");
  const staff = useFetch<Page<StaffMember>>(manager ? "/users?limit=1" : null);
  const devices = useFetch<{ items: Device[] }>(manager ? "/devices" : null);

  const activeDevices = devices.data?.items.filter((d) => d.status === "active");
  const rooms = buildings.data?.items.reduce((n, b) => n + (b.roomCount ?? 0), 0);

  return (
    <div>
      <PageHeader title="Overview" description={`Welcome back, ${user?.name}.`} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat to="/buildings" icon={<Building2 />} label="Buildings" value={buildings.data?.items.length ?? "–"} />
        <Stat to="/rooms" icon={<DoorOpen />} label="Rooms" value={rooms ?? "–"} />
        {manager && <Stat to="/devices" icon={<Radio />} label="Devices online" value={activeDevices ? `${activeDevices.filter((d) => d.online).length}/${activeDevices.length}` : "–"} />}
        {manager && <Stat to="/staff" icon={<Users />} label="People" value={staff.data?.total ?? "–"} />}
      </div>
      {manager && <DeviceHealth devices={activeDevices} />}
    </div>
  );
}

/** Compact device list with live status, the equivalent of the device panel on a UniFi site. */
function DeviceHealth({ devices }: { devices: Device[] | undefined }) {
  const { online } = useDeviceStatus();
  return (
    <Card className="mt-6">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Devices</CardTitle>
        <Link to="/devices" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Manage
        </Link>
      </CardHeader>
      <CardContent>
        {!devices ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : devices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No device enrolled yet. New devices ask to connect from the Devices page.</p>
        ) : (
          <ul className="divide-y">
            {devices.slice(0, 8).map((d) => (
              <li key={d.id}>
                <Link to={`/devices/${d.id}`} className="flex items-center gap-4 py-3 text-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60">
                  <span className="min-w-0 flex-1 truncate font-medium">{d.name || d.id}</span>
                  <span className="hidden text-muted-foreground sm:block">{DEVICE_TYPE_LABEL[d.type]}</span>
                  <ConnectionBadge status={d.status} online={online ? online.has(d.id) : d.online} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
