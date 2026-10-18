// Pure estimate rules (SPEC M07). Isomorphic: the builder, the public /e/ page and
// the server use the same code. Golden-tested in tests/golden/estimates.test.ts.
import {
  computeTotals,
  type DocTotals,
  type MathLine,
} from "@/features/invoices/math";

export type EstimateStatusValue =
  | "draft"
  | "sent"
  | "viewed"
  | "approved"
  | "declined"
  | "expired";

/** Lines can change, options can be added and the customer can still sign. */
export const OPEN_ESTIMATE_STATUSES: readonly EstimateStatusValue[] = [
  "draft",
  "sent",
  "viewed",
];

export function isEstimateOpen(status: string): boolean {
  return (OPEN_ESTIMATE_STATUSES as readonly string[]).includes(status);
}

/** Open AND not past its expiry (the cron flips status hourly; this is exact). */
export function canApproveEstimate(
  e: { status: string; expiresAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (!isEstimateOpen(e.status)) return false;
  return !e.expiresAt || e.expiresAt.getTime() > now.getTime();
}

/** An estimate holds 1, 2 or 3 options; one of them can be Recommended. */
export const MAX_ESTIMATE_OPTIONS = 3;

/**
 * Label for a new option: the configured label for its position (`option_labels`,
 * default Option 1 / 2 / 3), else the first configured label not in use, else
 * "Option N" (N = its position, skipping numbers already used).
 */
export function nextOptionLabel(
  labels: readonly string[],
  used: readonly string[],
): string {
  const taken = new Set(used);
  const free = (l: string | undefined): l is string => !!l && !taken.has(l);
  const atPosition = labels[used.length];
  if (free(atPosition)) return atPosition;
  const unused = labels.find(free);
  if (unused) return unused;
  let n = used.length + 1;
  while (taken.has(`Option ${n}`)) n++;
  return `Option ${n}`;
}

export interface OptionLineLike extends MathLine {
  id: string;
  isServiceFee?: boolean;
  isUpsell?: boolean;
}

/**
 * Option totals for a given add-on selection. Required lines always count; an
 * optional line counts when its id is in `selectedAddonIds` (or, without a
 * selection, when it is pre-selected).
 */
export function optionTotals(
  lines: readonly OptionLineLike[],
  taxBps: number,
  opts: { taxExempt?: boolean; selectedAddonIds?: readonly string[] } = {},
): DocTotals {
  const sel = opts.selectedAddonIds ? new Set(opts.selectedAddonIds) : null;
  return computeTotals(
    lines.map((l) => ({
      ...l,
      isSelected: l.isOptional
        ? sel
          ? sel.has(l.id)
          : l.isSelected !== false
        : true,
    })),
    taxBps,
    { taxExempt: opts.taxExempt },
  );
}

/**
 * The headline total: the approved option once the customer chose one (QA T2-06),
 * else the recommended option, else the highest option.
 */
export function headlineTotal(
  options: readonly {
    recommended: boolean;
    totalCents: number;
    approved?: boolean;
  }[],
): number {
  const approved = options.find((o) => o.approved);
  if (approved) return approved.totalCents;
  const rec = options.find((o) => o.recommended);
  if (rec) return rec.totalCents;
  return options.reduce((m, o) => Math.max(m, o.totalCents), 0);
}

/**
 * FTC Cooling-Off Rule (16 CFR 429) ⚖️: a sale at the customer's home of $25 or
 * more that goes beyond the requested repair (service type flagged
 * `upsell_covered`, or lines marked "Beyond the requested repair", `is_upsell`)
 * needs the 3-business-day notice.
 */
export function coolingOffApplies(a: {
  totalCents: number;
  atHome: boolean;
  serviceTypeUpsellCovered: boolean;
  hasUpsellLines: boolean;
}): boolean {
  if (!a.atHome) return false;
  if (a.totalCents < 2500) return false;
  return a.serviceTypeUpsellCovered || a.hasUpsellLines;
}

/** Third business day after `from` (Mon–Sat count; Sundays skipped), end of day. */
export function coolingOffDeadline(from: Date): Date {
  const d = new Date(from.getTime());
  let added = 0;
  while (added < 3) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0) added++;
  }
  return d;
}

export interface EstimateSnapshotInput {
  estimate: {
    id: string;
    number: string;
    title: string | null;
    customerId: string;
    jobId: string | null;
    expiresAt: Date | string | null;
    notes: string | null;
    warrantyText: string | null;
  };
  option: { id: string; label: string };
  lines: readonly {
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
    isOptional: boolean;
  }[];
  selectedAddonIds: readonly string[];
  totals: DocTotals;
  policies: readonly {
    id: string;
    kind: string;
    version: number;
    sha256: string;
  }[];
  depositCents: number | null;
}

/**
 * The exact document the customer agrees to, as stored in signatures.doc_snapshot
 * (its canonical-JSON sha256 is the signature's doc_sha256). Deterministic: lines
 * sorted by sort then id; only required lines + the chosen add-ons; policy versions
 * by id + hash so the terms in force can be proven later.
 */
export function buildEstimateSnapshot(i: EstimateSnapshotInput) {
  const chosen = new Set(i.selectedAddonIds);
  const lines = [...i.lines]
    .filter((l) => !l.isOptional || chosen.has(l.id))
    .sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((l) => ({
      id: l.id,
      type: l.type,
      name: l.name,
      description: l.description,
      qty: Number(l.qty),
      unitPriceCents: l.unitPriceCents,
      discountCents: l.discountCents,
      totalCents: l.totalCents,
      taxable: l.taxable,
      addOn: l.isOptional,
    }));
  return {
    v: 1 as const,
    kind: "estimate" as const,
    estimateId: i.estimate.id,
    number: i.estimate.number,
    title: i.estimate.title,
    customerId: i.estimate.customerId,
    jobId: i.estimate.jobId,
    expiresAt:
      i.estimate.expiresAt == null
        ? null
        : new Date(i.estimate.expiresAt).toISOString(),
    notes: i.estimate.notes,
    warrantyText: i.estimate.warrantyText,
    option: { id: i.option.id, label: i.option.label },
    lines,
    totals: i.totals,
    depositCents: i.depositCents,
    policies: [...i.policies]
      .sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0))
      .map((p) => ({
        id: p.id,
        kind: p.kind,
        version: p.version,
        sha256: p.sha256,
      })),
  };
}

export type EstimateSnapshot = ReturnType<typeof buildEstimateSnapshot>;

/** Change-order snapshot (same idea, one document, no options). */
export function buildChangeOrderSnapshot(i: {
  changeOrder: { id: string; number: string; jobId: string; reason: string };
  lines: EstimateSnapshotInput["lines"];
  totals: DocTotals;
  signedTotalCents: number | null;
  policies: EstimateSnapshotInput["policies"];
}) {
  return {
    v: 1 as const,
    kind: "change_order" as const,
    changeOrderId: i.changeOrder.id,
    number: i.changeOrder.number,
    jobId: i.changeOrder.jobId,
    reason: i.changeOrder.reason,
    previouslyApprovedCents: i.signedTotalCents,
    lines: [...i.lines]
      .sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1))
      .map((l) => ({
        id: l.id,
        type: l.type,
        name: l.name,
        qty: Number(l.qty),
        unitPriceCents: l.unitPriceCents,
        totalCents: l.totalCents,
        taxable: l.taxable,
      })),
    totals: i.totals,
    policies: [...i.policies]
      .sort((a, b) => (a.kind < b.kind ? -1 : 1))
      .map((p) => ({
        id: p.id,
        kind: p.kind,
        version: p.version,
        sha256: p.sha256,
      })),
  };
}

/**
 * Close rate per tech (unsold board): approved ÷ decided (approved + declined +
 * expired). Undecided estimates don't count either way.
 */
export function closeRate(c: {
  approved: number;
  declined: number;
  expired: number;
}): number | null {
  const decided = c.approved + c.declined + c.expired;
  return decided === 0 ? null : Math.round((c.approved / decided) * 1000) / 10;
}
