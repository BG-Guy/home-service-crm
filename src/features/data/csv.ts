// RFC 4180 CSV read/write (isomorphic, dependency-free). Used by exports, the CSV
// import wizard and scripts/import-csv.ts.

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s: string;
  if (v instanceof Date) s = v.toISOString();
  else if (typeof v === "object") s = JSON.stringify(v);
  else s = String(v);
  // Spreadsheet formula injection guard (keeps phone numbers and negatives intact).
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?[\d\s().,-]+$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows (objects) → CSV text with a header row. Columns default to the union of keys. */
export function toCsv(
  rows: readonly Record<string, unknown>[],
  columns?: readonly string[],
): string {
  const cols = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const lines = [cols.map(cell).join(",")];
  for (const r of rows) lines.push(cols.map((c) => cell(r[c])).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

/** Parse CSV text into rows of cells. Handles quotes, escaped quotes, CRLF/LF and a BOM. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  let s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (!s.endsWith("\n")) s += "\n";
  const d = delimiter ?? sniffDelimiter(s);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === d) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || (row[0] ?? "") !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  return rows;
}

function sniffDelimiter(s: string): string {
  const first = s.slice(0, s.indexOf("\n"));
  const counts = [",", ";", "\t"].map(
    (d) => [d, first.split(d).length] as const,
  );
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]?.[1] && counts[0][1] > 1 ? counts[0][0] : ",";
}

/** Parse CSV with a header row into objects keyed by the (trimmed) header. */
export function parseCsvObjects(text: string): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const [head, ...body] = parseCsv(text);
  const headers = (head ?? []).map((h) => h.trim());
  return {
    headers,
    rows: body
      .filter((r) => r.some((c) => c.trim() !== ""))
      .map((r) =>
        Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])),
      ),
  };
}
