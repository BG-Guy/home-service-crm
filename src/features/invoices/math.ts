// Document math for estimates, change orders and invoices (SPEC §6.1, M07, M08).
// Pure and isomorphic: the server stores what these return and the builders preview
// with the same code, so screen and paper never disagree. Golden-tested in
// tests/golden/invoice-math.test.ts.
//
// Rules
//  - Money is integer cents; quantities have up to 3 decimals; rounding is half away
//    from zero (`lineTotalCents`).
//  - Line total = round(qty × unit price) − line discount. A `discount` line is a
//    document-level reduction and is stored negative.
//  - Tax is computed PER LINE on taxable, non-discount lines (rate = the line's own
//    rate, else the document default), then summed. Document discounts don't reduce
//    the taxable base (matches the demo plan and the seeded totals).
//  - Optional add-on lines count only when selected.
import { lineTotalCents, taxCents } from "@/lib/money";
import { dateKey, parseDateKey, startOfDayInTz } from "@/lib/time";

export type DocLineType =
  | "service"
  | "labor"
  | "part"
  | "material"
  | "fee"
  | "discount";

export interface MathLineInput {
  type: DocLineType;
  qty: number;
  unitPriceCents: number;
  discountCents?: number | null;
}

export interface MathLine {
  type: DocLineType;
  totalCents: number;
  taxable: boolean;
  taxRateBps?: number | null;
  isOptional?: boolean;
  isSelected?: boolean;
}

export interface DocTotals {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}

export const ZERO_TOTALS: DocTotals = Object.freeze({
  subtotalCents: 0,
  discountCents: 0,
  taxCents: 0,
  totalCents: 0,
});

/** Stored `total_cents` of one line (discount lines are negative). */
export function computeLineTotal(l: MathLineInput): number {
  if (l.type === "discount")
    return -Math.abs(lineTotalCents(l.qty, l.unitPriceCents));
  return lineTotalCents(
    l.qty,
    l.unitPriceCents,
    Math.abs(l.discountCents ?? 0),
  );
}

/** DB/line-like rows → math lines (type narrowed). */
export function mathLines(
  rows: readonly {
    type: string;
    totalCents: number;
    taxable: boolean;
    discountCents?: number | null;
    isOptional?: boolean;
    isSelected?: boolean;
    taxRateBps?: number | null;
  }[],
): (MathLine & { discountCents?: number | null })[] {
  return rows.map((r) => ({
    type: r.type as DocLineType,
    totalCents: r.totalCents,
    taxable: r.taxable,
    discountCents: r.discountCents ?? 0,
    isOptional: r.isOptional ?? false,
    isSelected: r.isSelected ?? true,
    taxRateBps: r.taxRateBps ?? null,
  }));
}

/** True when the line counts toward totals (required lines, or selected add-ons). */
export function lineCounts(l: Pick<MathLine, "isOptional" | "isSelected">) {
  return !l.isOptional || l.isSelected !== false;
}

/**
 * Document totals. `taxExempt` zeroes tax (tax-exempt customers, M03 flag).
 * `defaultTaxBps` applies to taxable lines without their own `taxRateBps`.
 */
export function computeTotals(
  lines: readonly MathLine[],
  defaultTaxBps: number,
  opts: { taxExempt?: boolean } = {},
): DocTotals {
  let subtotal = 0;
  let discount = 0;
  let tax = 0;
  for (const l of lines) {
    if (!lineCounts(l)) continue;
    if (l.type === "discount") {
      discount += Math.abs(l.totalCents);
      continue;
    }
    subtotal += l.totalCents;
    if (l.taxable && !opts.taxExempt)
      tax += taxCents(l.totalCents, l.taxRateBps ?? defaultTaxBps);
  }
  return {
    subtotalCents: subtotal,
    discountCents: discount,
    taxCents: tax,
    totalCents: subtotal - discount + tax,
  };
}

/**
 * Total discount (line discounts + discount lines) as a share of the gross
 * pre-discount amount, in percent (2 decimals). Used for the role limit (M07).
 */
export function discountPercent(
  lines: readonly (MathLine & { discountCents?: number | null })[],
): number {
  let gross = 0;
  let disc = 0;
  for (const l of lines) {
    if (!lineCounts(l)) continue;
    if (l.type === "discount") disc += Math.abs(l.totalCents);
    else {
      const lineDisc = Math.abs(l.discountCents ?? 0);
      gross += l.totalCents + lineDisc;
      disc += lineDisc;
    }
  }
  if (gross <= 0) return disc > 0 ? 100 : 0;
  return Math.round((disc / gross) * 10_000) / 100;
}

/** Whether a discount share is within the role's `max_discount_pct`. */
export function discountWithinLimit(pct: number, maxPct: number): boolean {
  return pct <= maxPct + 1e-9;
}

// ------------------------------------------------------------------ invoices

export type InvoiceStatusValue =
  | "draft"
  | "issued"
  | "partially_paid"
  | "paid"
  | "void"
  | "uncollectible";

/**
 * Status cache after a money movement (syncInvoicePaymentState). Draft, void and
 * uncollectible are sticky; otherwise: balance ≤ 0 → paid, some net payment →
 * partially_paid, else issued.
 */
export function nextInvoiceStatus(
  current: InvoiceStatusValue,
  balanceCents: number,
  netPaidCents: number,
): InvoiceStatusValue {
  if (current === "draft" || current === "void" || current === "uncollectible")
    return current;
  if (balanceCents <= 0) return "paid";
  if (netPaidCents > 0) return "partially_paid";
  return "issued";
}

/** balance = total − paid + refunded − credited (SPEC §6.5 view). */
export function balanceOf(b: {
  totalCents: number;
  paidCents: number;
  refundedCents: number;
  creditedCents: number;
}): number {
  return b.totalCents - b.paidCents + b.refundedCents - b.creditedCents;
}

export type DueTerms = "due_on_receipt" | "net_15" | "net_30";

/** Due date for the customer's terms (residential due on receipt; net 15/30). */
export function dueDateFor(terms: DueTerms, issuedAt: Date): Date {
  const days = terms === "net_30" ? 30 : terms === "net_15" ? 15 : 0;
  return new Date(issuedAt.getTime() + days * 86_400_000);
}

export const TERMS_LABEL: Record<DueTerms, string> = {
  due_on_receipt: "Due on receipt",
  net_15: "Net 15",
  net_30: "Net 30",
};

// ------------------------------------------------------------------ overdue (QA2)
// One rule everywhere (invoice detail, portal, list, badge, statement, insights,
// dunning): an invoice is DUE on its due date's calendar day in the company time zone
// ("Due today") and OVERDUE only from the next local day. A due-on-receipt invoice
// (due = issue time) is never "past due" the moment it's issued.

/** Whole calendar days between two instants' company-TZ dates (b − a). */
export function calendarDaysBetween(a: Date, b: Date, tz: string): number {
  const ka = parseDateKey(dateKey(a, tz));
  const kb = parseDateKey(dateKey(b, tz));
  return Math.round(
    (Date.UTC(kb.year, kb.month - 1, kb.day) -
      Date.UTC(ka.year, ka.month - 1, ka.day)) /
      86_400_000,
  );
}

/**
 * The instant an invoice due before it is overdue: local midnight starting today.
 * SQL callers filter `due_at < ${overdueCutoff(now, tz)}`.
 */
export function overdueCutoff(now: Date, tz: string): Date {
  return startOfDayInTz(now, tz);
}

/** Past due: the due date's local day is before today (company time zone). */
export function isOverdue(
  dueAt: Date | null | undefined,
  now: Date,
  tz: string,
): boolean {
  return !!dueAt && dueAt.getTime() < overdueCutoff(now, tz).getTime();
}

/** Local calendar days past the due date (0 on the due date and before it). */
export function daysPastDue(
  dueAt: Date | null | undefined,
  now: Date,
  tz: string,
): number {
  return dueAt ? Math.max(0, calendarDaysBetween(dueAt, now, tz)) : 0;
}

/** Due today (company time zone). */
export function isDueToday(
  dueAt: Date | null | undefined,
  now: Date,
  tz: string,
): boolean {
  return !!dueAt && dateKey(dueAt, tz) === dateKey(now, tz);
}

export type AgingBucket = "0-30" | "31-60" | "61-90" | "90+";

/**
 * Aging bucket by days past the due date (not yet due counts as 0–30). With `tz`,
 * days are company-TZ calendar days (daysPastDue); without it, whole 24 h days.
 */
export function agingBucket(
  dueAt: Date | null,
  now: Date,
  tz?: string,
): AgingBucket {
  const days = !dueAt
    ? 0
    : tz
      ? daysPastDue(dueAt, now, tz)
      : Math.max(0, Math.floor((now.getTime() - dueAt.getTime()) / 86_400_000));
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

/** Day thresholds that emit invoice.overdue (days 1, 3, 7, 14, 30, then every 30). */
export function isOverdueMilestone(daysOverdue: number): boolean {
  if (daysOverdue <= 0) return false;
  if ([1, 3, 7, 14, 30].includes(daysOverdue)) return true;
  return daysOverdue > 30 && daysOverdue % 30 === 0;
}

// ------------------------------------------------------------------ change orders

/**
 * Change-order requirement (M07 / BUILD_PLAN §6.3). The signed total is the approved
 * estimate option plus approved+signed change orders. Exceeded when the current job
 * total is above it by more than `pct` percent of the signed total, or by more than
 * `cents` when that absolute threshold is set (> 0).
 */
export function changeOrderThresholdExceeded(
  signedTotalCents: number | null,
  currentTotalCents: number,
  pct: number,
  cents: number,
): boolean {
  if (signedTotalCents == null) return false;
  const delta = currentTotalCents - signedTotalCents;
  if (delta <= 0) return false;
  const pctExceeded = delta * 100 > signedTotalCents * pct;
  const centsExceeded = cents > 0 && delta > cents;
  return pctExceeded || centsExceeded;
}
