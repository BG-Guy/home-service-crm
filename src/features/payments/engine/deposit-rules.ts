// Deposit rules engine (SPEC M09 "Deposits"). PURE: golden-tested in
// tests/golden/deposit-rules.test.ts. Rules are evaluated in priority order (lowest
// number first); the first match wins. Amount types: fixed | percent_total |
// percent_parts | parts_plus_percent, with min/max and rounding (default $5).
// Without a card processor, capture/hold/card_on_file fall back to `manual`.

export type DepositMode = "capture" | "hold" | "card_on_file" | "manual";
export type DepositTriggerType =
  | "always"
  | "estimate_total_gte"
  | "has_special_order_parts"
  | "after_hours"
  | "new_customer"
  | "risk_band_gte"
  | "scheduled_days_out_gte"
  | "service_type_in"
  | "lead_source_in"
  | "customer_flag";

export interface DepositRuleLike {
  id: string;
  name: string;
  priority: number;
  active: boolean;
  trigger: { type: DepositTriggerType; value?: unknown };
  amount: {
    type: "fixed" | "percent_total" | "percent_parts" | "parts_plus_percent";
    /** fixed: cents; percent types: percent (e.g. 25 = 25 %). */
    value: number;
    min_cents?: number;
    max_cents?: number;
    round_to_cents?: number;
  };
  mode: string;
  policyVersionId?: string | null;
}

export interface DepositFacts {
  /** Ticket the deposit is computed on (estimate option total, invoice or quoted price). */
  totalCents: number;
  /** Part + material lines (price). */
  partsCents: number;
  /** Special-order part lines (price). */
  specialOrderPartsCents: number;
  afterHours: boolean;
  newCustomer: boolean;
  riskBand: "low" | "medium" | "high" | "critical" | null;
  /** Whole days from now to the scheduled start (null = unscheduled). */
  scheduledDaysOut: number | null;
  serviceTypeId: string | null;
  leadSourceId: string | null;
  customerFlags: { prepayRequired: boolean; disputeHistory: boolean };
  /** For ⚖️ state cap warnings. */
  contractKind?: "repair" | "improvement" | null;
}

export interface DepositEngineOptions {
  hasProcessor: boolean;
  /** Holds only for jobs ≤ N days out (auth holds expire in ~7 days); default 5. */
  holdMaxDaysOut?: number;
  /** Rounding when the rule doesn't set one (default 500 = $5). */
  defaultRoundToCents?: number;
  /** ⚖️ compliance state (company.state) and whether cap warnings are on. */
  state?: string | null;
  capWarnings?: boolean;
}

export interface DepositDecision {
  ruleId: string;
  ruleName: string;
  amountCents: number;
  mode: DepositMode;
  /** The rule asked for a processor mode but none is configured. */
  fellBackToManual: boolean;
  capWarning: string | null;
  policyVersionId: string | null;
}

const BANDS = ["low", "medium", "high", "critical"] as const;

function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v) return v.split(",").map((s) => s.trim());
  return [];
}

/** Does `rule.trigger` match the facts? */
export function triggerMatches(
  t: DepositRuleLike["trigger"],
  f: DepositFacts,
): boolean {
  switch (t.type) {
    case "always":
      return true;
    case "estimate_total_gte":
      return f.totalCents >= Number(t.value ?? 0);
    case "has_special_order_parts":
      return f.specialOrderPartsCents > 0;
    case "after_hours":
      return f.afterHours;
    case "new_customer":
      return f.newCustomer;
    case "risk_band_gte": {
      if (!f.riskBand) return false;
      const want = BANDS.indexOf(String(t.value ?? "high") as never);
      return BANDS.indexOf(f.riskBand) >= (want < 0 ? 2 : want);
    }
    case "scheduled_days_out_gte":
      return (
        f.scheduledDaysOut != null && f.scheduledDaysOut >= Number(t.value ?? 0)
      );
    case "service_type_in":
      return (
        f.serviceTypeId != null && asList(t.value).includes(f.serviceTypeId)
      );
    case "lead_source_in":
      return f.leadSourceId != null && asList(t.value).includes(f.leadSourceId);
    case "customer_flag": {
      const flag = String(t.value ?? "prepay_required");
      if (flag === "dispute_history") return f.customerFlags.disputeHistory;
      return f.customerFlags.prepayRequired;
    }
    default:
      return false;
  }
}

/** Round to the nearest multiple of `step` (half away from zero). */
export function roundToStep(cents: number, step: number): number {
  if (!step || step <= 1) return Math.round(cents);
  const q = cents / step;
  const r = q < 0 ? -Math.round(-q) : Math.round(q);
  return r * step;
}

/** Amount for a rule (before mode decisions). Never exceeds the ticket when it's known. */
export function depositAmount(
  rule: DepositRuleLike,
  f: DepositFacts,
  defaultRoundTo = 500,
): number {
  const a = rule.amount;
  const parts =
    rule.trigger.type === "has_special_order_parts"
      ? f.specialOrderPartsCents
      : f.partsCents;
  let cents: number;
  switch (a.type) {
    case "fixed":
      cents = a.value;
      break;
    case "percent_total":
      cents = (f.totalCents * a.value) / 100;
      break;
    case "percent_parts":
      cents = (parts * a.value) / 100;
      break;
    case "parts_plus_percent":
      cents = parts + ((f.totalCents - parts) * a.value) / 100;
      break;
    default:
      cents = 0;
  }
  cents = roundToStep(cents, a.round_to_cents ?? defaultRoundTo);
  if (a.min_cents != null) cents = Math.max(cents, a.min_cents);
  if (a.max_cents != null) cents = Math.min(cents, a.max_cents);
  if (f.totalCents > 0) cents = Math.min(cents, f.totalCents);
  return Math.max(0, Math.round(cents));
}

/**
 * ⚖️ State deposit caps (warnings only; SPEC M09) for improvement contracts:
 * CA ≤ min($1,000, 10 %); MA over $1,000 ≤ max(1/3, special-order cost); MD ≤ 1/3;
 * FL > 10 % → permit/start-deadline reminder.
 */
export function depositCapWarning(
  amountCents: number,
  f: DepositFacts,
  state: string | null | undefined,
): string | null {
  if (f.contractKind !== "improvement" || !state || f.totalCents <= 0)
    return null;
  const total = f.totalCents;
  switch (state.toUpperCase()) {
    case "CA": {
      const cap = Math.min(100_000, Math.floor(total / 10));
      return amountCents > cap
        ? "California limits home-improvement deposits to $1,000 or 10% of the contract, whichever is less."
        : null;
    }
    case "MA": {
      if (total <= 100_000) return null;
      const cap = Math.max(Math.floor(total / 3), f.specialOrderPartsCents);
      return amountCents > cap
        ? "Massachusetts limits deposits over $1,000 to one-third of the contract or the cost of special-order materials."
        : null;
    }
    case "MD":
      return amountCents > Math.floor(total / 3)
        ? "Maryland limits home-improvement deposits to one-third of the contract price."
        : null;
    case "FL":
      return amountCents > Math.floor(total / 10)
        ? "Florida: deposits over 10% require applying for permits within 30 days and starting work within 90 days of the permit."
        : null;
    default:
      return null;
  }
}

/** Evaluate the rules (priority order, first match wins). null = no deposit. */
export function evaluateDepositRules(
  rules: readonly DepositRuleLike[],
  f: DepositFacts,
  o: DepositEngineOptions,
): DepositDecision | null {
  const ordered = rules
    .filter((r) => r.active)
    .slice()
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  for (const rule of ordered) {
    if (!triggerMatches(rule.trigger, f)) continue;
    const amountCents = depositAmount(rule, f, o.defaultRoundToCents ?? 500);
    if (amountCents <= 0) continue;
    let mode = (
      ["capture", "hold", "card_on_file", "manual"].includes(rule.mode)
        ? rule.mode
        : "capture"
    ) as DepositMode;
    let fellBackToManual = false;
    if (mode !== "manual" && !o.hasProcessor) {
      mode = "manual";
      fellBackToManual = true;
    }
    if (
      mode === "hold" &&
      (f.scheduledDaysOut == null ||
        f.scheduledDaysOut > (o.holdMaxDaysOut ?? 5))
    )
      mode = "capture";
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      amountCents,
      mode,
      fellBackToManual,
      capWarning:
        o.capWarnings === false
          ? null
          : depositCapWarning(amountCents, f, o.state),
      policyVersionId: rule.policyVersionId ?? null,
    };
  }
  return null;
}
