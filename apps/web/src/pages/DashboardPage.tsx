import { Building2, DoorOpen, Radio, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { canEditCampus, useAuth } from "@/auth/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { useFetch } from "@/lib/useFetch";
import type { Building, Device, Page, StaffMember } from "@/lib/types";

function Stat({ to, icon, label, value }: { to: string; icon: ReactNode; label: string; value: number | string }) {
  return (
    <Link to={to}>
      <Card className="gap-2 transition-colors hover:border-primary/50">
        <CardContent className="flex items-center gap-4">
          <div className="text-muted-foreground [&_svg]:size-6">{icon}</div>
          <div>
            <div className="font-mono text-3xl">{value}</div>
            <div className="text-sm text-muted-foreground">{label}</div>
          </div>
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
      <h1 className="font-mono text-2xl">Welcome, {user?.name}</h1>
      <p className="mt-1 text-muted-foreground">Campus overview.</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat to="/buildings" icon={<Building2 />} label="Buildings" value={buildings.data?.items.length ?? "–"} />
        <Stat to="/rooms" icon={<DoorOpen />} label="Rooms" value={rooms ?? "–"} />
        {manager && (
          <Stat
            to="/devices"
            icon={<Radio />}
            label="Devices online"
            value={activeDevices ? `${activeDevices.filter((d) => d.online).length}/${activeDevices.length}` : "–"}
          />
        )}
        {manager && <Stat to="/staff" icon={<Users />} label="People" value={staff.data?.total ?? "–"} />}
      </div>
    </div>
  );
}
