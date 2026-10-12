import { Badge } from "@/components/ui/badge";
import type { Device } from "@/lib/types";

export function ConnectionBadge({ status, online }: { status: Device["status"]; online: boolean }) {
  if (status === "revoked") return <Badge variant="destructive">Revoked</Badge>;
  if (status === "pending") return <Badge variant="muted">Pending</Badge>;
  return online ? (
    <Badge>
      <span className="size-1.5 rounded-full bg-primary" aria-hidden /> Online
    </Badge>
  ) : (
    <Badge variant="muted">
      <span className="size-1.5 rounded-full bg-muted-foreground" aria-hidden /> Offline
    </Badge>
  );
}
