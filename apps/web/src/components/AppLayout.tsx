import { Building2, DoorOpen, FileUp, LayoutDashboard, LogOut, Radio, Users } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { canEditCampus, useAuth } from "@/auth/AuthContext";
import { IdleWarning } from "@/components/IdleWarning";
import { Notifications } from "@/components/Notifications";
import { Button } from "@/components/ui/button";
import { DeviceStatusProvider, useOptionalDeviceStatus } from "@/lib/DeviceStatus";
import { ROLE_LABEL } from "@/lib/types";
import { cn } from "@/lib/utils";

export function AppLayout() {
  const { user } = useAuth();
  if (!user) return null;
  // The live device channel is only open to admins and operators.
  return canEditCampus(user) ? (
    <DeviceStatusProvider>
      <Shell />
    </DeviceStatusProvider>
  ) : (
    <Shell />
  );
}

function Shell() {
  const { user, logout } = useAuth();
  const status = useOptionalDeviceStatus();
  if (!user) return null;
  const manager = canEditCampus(user);
  const waiting = status?.requests.length ?? 0;

  const links = [
    { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
    { to: "/rooms", label: "Rooms", icon: DoorOpen },
    { to: "/buildings", label: "Buildings", icon: Building2 },
    ...(manager
      ? [
          { to: "/devices", label: "Devices", icon: Radio },
          { to: "/staff", label: "Staff", icon: Users },
          { to: "/import", label: "CSV import", icon: FileUp },
        ]
      : []),
  ];

  return (
    <div className="backdrop-grid min-h-screen">
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
          <span className="font-mono text-sm tracking-[0.35em] uppercase">SmartCampus</span>
          <nav className="order-last flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
            {links.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
                    isActive && "bg-accent text-foreground",
                  )
                }
              >
                <Icon className="size-4" /> {label}
                {to === "/devices" && waiting > 0 && (
                  <span
                    className="ml-1 rounded-full bg-primary px-1.5 font-mono text-[10px] leading-4 text-primary-foreground"
                    aria-label={`${waiting} connection request${waiting === 1 ? "" : "s"} waiting`}
                  >
                    {waiting}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-right text-xs leading-tight sm:block">
              {user.name}
              <br />
              <span className="font-mono text-muted-foreground">{ROLE_LABEL[user.role]}</span>
            </span>
            <Button variant="ghost" size="sm" onClick={() => void logout()}>
              <LogOut /> <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
      <IdleWarning />
      {manager && <Notifications />}
    </div>
  );
}
