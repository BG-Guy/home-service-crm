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
  | "expired"
  /** "Replaced": another estimate on the same job was approved first. */
  | "superseded";

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
 * `upsell_covered`, or lines tagged upsell) needs the 3-business-day notice.
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

// ------------------------------------------------------------------ never bill twice

/** A line on the job's DRAFT invoice, as the replace rule sees it. */
export interface DraftLineLike {
  id: string;
  type: string;
  name: string;
  pricebookItemId: string | null;
  isServiceFee: boolean;
  /** line_items.source_type (null on older rows). */
  sourceType: string | null;
  /** `part_purchase_id` is set or a `stock_moves` row points at the line. */
  partTied: boolean;
}

/** A line the approval would copy onto the invoice. */
export interface ApprovedLineLike {
  type: string;
  name: string;
  pricebookItemId: string | null;
}

/** A part the job really used: bought for it, taken from stock, or added as a part. */
const usedPart = (l: DraftLineLike) => l.partTied || l.sourceType === "part";

const sameName = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Never bill the same work twice (Quote to Paid E1). Approving an estimate onto the
 * job's DRAFT invoice replaces what the estimate supersedes (the lead's quoted
 * price, earlier estimates and change orders, manual and older lines) and keeps
 * what can't be taken back: parts used on the job (a purchase, a stock move, or a
 * line from the parts flow) and service-call fees (credited by their own rule). An
 * approved line that matches a kept part (same price-book item, else the same name
 * and type) is not added again: each kept part covers one approved line. A new
 * estimate on such a job starts from the invoice's lines, so nothing is lost.
 */
export function planInvoiceReplace<
  D extends DraftLineLike,
  A extends ApprovedLineLike,
>(
  draft: readonly D[],
  approved: readonly A[],
): { keep: D[]; remove: D[]; add: A[]; covered: A[] } {
  const keep = draft.filter((l) => usedPart(l) || l.isServiceFee);
  const remove = draft.filter((l) => !(usedPart(l) || l.isServiceFee));
  const parts = keep.filter(usedPart);
  const add: A[] = [];
  const covered: A[] = [];
  for (const a of approved) {
    const i = parts.findIndex((k) =>
      a.pricebookItemId && k.pricebookItemId
        ? a.pricebookItemId === k.pricebookItemId
        : a.type === k.type && sameName(a.name, k.name),
    );
    if (i >= 0) {
      parts.splice(i, 1);
      covered.push(a);
    } else add.push(a);
  }
  return { keep, remove, add, covered };
}

/**
 * What the customer has signed for on a job: the newest approved estimate (as
 * signed; it replaced the earlier ones on the invoice) plus the signed change orders
 * approved after it (earlier ones were folded into that estimate). Null without an
 * approved estimate. Superseded estimates are never approved, so they never count.
 */
export function signedJobTotal(
  estimates: readonly { approvedAt: Date | null; totalCents: number | null }[],
  changeOrders: readonly { signedAt: Date | null; deltaCents: number }[],
): number | null {
  let newest: { at: number; total: number } | null = null;
  for (const e of estimates) {
    if (e.totalCents == null) continue;
    const at = e.approvedAt?.getTime() ?? 0;
    if (!newest || at > newest.at) newest = { at, total: e.totalCents };
  }
  if (!newest) return null;
  const from = newest.at;
  return changeOrders.reduce(
    (sum, c) =>
      !c.signedAt || c.signedAt.getTime() >= from ? sum + c.deltaCents : sum,
    newest.total,
  );
}

/**
 * Close rate per tech (unsold board): approved ÷ decided (approved + declined +
 * expired). Undecided and replaced (superseded) estimates don't count either way.
 */
export function closeRate(c: {
  approved: number;
  declined: number;
  expired: number;
}): number | null {
  const decided = c.approved + c.declined + c.expired;
  return decided === 0 ? null : Math.round((c.approved / decided) * 1000) / 10;
}
