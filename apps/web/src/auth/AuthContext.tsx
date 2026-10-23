import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, setUnauthorizedHandler } from "@/lib/api";
import type { Group, Role } from "@/lib/types";

export interface User {
  id: string;
  email: string | null;
  name: string;
  role: Role;
  groups: Group[];
}

export interface Providers {
  local: boolean;
  azure: boolean;
}

interface Session {
  idleTimeoutSeconds: number;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  providers: Providers;
  /** True after the session ended on its own (inactivity or server-side expiry). */
  sessionExpired: boolean;
  /** Seconds before the inactivity logout, only set during the final warning window. */
  idleWarning: number | null;
  /** Counts as activity right now (used by the "stay signed in" button). */
  keepAlive: () => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const WARNING_SECONDS = 60;
const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "scroll", "touchstart"] as const;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState<Providers>({ local: true, azure: false });
  const [sessionExpired, setSessionExpired] = useState(false);
  const [idleWarning, setIdleWarning] = useState<number | null>(null);

  const lastActivity = useRef(Date.now());
  const lastPing = useRef(Date.now());

  const expire = useCallback(() => {
    setUser(null);
    setIdleWarning(null);
    setSessionExpired(true);
  }, []);

  useEffect(() => {
    api<Providers>("/auth/providers").then(setProviders).catch(() => {});
    api<{ user: User; session: Session }>("/auth/me")
      .then((r) => {
        setUser(r.user);
        setSession(r.session);
      })
      .catch((e) => {
        if (!(e instanceof ApiError && e.status === 401)) console.error(e);
      })
      .finally(() => setLoading(false));
  }, []);

  // Any API call answered with 401 while signed in means the session is gone.
  useEffect(() => {
    setUnauthorizedHandler(expire);
    return () => setUnauthorizedHandler(null);
  }, [expire]);

  // Inactivity logout. The server enforces the same limit; this just makes the UI follow it
  // (and keeps the server session alive while the user is working without calling the API).
  useEffect(() => {
    if (!user || !session) return;
    const idleMs = session.idleTimeoutSeconds * 1000;
    lastActivity.current = lastPing.current = Date.now();

    const onActivity = () => {
      lastActivity.current = Date.now();
    };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));

    const tick = setInterval(() => {
      const now = Date.now();
      const idleFor = now - lastActivity.current;

      if (idleFor >= idleMs) {
        void api("/auth/logout", { method: "POST" }).catch(() => {});
        expire();
        return;
      }
      const left = Math.ceil((idleMs - idleFor) / 1000);
      setIdleWarning(left <= WARNING_SECONDS ? left : null);

      // Active since the last ping and it has been a while: slide the server-side expiry.
      if (lastActivity.current > lastPing.current && now - lastPing.current > idleMs / 3) {
        lastPing.current = now;
        api("/auth/me").catch((e) => {
          if (e instanceof ApiError && e.status === 401) expire();
        });
      }
    }, 1000);

    return () => {
      clearInterval(tick);
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
    };
  }, [user, session, expire]);

  const keepAlive = useCallback(() => {
    lastActivity.current = Date.now();
    setIdleWarning(null);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ user: User; session: Session }>("/auth/login", { body: { email, password } });
    setSessionExpired(false);
    setSession(r.session);
    setUser(r.user);
  }, []);

  const logout = useCallback(async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
    setSessionExpired(false);
  }, []);

  const value = useMemo(
    () => ({ user, loading, providers, sessionExpired, idleWarning, keepAlive, login, logout }),
    [user, loading, providers, sessionExpired, idleWarning, keepAlive, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export const canEditCampus = (user: User | null) => user?.role === "admin" || user?.role === "operator";
