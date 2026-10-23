import { WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { StatusIcon } from "@/components/StatusBadge";
import { DEFAULT_DISPLAY_CONFIG, floorLabel, isInWindow, type AnnouncePriority, type DisplayConfig, type StatusIconName } from "@/lib/types";

export interface PreviewRoom {
  code: string;
  name: string;
  building: string;
  floor: number;
  capacity: number | null;
}

export interface PreviewStatus {
  label: string;
  color: string;
  icon: StatusIconName;
}

export interface PreviewAnnouncement {
  id: string;
  title?: string;
  text: string;
  priority: AnnouncePriority;
}

/** Banner colour per priority, the same ones the door app uses. */
const PRIORITY_COLOR: Record<AnnouncePriority, string> = { info: "", important: "#f5a524", urgent: "#e5484d" };

const THEMES = {
  dark: { background: "#0e0f10", surface: "#1a1d1f", text: "#e8f1ec", muted: "#8a9a92" },
  light: { background: "#f3f6f4", surface: "#ffffff", text: "#14231b", muted: "#5d6d64" },
} as const;

const useClock = () => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return now;
};

/**
 * What a door screen shows, drawn from the digital twin (room, status, announcements, configuration).
 * It mirrors the layouts of the door app; when the device is offline it says the screen keeps its cached state.
 */
export function DoorPreview({
  room,
  status,
  announcements,
  config = DEFAULT_DISPLAY_CONFIG,
  online,
}: {
  room: PreviewRoom | null;
  status: PreviewStatus | null;
  announcements: PreviewAnnouncement[];
  config?: DisplayConfig;
  online: boolean;
}) {
  const now = useClock();
  const theme = THEMES[config.theme];
  const asleep = isInWindow(config.sleep, now);
  const banner = config.show.announcements ? [...announcements].sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority))[0] : undefined;
  const bannerColor = banner ? PRIORITY_COLOR[banner.priority] || config.accentColor : config.accentColor;

  return (
    <figure className="m-0">
      <div
        className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl border-4 border-[#2a2e30] shadow-inner"
        style={{ backgroundColor: asleep ? "#000" : theme.background, color: theme.text }}
        role="img"
        aria-label={asleep ? "Preview: the screen is asleep" : `Preview of the door screen${room ? ` of room ${room.code}` : ""}`}
      >
        {asleep ? (
          <div className="grid h-full place-items-center text-sm text-[#555]">Screen asleep until {config.sleep.to}</div>
        ) : (
          <div className="flex h-full flex-col p-[4%] text-[min(2.2vw,13px)]">
            {config.layout === "split" ? (
              <div className="grid flex-1 grid-cols-2 gap-[4%]">
                <RoomBlock room={room} status={status} config={config} theme={theme} now={now} />
                <div className="flex flex-col gap-2 overflow-hidden rounded-xl p-[6%]" style={{ backgroundColor: theme.surface }}>
                  <div style={{ color: theme.muted }}>Announcements</div>
                  {announcements.length === 0 && <div style={{ color: theme.muted }}>Nothing to show.</div>}
                  {announcements.slice(0, 3).map((a) => (
                    <Banner key={a.id} announcement={a} color={PRIORITY_COLOR[a.priority] || config.accentColor} />
                  ))}
                </div>
              </div>
            ) : (
              <>
                <RoomBlock room={room} status={status} config={config} theme={theme} now={now} compact={config.layout === "compact"} />
                {banner && <Banner announcement={banner} color={bannerColor} className="mt-[3%]" />}
              </>
            )}
          </div>
        )}
        {!online && (
          <div className="absolute top-2 right-2 flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-[11px] text-white">
            <WifiOff className="size-3" aria-hidden /> Offline, showing cached state
          </div>
        )}
      </div>
      <figcaption className="mt-2 text-xs text-muted-foreground">Preview from the digital twin, updated live while the device reports.</figcaption>
    </figure>
  );
}

const priorityRank = (p: AnnouncePriority) => ({ info: 0, important: 1, urgent: 2 })[p];

function RoomBlock({
  room,
  status,
  config,
  theme,
  now,
  compact,
}: {
  room: PreviewRoom | null;
  status: PreviewStatus | null;
  config: DisplayConfig;
  theme: (typeof THEMES)[keyof typeof THEMES];
  now: Date;
  compact?: boolean;
}) {
  const place = [config.show.building && room?.building, config.show.floor && room && floorLabel(room.floor)].filter(Boolean).join(" · ");
  return (
    <div className="flex flex-1 flex-col justify-between">
      <div>
        <div style={{ color: theme.muted }}>{place || " "}</div>
        {config.show.roomName && (
          <div className={compact ? "text-[2.2em] font-semibold" : "text-[3.4em] leading-tight font-semibold"}>
            {room ? room.name || room.code : "No room linked"}
          </div>
        )}
        {config.show.roomName && room?.name && <div style={{ color: theme.muted }}>{room.code}</div>}
      </div>
      <div
        className="flex items-center gap-[3%] rounded-xl px-[4%] py-[3%] font-semibold"
        style={{ backgroundColor: `${status?.color ?? config.accentColor}26`, color: status?.color ?? theme.muted }}
      >
        {status && <StatusIcon name={status.icon} className="size-[2.2em]" />}
        <span className={compact ? "text-[1.8em]" : "text-[2.4em]"}>{status?.label ?? "No status"}</span>
      </div>
      <div className="flex items-end justify-between" style={{ color: theme.muted }}>
        <span>{config.show.capacity && room?.capacity != null ? `${room.capacity} seats` : " "}</span>
        {config.show.clock && <span className="text-[1.6em] font-medium" style={{ color: theme.text }}>{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
      </div>
    </div>
  );
}

function Banner({ announcement, color, className = "" }: { announcement: PreviewAnnouncement; color: string; className?: string }) {
  return (
    <div className={`rounded-lg border-l-4 px-[3%] py-[1.5%] ${className}`} style={{ borderColor: color, backgroundColor: `${color}22` }}>
      {announcement.title && <div className="font-semibold">{announcement.title}</div>}
      <div className="line-clamp-2">{announcement.text}</div>
    </div>
  );
}
