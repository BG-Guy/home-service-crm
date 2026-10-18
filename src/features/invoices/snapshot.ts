// Invoice snapshots and line diffs for revisions (SPEC M08: "Revise" stores a full
// JSON snapshot + sha256 + diff; the invoice number stays, the version increments).
// Pure and isomorphic. Hashing (canonical JSON → sha256) happens server-side with
// `sha256Json` from @/lib/hash, so the same content always yields the same hash.

export interface SnapshotLine {
  id: string;
  sort: number;
  type: string;
  name: string;
  description: string | null;
  qty: number;
  unitPriceCents: number;
  discountCents: number;
  totalCents: number;
  taxable: boolean;
  taxRateBps: number | null;
  partSource: string | null;
  warrantyDays: number | null;
  serial: string | null;
}

export interface InvoiceSnapshot {
  v: 1;
  invoiceId: string;
  number: string;
  version: number;
  jobId: string | null;
  customerId: string;
  issuedAt: string | null;
  dueAt: string | null;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  notes: string | null;
  terms: string | null;
  warrantyText: string | null;
  lines: SnapshotLine[];
}

type LineLike = {
  id: string;
  sort: number;
  type: string;
  name: string;
  description: string | null;
  qty: number | string;
  unitPriceCents: number;
  discountCents: number;
  totalCents: number;
  taxable: boolean;
  taxRateBps: number | null;
  partSource: string | null;
  warrantyDays: number | null;
  serial: string | null;
};

const iso = (d: Date | string | null | undefined) =>
  d == null ? null : new Date(d).toISOString();

/** Deterministic snapshot (lines sorted by sort, then id). */
export function buildInvoiceSnapshot(
  inv: {
    id: string;
    number: string;
    version: number;
    jobId: string | null;
    customerId: string;
    issuedAt: Date | string | null;
    dueAt: Date | string | null;
    subtotalCents: number;
    discountCents: number;
    taxCents: number;
    totalCents: number;
    notes: string | null;
    terms: string | null;
    warrantyText: string | null;
  },
  lines: readonly LineLike[],
): InvoiceSnapshot {
  const sorted = [...lines].sort(
    (a, b) => a.sort - b.sort || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return {
    v: 1,
    invoiceId: inv.id,
    number: inv.number,
    version: inv.version,
    jobId: inv.jobId,
    customerId: inv.customerId,
    issuedAt: iso(inv.issuedAt),
    dueAt: iso(inv.dueAt),
    subtotalCents: inv.subtotalCents,
    discountCents: inv.discountCents,
    taxCents: inv.taxCents,
    totalCents: inv.totalCents,
    notes: inv.notes,
    terms: inv.terms,
    warrantyText: inv.warrantyText,
    lines: sorted.map((l) => ({
      id: l.id,
      sort: l.sort,
      type: l.type,
      name: l.name,
      description: l.description,
      qty: Number(l.qty),
      unitPriceCents: l.unitPriceCents,
      discountCents: l.discountCents,
      totalCents: l.totalCents,
      taxable: l.taxable,
      taxRateBps: l.taxRateBps,
      partSource: l.partSource,
      warrantyDays: l.warrantyDays,
      serial: l.serial,
    })),
  };
}

export interface LineChange {
  id: string;
  name: string;
  fields: Record<string, { from: unknown; to: unknown }>;
}

export interface SnapshotDiff {
  added: { id: string; name: string; totalCents: number }[];
  removed: { id: string; name: string; totalCents: number }[];
  changed: LineChange[];
  totals: Record<string, { from: number; to: number }>;
  fields: Record<string, { from: unknown; to: unknown }>;
}

const LINE_FIELDS = [
  "type",
  "name",
  "description",
  "qty",
  "unitPriceCents",
  "discountCents",
  "totalCents",
  "taxable",
  "taxRateBps",
  "partSource",
  "warrantyDays",
  "serial",
] as const satisfies readonly (keyof SnapshotLine)[];

const TOTAL_FIELDS = [
  "subtotalCents",
  "discountCents",
  "taxCents",
  "totalCents",
] as const;

const DOC_FIELDS = ["notes", "terms", "warrantyText", "dueAt"] as const;

/** Line-level diff between two snapshots (matched by line id). */
export function diffSnapshots(
  before: InvoiceSnapshot,
  after: InvoiceSnapshot,
): SnapshotDiff {
  const prev = new Map(before.lines.map((l) => [l.id, l]));
  const next = new Map(after.lines.map((l) => [l.id, l]));
  const diff: SnapshotDiff = {
    added: [],
    removed: [],
    changed: [],
    totals: {},
    fields: {},
  };
  for (const l of after.lines) {
    const p = prev.get(l.id);
    if (!p) {
      diff.added.push({ id: l.id, name: l.name, totalCents: l.totalCents });
      continue;
    }
    const fields: LineChange["fields"] = {};
    for (const f of LINE_FIELDS)
      if (p[f] !== l[f]) fields[f] = { from: p[f], to: l[f] };
    if (Object.keys(fields).length)
      diff.changed.push({ id: l.id, name: l.name, fields });
  }
  for (const l of before.lines)
    if (!next.has(l.id))
      diff.removed.push({ id: l.id, name: l.name, totalCents: l.totalCents });
  for (const f of TOTAL_FIELDS)
    if (before[f] !== after[f])
      diff.totals[f] = { from: before[f], to: after[f] };
  for (const f of DOC_FIELDS)
    if (before[f] !== after[f])
      diff.fields[f] = { from: before[f], to: after[f] };
  return diff;
}

/** True when nothing changed (no revision needed). */
export function isEmptyDiff(d: SnapshotDiff): boolean {
  return (
    d.added.length === 0 &&
    d.removed.length === 0 &&
    d.changed.length === 0 &&
    Object.keys(d.totals).length === 0 &&
    Object.keys(d.fields).length === 0
  );
}

/** One-line human summary of a diff ("2 added, 1 removed · total $120.00 → $95.00"). */
export function summarizeDiff(
  d: SnapshotDiff,
  fmt: (cents: number) => string,
): string {
  const parts: string[] = [];
  if (d.added.length) parts.push(`${d.added.length} added`);
  if (d.removed.length) parts.push(`${d.removed.length} removed`);
  if (d.changed.length) parts.push(`${d.changed.length} changed`);
  const t = d.totals.totalCents;
  const head = parts.join(", ") || "No line changes";
  return t ? `${head} · total ${fmt(t.from)} → ${fmt(t.to)}` : head;
}
