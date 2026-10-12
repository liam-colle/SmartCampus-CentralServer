export interface CsvRow {
  /** 1-based line number in the file where the row starts (header is line 1). */
  line: number;
  data: Record<string, string>;
}

const normalizeHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Excel in French locales exports with `;`, so the delimiter is detected from the header. */
function detectDelimiter(text: string): string {
  const header = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((d) => [d, header.split(d).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0]![0];
}

/** Minimal RFC 4180 parser (quoted fields, escaped quotes, newlines inside quotes). */
function parseCells(text: string, delimiter: string): { line: number; cells: string[] }[] {
  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;

  const endRow = () => {
    cells.push(field);
    field = "";
    if (cells.some((c) => c.trim() !== "")) rows.push({ line: rowLine, cells });
    cells = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === delimiter) {
      cells.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
      line++;
      rowLine = line;
    } else {
      field += ch;
    }
  }
  if (field !== "" || cells.length > 0) endRow();
  return rows;
}

/**
 * Parses a CSV into objects keyed by normalised header (lowercase, letters and digits only:
 * "Job title" and "job_title" both become "jobtitle").
 */
export function parseTable(input: string): { headers: string[]; rows: CsvRow[] } {
  const text = input.replace(/^﻿/, "");
  const [head, ...body] = parseCells(text, detectDelimiter(text));
  if (!head) return { headers: [], rows: [] };

  const headers = head.cells.map(normalizeHeader);
  const rows = body.map(({ line, cells }) => ({
    line,
    data: Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? "").trim()])),
  }));
  return { headers, rows };
}
