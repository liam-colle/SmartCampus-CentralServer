import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { Role } from "@/lib/types";
import { useAuth } from "./AuthContext";

/** Requires a signed-in user, and optionally one of `roles`. */
export function ProtectedRoute({ roles }: { roles?: Role[] }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Loading…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <Outlet />;
}
