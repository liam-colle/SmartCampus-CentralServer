import { LogOut } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function DashboardPage() {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <div className="backdrop-grid min-h-screen">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <span className="font-mono text-sm tracking-[0.35em] uppercase">SmartCampus</span>
        <Button variant="ghost" size="sm" onClick={() => void logout()}>
          <LogOut /> Sign out
        </Button>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="font-mono text-2xl">Welcome, {user.name}</h1>
        <p className="mt-1 text-muted-foreground">You are signed in. This is where the platform will grow.</p>

        <Card className="mt-8">
          <CardHeader>
            <CardTitle className="font-mono">Session</CardTitle>
            <CardDescription>Returned by GET /api/auth/me</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[6rem_1fr] gap-y-2 font-mono text-sm">
              <dt className="text-muted-foreground">email</dt>
              <dd>{user.email}</dd>
              <dt className="text-muted-foreground">role</dt>
              <dd>{user.role}</dd>
              <dt className="text-muted-foreground">id</dt>
              <dd className="break-all">{user.id}</dd>
            </dl>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
