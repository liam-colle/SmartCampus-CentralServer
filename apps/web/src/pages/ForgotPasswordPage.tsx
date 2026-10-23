import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ErrorText, Field } from "@/components/Field";
import { Wordmark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/forgot-password", { body: { email } });
      setSent(true);
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
          <CardTitle className="text-lg">Reset password</CardTitle>
          <CardDescription>We will email you a link to choose a new password.</CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <p role="status" className="text-sm">
              If an account exists for <span className="font-mono">{email}</span>, a reset link is on its way.
            </p>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <Field label="Email" htmlFor="email">
                <Input id="email" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <ErrorText>{error}</ErrorText>
              <Button type="submit" disabled={busy}>
                {busy ? "Sending…" : "Send reset link"}
              </Button>
            </form>
          )}
          <Link to="/login" className="mt-5 inline-block text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
