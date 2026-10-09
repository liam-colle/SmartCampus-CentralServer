import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";

export interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
}

export interface Providers {
  local: boolean;
  azure: boolean;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  providers: Providers;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState<Providers>({ local: true, azure: false });

  useEffect(() => {
    api<Providers>("/auth/providers").then(setProviders).catch(() => {});
    api<{ user: User }>("/auth/me")
      .then((r) => setUser(r.user))
      .catch((e) => {
        if (!(e instanceof ApiError && e.status === 401)) console.error(e);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ user: User }>("/auth/login", { body: { email, password } });
    setUser(r.user);
  }, []);

  const logout = useCallback(async () => {
    await api("/auth/logout", { method: "POST" });
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, providers, login, logout }),
    [user, loading, providers, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
