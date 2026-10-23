import {
  Building2,
  DoorOpen,
  FileUp,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  Radio,
  Siren,
  Tags,
  Users,
  Volume2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { canEditCampus, useAuth } from "@/auth/AuthContext";
import { IdleWarning } from "@/components/IdleWarning";
import { Wordmark } from "@/components/Logo";
import { Notifications } from "@/components/Notifications";
import { DeviceStatusProvider, useOptionalDeviceStatus } from "@/lib/DeviceStatus";
import { ROLE_LABEL } from "@/lib/types";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

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

/** Navigation groups, like the sections of the UniFi left rail. Managers see the control and admin groups. */
function navGroups(manager: boolean): { title: string; items: NavItem[] }[] {
  return [
    {
      title: "Campus",
      items: [
        { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
        { to: "/rooms", label: "Rooms", icon: DoorOpen },
        { to: "/buildings", label: "Buildings", icon: Building2 },
      ],
    },
    ...(manager
      ? [
          {
            title: "Control",
            items: [
              { to: "/devices", label: "Devices", icon: Radio },
              { to: "/emergency", label: "Emergency", icon: Siren },
              { to: "/announcements", label: "Announcements", icon: Megaphone },
              { to: "/intercom", label: "InterCom", icon: Volume2 },
              { to: "/statuses", label: "Room statuses", icon: Tags },
            ],
          },
          {
            title: "Administration",
            items: [
              { to: "/staff", label: "Staff", icon: Users },
              { to: "/students", label: "Students", icon: GraduationCap },
              { to: "/import", label: "CSV import", icon: FileUp },
            ],
          },
        ]
      : []),
  ];
}

function Shell() {
  const { user, logout } = useAuth();
  const status = useOptionalDeviceStatus();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // A drawer left open after navigating would cover the page it just opened.
  useEffect(() => setMenuOpen(false), [location.pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  if (!user) return null;
  const manager = canEditCampus(user);
  const waiting = status?.requests.length ?? 0;

  const nav = (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
      {navGroups(manager).map((group) => (
        <div key={group.title}>
          <div className="px-3 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{group.title}</div>
          <div className="flex flex-col gap-0.5">
            {group.items.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors outline-none hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60",
                    isActive && "bg-accent text-foreground",
                  )
                }
              >
                <Icon className="size-4" /> {label}
                {to === "/devices" && waiting > 0 && (
                  <span
                    className="ml-auto rounded-full bg-primary px-1.5 text-[11px] leading-4 font-medium text-primary-foreground"
                    aria-label={`${waiting} connection request${waiting === 1 ? "" : "s"} waiting`}
                  >
                    {waiting}
                  </span>
                )}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );

  const account = (
    <div className="flex items-center gap-3 border-t px-4 py-3">
      <div className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold" aria-hidden>
        {user.name.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1 text-xs leading-tight">
        <div className="truncate font-medium">{user.name}</div>
        <div className="text-muted-foreground">{ROLE_LABEL[user.role]}</div>
      </div>
      <button
        aria-label="Sign out"
        title="Sign out"
        onClick={() => void logout()}
        className="rounded-md p-2 text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <LogOut className="size-4" />
      </button>
    </div>
  );

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-sidebar md:flex">
        <div className="flex h-14 items-center border-b px-5">
          <Wordmark />
        </div>
        {nav}
        {account}
      </aside>

      <div className="md:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur md:px-8">
          <button
            aria-label="Open menu"
            className="rounded-md p-2 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 md:hidden"
            onClick={() => setMenuOpen(true)}
          >
            <Menu className="size-5" />
          </button>
          <Wordmark className="md:hidden" />
          {status && (
            <span
              className="ml-auto flex items-center gap-2 text-xs text-muted-foreground"
              title={status.live ? "Receiving live updates from the server" : "Live updates are interrupted, reconnecting"}
            >
              <span className={cn("size-2 rounded-full", status.live ? "bg-primary" : "bg-muted-foreground")} aria-hidden />
              {status.live ? "Live" : "Reconnecting"}
            </span>
          )}
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8 md:px-8">
          <Outlet />
        </main>
      </div>

      {menuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button aria-label="Close menu" className="absolute inset-0 bg-black/60" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col border-r bg-sidebar">
            <div className="flex h-14 items-center justify-between border-b px-5">
              <Wordmark />
              <button aria-label="Close menu" className="rounded-md p-1.5 text-muted-foreground hover:text-foreground" onClick={() => setMenuOpen(false)}>
                <X className="size-4" />
              </button>
            </div>
            {nav}
            {account}
          </aside>
        </div>
      )}

      <IdleWarning />
      {manager && <Notifications />}
    </div>
  );
}
