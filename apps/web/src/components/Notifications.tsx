import { Link } from "react-router-dom";
import { PlugZap, WifiOff, X } from "lucide-react";
import { useDeviceStatus } from "@/lib/DeviceStatus";
import { cn } from "@/lib/utils";

/** Console toasts: a device dropped off the network, or a new device is asking to connect. */
export function Notifications() {
  const { notices, dismiss } = useDeviceStatus();
  if (notices.length === 0) return null;

  return (
    <div className="fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" role="status" aria-live="polite">
      {notices.map((n) => {
        const request = n.kind === "request";
        const Icon = request ? PlugZap : WifiOff;
        return (
          <div
            key={n.key}
            className={cn(
              "flex items-start gap-3 rounded-xl border bg-card p-3 text-sm shadow-lg shadow-black/40",
              request ? "border-primary/50" : "border-destructive/50",
            )}
          >
            <Icon className={cn("mt-0.5 size-4 shrink-0", request ? "text-primary" : "text-destructive")} />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{request ? "New connection request" : "Device offline"}</div>
              <Link
                to={request ? "/devices" : `/devices/${n.deviceId}`}
                className="block truncate text-muted-foreground underline-offset-4 hover:underline"
              >
                {request ? `${n.name}: review` : n.name}
              </Link>
            </div>
            <button
              aria-label="Dismiss"
              className="rounded-sm opacity-70 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
              onClick={() => dismiss(n.key)}
            >
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
