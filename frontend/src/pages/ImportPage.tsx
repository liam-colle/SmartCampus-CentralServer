import { Upload } from "lucide-react";
import { useState, type ChangeEvent } from "react";
import { ErrorText, Field } from "@/components/Field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";
import type { ImportResult } from "@/lib/types";

type Kind = "rooms" | "users";

const FORMATS: Record<Kind, { columns: string; example: string }> = {
  rooms: {
    columns: "building, code, floor, name, capacity, type",
    example: "building,code,floor,name,capacity,type\nA,A.101,1,Amphi Turing,120,lecture_hall",
  },
  users: {
    columns: "email, name, department, job title, phone, role",
    example: "email,name,department,job title,phone,role\nmarie.curie@campus.fr,Marie Curie,Physics,Professor,0102030405,staff",
  },
};

export function ImportPage() {
  const [kind, setKind] = useState<Kind>("rooms");
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [sendInvites, setSendInvites] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setCsv(null);
    setFileName("");
    setResult(null);
    setError(null);
  }

  async function submit(text: string, dryRun: boolean) {
    setBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ dryRun: String(dryRun), sendInvites: String(sendInvites) });
      setResult(await api<ImportResult>(`/import/${kind}?${qs}`, { csv: text }));
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsv(text);
    setFileName(file.name);
    await submit(text, true); // always preview first
  }

  const importable = result && result.dryRun && result.created + result.updated > 0;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-mono text-2xl">CSV import</h1>

      <Card>
        <CardHeader>
          <CardTitle className="font-mono">1. Choose a file</CardTitle>
          <CardDescription>
            Existing entries are updated, new ones created. Comma, semicolon or tab separated. Nothing is saved until you confirm.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field label="What are you importing?" htmlFor="kind">
            <Select
              id="kind"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as Kind);
                reset();
              }}
            >
              <option value="rooms">Rooms</option>
              <option value="users">Staff</option>
            </Select>
          </Field>
          <div className="rounded-md border bg-background p-3 font-mono text-xs">
            <div className="text-muted-foreground">Columns: {FORMATS[kind].columns}</div>
            <pre className="mt-2 overflow-x-auto">{FORMATS[kind].example}</pre>
          </div>
          {kind === "rooms" && (
            <p className="text-xs text-muted-foreground">
              <code>building</code> is the building code (it must already exist). <code>type</code> is one of classroom, lecture_hall, lab, office, meeting, other.
            </p>
          )}
          {kind === "users" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-primary" checked={sendInvites} onChange={(e) => setSendInvites(e.target.checked)} />
              Email an invitation to newly created accounts
            </label>
          )}
          <div>
            <Button asChild variant="outline" className="cursor-pointer">
              <label>
                <Upload /> {fileName || "Select CSV file"}
                <input key={kind + fileName} type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={onFile} />
              </label>
            </Button>
          </div>
        </CardContent>
      </Card>

      <ErrorText>{error}</ErrorText>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="font-mono">{result.dryRun ? "2. Preview" : "Done"}</CardTitle>
            <CardDescription>
              {result.total} row{result.total === 1 ? "" : "s"} read: {result.created} to create, {result.updated} to update, {result.errors.length} with errors
              {result.dryRun ? "." : " (created / updated shown are what was written)."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {result.errors.length > 0 && (
              <ul className="max-h-64 overflow-y-auto rounded-md border bg-background p-3 text-sm">
                {result.errors.map((er, i) => (
                  <li key={i} className="py-0.5">
                    <span className="font-mono text-muted-foreground">line {er.line}</span> – <span className="text-destructive">{er.message}</span>
                  </li>
                ))}
              </ul>
            )}
            {importable && csv && (
              <div className="flex items-center gap-3">
                <Button disabled={busy} onClick={() => void submit(csv, false)}>
                  {busy ? "Importing…" : `Import ${result.created + result.updated} row${result.created + result.updated === 1 ? "" : "s"}`}
                </Button>
                {result.errors.length > 0 && <span className="text-xs text-muted-foreground">Rows with errors are skipped.</span>}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
