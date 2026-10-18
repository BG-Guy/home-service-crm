import "server-only";
import type { Tx } from "@/db";
import {
  findCustomerMatch,
  findOrCreateCustomer,
} from "@/features/customers/api";
import { parseAddressLine, splitName } from "@/features/customers/normalize";
import { importHistoricalJobs } from "@/features/jobs/api";
import { recordConsent } from "@/features/messaging/api";
import { upsertPricebookItems } from "@/features/pricebook/api";
import { parseMoneyToCents } from "@/lib/money";
import { normalizePhone } from "@/lib/phone";
import type { Actor } from "@/lib/types";
import {
  guessMapping,
  IMPORT_FIELDS,
  type ImportKind,
  type ImportMapping,
} from "./import-fields";

// CSV import (SPEC M24): customers (+ properties), price book (→ B3), past jobs (→ B2).
// Dry run first: the same planner validates every row and reports dedupe matches.

export { guessMapping, IMPORT_FIELDS, type ImportKind, type ImportMapping };

export const MAX_IMPORT_ROWS = 10_000;

const truthy = (v: string | undefined) =>
  !!v && ["y", "yes", "true", "1", "x", "on"].includes(v.trim().toLowerCase());

function val(
  row: Record<string, string>,
  m: ImportMapping,
  key: string,
): string {
  const h = m[key];
  return h ? (row[h] ?? "").trim() : "";
}

function parseDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t);
  if (m) {
    const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${String(m[1]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
  }
  return null;
}

export interface CustomerImportRow {
  line: number;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  phone: string | null;
  email: string | null;
  type: "residential" | "commercial" | "property_manager" | "home_warranty";
  address: {
    street: string;
    unit: string | null;
    city: string;
    state: string;
    zip: string;
  } | null;
  notes: string | null;
  smsConsent: boolean;
}

export interface ImportPlan<R> {
  kind: ImportKind;
  total: number;
  valid: R[];
  errors: { row: number; error: string }[];
  /** Rows that match an existing customer (customers/jobs) or repeat in the file. */
  duplicates: number;
  sample: Record<string, string>[];
}

const TYPES = new Set([
  "residential",
  "commercial",
  "property_manager",
  "home_warranty",
]);

function customerRow(
  row: Record<string, string>,
  m: ImportMapping,
  line: number,
): CustomerImportRow | { error: string } {
  const first = val(row, m, "first_name") || null;
  const last = val(row, m, "last_name") || null;
  const company = val(row, m, "company") || null;
  let name = val(row, m, "name") || null;
  if (!name && (first || last)) name = [first, last].filter(Boolean).join(" ");
  if (!name && company) name = company;
  const phoneRaw = val(row, m, "phone");
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  const emailRaw = val(row, m, "email").toLowerCase();
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : null;
  if (!name && !phone && !email) return { error: "No name, phone or email" };
  if (phoneRaw && !phone && !email)
    return { error: `Invalid phone "${phoneRaw}" and no email` };
  let address: CustomerImportRow["address"] = null;
  const street = val(row, m, "street");
  const zip = val(row, m, "zip");
  if (street && zip) {
    address = {
      street,
      unit: val(row, m, "unit") || null,
      city: val(row, m, "city"),
      state: val(row, m, "state").toUpperCase().slice(0, 2),
      zip: /\d{5}/.exec(zip)?.[0] ?? zip,
    };
  } else if (val(row, m, "address")) {
    const p = parseAddressLine(val(row, m, "address"));
    if (p)
      address = {
        street: p.street,
        unit: p.unit ?? null,
        city: p.city,
        state: p.state,
        zip: p.zip,
      };
  }
  const typeRaw = val(row, m, "type")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const type = (
    TYPES.has(typeRaw)
      ? typeRaw
      : /business|commercial|company/.test(typeRaw)
        ? "commercial"
        : "residential"
  ) as CustomerImportRow["type"];
  const split = !first && !last && name && !company ? splitName(name) : null;
  return {
    line,
    name,
    firstName: first ?? split?.first ?? null,
    lastName: last ?? split?.last ?? null,
    companyName: company,
    phone,
    email,
    type,
    address,
    notes: val(row, m, "notes") || null,
    smsConsent: truthy(val(row, m, "sms_consent")),
  };
}

/** Validate + dedupe without writing. */
export async function planCustomerImport(
  rows: Record<string, string>[],
  m: ImportMapping,
): Promise<ImportPlan<CustomerImportRow>> {
  const valid: CustomerImportRow[] = [];
  const errors: { row: number; error: string }[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  for (let i = 0; i < Math.min(rows.length, MAX_IMPORT_ROWS); i++) {
    const r = customerRow(rows[i] as Record<string, string>, m, i + 2);
    if ("error" in r) {
      errors.push({ row: i + 2, error: r.error });
      continue;
    }
    const key = r.phone ?? r.email;
    if (key && seen.has(key)) duplicates++;
    else if (
      key &&
      (await findCustomerMatch({ phone: r.phone, email: r.email }))
    )
      duplicates++;
    if (key) seen.add(key);
    valid.push(r);
  }
  if (rows.length > MAX_IMPORT_ROWS)
    errors.push({
      row: MAX_IMPORT_ROWS + 2,
      error: `Only the first ${MAX_IMPORT_ROWS} rows are imported`,
    });
  return {
    kind: "customers",
    total: rows.length,
    valid,
    errors,
    duplicates,
    sample: rows.slice(0, 5),
  };
}

/** Import customers: matches by phone/email (fills blanks), adds properties, records consent. */
export async function importCustomers(
  tx: Tx,
  rows: CustomerImportRow[],
  actor: Actor,
  opts: { source?: string } = {},
): Promise<{ created: number; matched: number; properties: number }> {
  let created = 0;
  let matched = 0;
  let props = 0;
  for (const r of rows) {
    const res = await findOrCreateCustomer(
      tx,
      {
        displayName:
          r.companyName && r.type !== "residential" ? r.companyName : r.name,
        firstName: r.firstName,
        lastName: r.lastName,
        companyName: r.companyName,
        phone: r.phone,
        email: r.email,
        type: r.type,
        address: r.address,
        source: opts.source ?? "import",
      },
      actor,
    );
    if (res.created) created++;
    else matched++;
    if (res.propertyCreated) props++;
    if (r.smsConsent && r.phone)
      await recordConsent(
        tx,
        {
          customerId: res.customerId,
          address: r.phone,
          channel: "sms",
          purpose: "transactional",
          action: "grant",
          source: "import",
          textShown: "Imported from a CSV file (consent column).",
          actorUserId: actor.userId,
        },
        actor,
      );
  }
  return { created, matched, properties: props };
}

export interface PricebookImportRow {
  line: number;
  sku: string | null;
  name: string;
  kind: "service" | "labor" | "part" | "material" | "fee";
  category: string | null;
  unitPriceCents: number | null;
  unitCostCents: number | null;
  taxable: boolean | undefined;
  description: string | null;
}

const KINDS = new Set(["service", "labor", "part", "material", "fee"]);

export function planPricebookImport(
  rows: Record<string, string>[],
  m: ImportMapping,
): ImportPlan<PricebookImportRow> {
  const valid: PricebookImportRow[] = [];
  const errors: { row: number; error: string }[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  for (const [i, row] of rows.slice(0, MAX_IMPORT_ROWS).entries()) {
    const line = i + 2;
    const name = val(row, m, "name");
    if (!name) {
      errors.push({ row: line, error: "Missing name" });
      continue;
    }
    const priceRaw = val(row, m, "price");
    const costRaw = val(row, m, "cost");
    const price = priceRaw ? parseMoneyToCents(priceRaw) : null;
    const cost = costRaw ? parseMoneyToCents(costRaw) : null;
    if (priceRaw && price == null) {
      errors.push({
        row: line,
        error: `Price "${priceRaw}" isn't an amount`,
      });
      continue;
    }
    if (costRaw && cost == null) {
      errors.push({
        row: line,
        error: `Cost "${costRaw}" isn't an amount`,
      });
      continue;
    }
    const kindRaw = val(row, m, "kind").toLowerCase();
    const kind = (
      KINDS.has(kindRaw) ? kindRaw : cost != null ? "part" : "service"
    ) as PricebookImportRow["kind"];
    const sku = val(row, m, "sku") || null;
    const key = (sku ?? name).toLowerCase();
    if (seen.has(key)) duplicates++;
    seen.add(key);
    const tx = val(row, m, "taxable");
    valid.push({
      line,
      sku,
      name,
      kind,
      category: val(row, m, "category") || null,
      unitPriceCents: price,
      unitCostCents: cost,
      taxable: tx ? truthy(tx) : undefined,
      description: val(row, m, "description") || null,
    });
  }
  return {
    kind: "pricebook",
    total: rows.length,
    valid,
    errors,
    duplicates,
    sample: rows.slice(0, 5),
  };
}

export async function importPricebook(
  tx: Tx,
  rows: PricebookImportRow[],
  actor: Actor,
) {
  return upsertPricebookItems(
    tx,
    rows.map((r) => ({
      sku: r.sku,
      name: r.name,
      kind: r.kind,
      category: r.category,
      unitPriceCents: r.unitPriceCents,
      unitCostCents: r.unitCostCents,
      ...(r.taxable !== undefined ? { taxable: r.taxable } : {}),
      description: r.description,
    })),
    actor,
  );
}

export interface JobImportRow {
  line: number;
  customer: CustomerImportRow;
  serviceText: string;
  completedOn: string;
  totalCents: number;
  notes: string | null;
  externalRef: string | null;
}

export async function planJobImport(
  rows: Record<string, string>[],
  m: ImportMapping,
): Promise<ImportPlan<JobImportRow>> {
  const valid: JobImportRow[] = [];
  const errors: { row: number; error: string }[] = [];
  let duplicates = 0;
  for (let i = 0; i < Math.min(rows.length, MAX_IMPORT_ROWS); i++) {
    const row = rows[i] as Record<string, string>;
    const line = i + 2;
    const c = customerRow(row, m, line);
    if ("error" in c) {
      errors.push({ row: line, error: c.error });
      continue;
    }
    if (!c.address) {
      errors.push({
        row: line,
        error: "Missing service address (street + ZIP)",
      });
      continue;
    }
    const completedOn = parseDate(val(row, m, "completed_on"));
    if (!completedOn) {
      errors.push({ row: line, error: "Missing or unreadable date" });
      continue;
    }
    const totalRaw = val(row, m, "total");
    const total = totalRaw ? parseMoneyToCents(totalRaw) : 0;
    if (total == null) {
      errors.push({ row: line, error: `Total "${totalRaw}" isn't an amount` });
      continue;
    }
    if (await findCustomerMatch({ phone: c.phone, email: c.email }))
      duplicates++;
    valid.push({
      line,
      customer: c,
      serviceText: val(row, m, "service") || "Service",
      completedOn,
      totalCents: total,
      notes: val(row, m, "notes") || null,
      externalRef: val(row, m, "external_ref") || null,
    });
  }
  return {
    kind: "jobs",
    total: rows.length,
    valid,
    errors,
    duplicates,
    sample: rows.slice(0, 5),
  };
}

/** Past jobs for history/LTV: customer + property first, then B2's importHistoricalJobs. */
export async function importJobs(tx: Tx, rows: JobImportRow[], actor: Actor) {
  const hist = [];
  for (const r of rows) {
    const c = await findOrCreateCustomer(
      tx,
      {
        displayName: r.customer.name,
        firstName: r.customer.firstName,
        lastName: r.customer.lastName,
        companyName: r.customer.companyName,
        phone: r.customer.phone,
        email: r.customer.email,
        type: r.customer.type,
        address: r.customer.address,
        source: "import",
      },
      actor,
    );
    if (!c.propertyId) continue;
    hist.push({
      customerId: c.customerId,
      propertyId: c.propertyId,
      serviceText: r.serviceText,
      completedOn: r.completedOn,
      totalCents: r.totalCents,
      notes: r.notes,
      externalRef: r.externalRef,
    });
  }
  return importHistoricalJobs(tx, hist, actor);
}
