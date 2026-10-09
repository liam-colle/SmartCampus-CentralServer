import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";

/** Shown during the last minute before the inactivity logout. */
export function IdleWarning() {
  const { idleWarning, keepAlive, logout } = useAuth();
  if (idleWarning === null) return null;

  return (
    <div role="alertdialog" aria-live="assertive" className="fixed inset-0 z-[60] grid place-items-center bg-black/70 px-4">
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-2xl">
        <h2 className="font-mono text-lg font-semibold">Still there?</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          You will be signed out in <span className="font-mono text-foreground">{idleWarning}s</span> because of inactivity.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => void logout()}>
            Sign out
          </Button>
          <Button onClick={keepAlive}>Stay signed in</Button>
        </div>
      </div>
    </div>
  );
}
