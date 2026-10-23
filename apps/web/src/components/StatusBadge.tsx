import { Ban, BookOpen, Calendar, Check, Clock, Coffee, Info, Lock, TriangleAlert, User, Wrench, WifiOff, type LucideIcon } from "lucide-react";
import type { StatusIconName } from "@/lib/types";

const ICONS: Record<StatusIconName, LucideIcon> = {
  check: Check,
  user: User,
  lock: Lock,
  wrench: Wrench,
  calendar: Calendar,
  clock: Clock,
  alert: TriangleAlert,
  info: Info,
  book: BookOpen,
  coffee: Coffee,
  ban: Ban,
  "wifi-off": WifiOff,
};

export const StatusIcon = ({ name, className }: { name: StatusIconName; className?: string }) => {
  const Icon = ICONS[name] ?? Info;
  return <Icon className={className} aria-hidden />;
};

/** A status chip. The colour belongs to the status (chosen by an admin), so it is applied inline. */
export function StatusBadge({ label, color, icon }: { label: string; color: string; icon?: StatusIconName }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap"
      style={{ color, borderColor: `${color}66`, backgroundColor: `${color}1a` }}
    >
      {icon ? <StatusIcon name={icon} className="size-3" /> : <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} aria-hidden />}
      {label}
    </span>
  );
}
