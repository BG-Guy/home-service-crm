// Tech-paid purchase auto-approve rules (SPEC M15). Pure; golden-tested in
// tests/parts/auto-approve.test.ts. Auto-approve when ALL hold:
//   under limits.auto_approve_under_cents, receipt present, AI total matches the typed
//   total within the tolerance (or no AI configured and under the limit), and the
//   purchase date is within receipt_max_age_days of the job, and no other live claim
//   carries the same receipt file (QA2 NEW-4).
import { parseDateKey } from "@/lib/time";

export type AiState = "queued" | "done" | "failed" | "skipped" | null;

export type PurchaseFlag =
  | "no_receipt"
  | "over_limit"
  | "ai_mismatch"
  | "ai_unreadable"
  | "date_out_of_range"
  | "duplicate_receipt"
  | "stale_receipt";

export interface AutoApproveInput {
  totalCents: number;
  limitCents: number;
  hasReceipt: boolean;
  /** settings.parts.receipt_required_over_cents (0 = always required). */
  receiptRequiredOverCents: number;
  aiConfigured: boolean;
  aiState: AiState;
  aiTotalCents: number | null;
  toleranceCents: number;
  purchasedOn: string;
  /** Job date (company TZ), or the submission date for non-job purchases. */
  referenceDate: string;
  maxAgeDays: number;
  /** Another live claim has the same receipt file (hash match): always review. */
  duplicateReceipt?: boolean;
}

export interface AutoApproveResult {
  decision: "approve" | "review" | "wait";
  flags: PurchaseFlag[];
  /** Eligible for "Approve all clean" on /approvals (no flags, AI matched or n/a). */
  clean: boolean;
}

function dayDiff(a: string, b: string): number {
  const pa = parseDateKey(a);
  const pb = parseDateKey(b);
  return (
    Math.abs(
      Date.UTC(pa.year, pa.month - 1, pa.day) -
        Date.UTC(pb.year, pb.month - 1, pb.day),
    ) / 86_400_000
  );
}

export function evaluateAutoApprove(i: AutoApproveInput): AutoApproveResult {
  const flags: PurchaseFlag[] = [];
  const receiptRequired = i.totalCents > i.receiptRequiredOverCents;
  if (!i.hasReceipt && receiptRequired) flags.push("no_receipt");
  if (i.totalCents >= i.limitCents) flags.push("over_limit");
  let wait = false;
  if (i.aiConfigured && i.hasReceipt) {
    if (i.aiState === "queued") wait = true;
    else if (i.aiState === "done" && i.aiTotalCents != null) {
      if (Math.abs(i.aiTotalCents - i.totalCents) > i.toleranceCents)
        flags.push("ai_mismatch");
    } else flags.push("ai_unreadable");
  }
  if (dayDiff(i.purchasedOn, i.referenceDate) > i.maxAgeDays)
    flags.push("date_out_of_range");
  if (i.duplicateReceipt) flags.push("duplicate_receipt");
  // "clean" ignores the limit: an admin may bulk-approve small-but-over-limit clean receipts.
  const clean = !wait && flags.every((f) => f === "over_limit");
  if (flags.length > 0) return { decision: "review", flags, clean };
  if (wait) return { decision: "wait", flags, clean: false };
  return { decision: "approve", flags, clean: true };
}

export const PURCHASE_FLAG_LABELS: Record<PurchaseFlag, string> = {
  no_receipt: "No receipt photo",
  over_limit: "Over the auto-approve limit",
  ai_mismatch: "Receipt total doesn't match",
  ai_unreadable: "Receipt couldn't be read",
  date_out_of_range: "Date far from the job",
  duplicate_receipt: "Same receipt as another claim",
  stale_receipt: "Waiting over 60 days",
};

/** Markup and margin for a cost/price pair (M15 "UI shows markup and margin"). */
export function markupMargin(
  costCents: number,
  priceCents: number,
): { markupPct: number | null; marginPct: number | null } {
  return {
    markupPct:
      costCents > 0 ? ((priceCents - costCents) / costCents) * 100 : null,
    marginPct:
      priceCents > 0 ? ((priceCents - costCents) / priceCents) * 100 : null,
  };
}

/** Markup matrix (SPEC M15): the first tier whose `lt` exceeds the cost; last tier lt = null. */
export function priceForCostTiers(
  tiers: readonly { lt: number | null; mult: number }[],
  unitCostCents: number,
): number {
  const t =
    tiers.find((x) => x.lt == null || unitCostCents < x.lt) ??
    tiers[tiers.length - 1];
  return Math.round(unitCostCents * (t?.mult ?? 1));
}

/** Weighted average cost after receiving `qty` at `unitCostCents` (inventory). */
export function nextAvgCost(
  onHand: number,
  avgCents: number | null,
  qty: number,
  unitCostCents: number,
): number {
  const prevQty = Math.max(0, onHand);
  const prevAvg = avgCents ?? unitCostCents;
  const total = prevQty + qty;
  if (total <= 0) return unitCostCents;
  return Math.round((prevQty * prevAvg + qty * unitCostCents) / total);
}

export const PURCHASE_CATEGORY_LABEL: Record<string, string> = {
  part: "Part",
  fuel: "Fuel",
  vehicle: "Vehicle supplies",
  tool: "Tool",
  supplies: "Supplies",
  other: "Other",
};
