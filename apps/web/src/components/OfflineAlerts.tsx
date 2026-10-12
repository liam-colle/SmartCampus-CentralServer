import { Link } from "react-router-dom";
import { WifiOff, X } from "lucide-react";
import { useDeviceStatus } from "@/lib/DeviceStatus";

/** Console alert when a device drops off the network. */
export function OfflineAlerts() {
  const { alerts, dismiss } = useDeviceStatus();
  if (alerts.length === 0) return null;

  return (
    <div className="fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" role="status" aria-live="polite">
      {alerts.map((a) => (
        <div key={a.key} className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-card p-3 text-sm shadow-xl shadow-black/50">
          <WifiOff className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">Device offline</div>
            <Link to={`/devices/${a.deviceId}`} className="block truncate text-muted-foreground underline-offset-4 hover:underline">
              {a.name}
            </Link>
          </div>
          <button
            aria-label="Dismiss"
            className="rounded-sm opacity-70 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
            onClick={() => dismiss(a.key)}
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
