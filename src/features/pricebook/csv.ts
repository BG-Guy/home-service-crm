// Price book CSV import/export (SPEC M21, M24). Pure and isomorphic: the browser
// parses the file (no upload of raw CSV), the server re-validates every row.
// Columns (header names, case-insensitive; order free):
//   sku, name*, kind*, category, description, unit_cost, unit_price, taxable,
//   special_order, vendor, warranty_days, mfr_warranty_months, active
// Money columns accept "$1,234.50" style values. Blank unit_price = use the markup matrix.
import { parseMoneyToCents } from "@/lib/money";

export const PRICEBOOK_KINDS = [
  "service",
  "labor",
  "part",
  "material",
  "fee",
] as const;
export type PricebookKind = (typeof PRICEBOOK_KINDS)[number];

export interface PricebookCsvRow {
  sku: string | null;
  name: string;
  kind: PricebookKind;
  category: string | null;
  description: string | null;
  unitCostCents: number | null;
  unitPriceCents: number | null;
  taxable: boolean;
  isSpecialOrder: boolean;
  vendor: string | null;
  warrantyDays: number | null;
  manufacturerWarrantyMonths: number | null;
  active: boolean;
}

export const CSV_COLUMNS = [
  "sku",
  "name",
  "kind",
  "category",
  "description",
  "unit_cost",
  "unit_price",
  "taxable",
  "special_order",
  "vendor",
  "warranty_days",
  "mfr_warranty_months",
  "active",
] as const;

/** RFC 4180 parser (quotes, escaped quotes, CRLF/LF, BOM). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i] as string;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

const esc = (v: string) =>
  /[",\r\n]/.test(v) || /^[=+\-@]/.test(v)
    ? `"${(/^[=+\-@]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`
    : v;

/** CSV text (with header) — formula-leading cells are neutralized for spreadsheets. */
export function toCsv(rows: readonly PricebookCsvRow[]): string {
  const money = (c: number | null) => (c == null ? "" : (c / 100).toFixed(2));
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of rows)
    lines.push(
      [
        r.sku ?? "",
        r.name,
        r.kind,
        r.category ?? "",
        r.description ?? "",
        money(r.unitCostCents),
        money(r.unitPriceCents),
        r.taxable ? "yes" : "no",
        r.isSpecialOrder ? "yes" : "no",
        r.vendor ?? "",
        r.warrantyDays == null ? "" : String(r.warrantyDays),
        r.manufacturerWarrantyMonths == null
          ? ""
          : String(r.manufacturerWarrantyMonths),
        r.active ? "yes" : "no",
      ]
        .map(esc)
        .join(","),
    );
  return `${lines.join("\r\n")}\r\n`;
}

const truthy = (v: string | undefined, dflt: boolean) => {
  const s = (v ?? "").trim().toLowerCase();
  if (!s) return dflt;
  return ["1", "y", "yes", "true", "t", "x"].includes(s);
};

const KIND_ALIASES: Record<string, PricebookKind> = {
  service: "service",
  services: "service",
  labor: "labor",
  labour: "labor",
  part: "part",
  parts: "part",
  material: "material",
  materials: "material",
  fee: "fee",
  fees: "fee",
};

export interface CsvImportResult {
  rows: PricebookCsvRow[];
  errors: { line: number; error: string }[];
}

/** Rows → typed price book rows with per-line errors (line numbers are 1-based, header = 1). */
export function rowsFromCsv(table: string[][]): CsvImportResult {
  const [header, ...body] = table;
  const out: CsvImportResult = { rows: [], errors: [] };
  if (!header) {
    out.errors.push({ line: 1, error: "The file is empty." });
    return out;
  }
  const idx = new Map(
    header.map((h, i) => [h.trim().toLowerCase().replace(/\s+/g, "_"), i]),
  );
  const col = (r: string[], ...names: string[]) => {
    for (const n of names) {
      const i = idx.get(n);
      if (i != null) return (r[i] ?? "").trim();
    }
    return "";
  };
  if (!idx.has("name")) {
    out.errors.push({ line: 1, error: 'Missing a "name" column.' });
    return out;
  }
  body.forEach((r, n) => {
    const line = n + 2;
    const name = col(r, "name");
    if (!name) {
      out.errors.push({ line, error: "Name is required." });
      return;
    }
    const kindRaw = col(r, "kind", "type").toLowerCase();
    const kind = KIND_ALIASES[kindRaw || "service"];
    if (!kind) {
      out.errors.push({ line, error: `Unknown kind "${kindRaw}".` });
      return;
    }
    const money = (v: string, label: string): number | null | "bad" => {
      if (!v) return null;
      const c = parseMoneyToCents(v);
      if (c == null || c < 0) {
        out.errors.push({ line, error: `${label} "${v}" isn't an amount.` });
        return "bad";
      }
      return c;
    };
    const cost = money(col(r, "unit_cost", "cost"), "Cost");
    const price = money(col(r, "unit_price", "price"), "Price");
    if (cost === "bad" || price === "bad") return;
    const int = (v: string) => {
      const x = Number.parseInt(v, 10);
      return Number.isFinite(x) && x >= 0 ? x : null;
    };
    out.rows.push({
      sku: col(r, "sku") || null,
      name: name.slice(0, 200),
      kind,
      category: col(r, "category") || null,
      description: col(r, "description") || null,
      unitCostCents: cost,
      unitPriceCents: price,
      taxable: truthy(
        col(r, "taxable"),
        kind === "part" || kind === "material",
      ),
      isSpecialOrder: truthy(col(r, "special_order"), false),
      vendor: col(r, "vendor") || null,
      warrantyDays: int(col(r, "warranty_days")),
      manufacturerWarrantyMonths: int(col(r, "mfr_warranty_months")),
      active: truthy(col(r, "active"), true),
    });
  });
  return out;
}
