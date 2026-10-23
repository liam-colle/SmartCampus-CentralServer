import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ErrorText, Field } from "@/components/Field";
import { Wordmark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("Passwords do not match");
    setBusy(true);
    setError(null);
    try {
      await api("/auth/reset-password", { body: { token, password } });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-4">
      <Wordmark className="[&_img]:size-9 [&>span:last-child]:text-xl" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">Choose a password</CardTitle>
          <CardDescription>At least 10 characters.</CardDescription>
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="flex flex-col gap-4">
              <p role="status" className="text-sm">Your password has been set.</p>
              <Button asChild>
                <Link to="/login">Sign in</Link>
              </Button>
            </div>
          ) : !token ? (
            <p className="text-sm text-destructive">This link is incomplete. Request a new one.</p>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <Field label="New password" htmlFor="password">
                <Input id="password" type="password" required minLength={10} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              <Field label="Confirm password" htmlFor="confirm">
                <Input id="confirm" type="password" required minLength={10} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </Field>
              <ErrorText>{error}</ErrorText>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Set password"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
