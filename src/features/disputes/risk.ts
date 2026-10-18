// Job Risk Score engine (SPEC §11.1). PURE: no I/O, no clock reads (pass `now`).
// Golden-tested in tests/golden/risk.test.ts. The DB loader lives in ./api.ts
// (computeJobRisk) and turns rows into `RiskFacts`.
//
// score = clamp(0, 100, Σ points of active signals). Weights and band thresholds are
// admin-editable (settings.risk.weights / settings.risk.bands); missing keys fall back
// to RISK_DEFAULT_WEIGHTS.

export type RiskBand = "low" | "medium" | "high" | "critical";

export const RISK_SIGNAL_KEYS = [
  "keyed_card",
  "payer_mismatch",
  "ticket_1000",
  "ticket_3000",
  "no_signed_estimate",
  "overage_unsigned",
  "after_hours",
  "upsell",
  "new_customer",
  "unknown_source",
  "avs_or_foreign",
  "prior_dispute",
  "complaint",
  "far_future_deposit",
  "strong_auth",
  "repeat_customer",
] as const;
export type RiskSignalKey = (typeof RISK_SIGNAL_KEYS)[number];

/** Default points per signal (SPEC §11.1 table). */
export const RISK_DEFAULT_WEIGHTS: Readonly<Record<RiskSignalKey, number>> = {
  keyed_card: 25,
  payer_mismatch: 15,
  ticket_1000: 15,
  ticket_3000: 25,
  no_signed_estimate: 30,
  overage_unsigned: 25,
  after_hours: 10,
  upsell: 10,
  new_customer: 10,
  unknown_source: 5,
  avs_or_foreign: 15,
  prior_dispute: 40,
  complaint: 20,
  far_future_deposit: 5,
  strong_auth: -15,
  repeat_customer: -10,
};

/** Human labels for the "why" sheet and settings editor. */
export const RISK_SIGNAL_LABELS: Readonly<Record<RiskSignalKey, string>> = {
  keyed_card: "Keyed card (no CVC/AVS)",
  payer_mismatch: "Payer name differs from customer",
  ticket_1000: "Ticket over $1,000",
  ticket_3000: "Ticket over $3,000",
  no_signed_estimate: "No signed estimate",
  overage_unsigned: "Invoice over signed total without a change order",
  after_hours: "After-hours / emergency premium",
  upsell: "Upsell line (cooling-off applies)",
  new_customer: "New customer",
  unknown_source: "Unknown lead source",
  avs_or_foreign: "AVS failed or foreign card",
  prior_dispute: "Prior dispute (customer or card)",
  complaint: "Complaint or low rating",
  far_future_deposit: "Deposit taken > 30 days out",
  strong_auth: "Strong authentication (tap/chip/3DS)",
  repeat_customer: "Repeat customer (≥ 2 paid jobs)",
};

export interface RiskBands {
  medium: number;
  high: number;
  critical: number;
}
export const RISK_DEFAULT_BANDS: RiskBands = {
  medium: 25,
  high: 50,
  critical: 75,
};

export interface RiskConfig {
  weights?: Partial<Record<string, number>>;
  bands?: Partial<RiskBands>;
  /** `no_signed_estimate` only counts at or above this ticket (default $250). */
  noEstimateMinTicketCents?: number;
}

/** A payment (or attempted/intended payment) on the job, as the engine needs it. */
export interface RiskPaymentFact {
  status: string; // payments.status
  entryMode: string | null;
  payerName: string | null;
  avsResult: string | null; // 'pass' | 'fail' | 'unavailable' | 'unchecked' | …
  cardCountry: string | null; // ISO-2, from the provider snapshot
  threeDs: string | null; // 'authenticated' | 'attempt_acknowledged' | …
}

/** Everything the score depends on (built by the DB loader). */
export interface RiskFacts {
  /** max(approved estimate option, invoice total, quoted price), cents. */
  ticketCents: number;
  /** A signed estimate / work authorization exists (verbal does not count). */
  hasSignedAuthorization: boolean;
  /** B3 getChangeOrderStatus().required — invoice exceeds signed total + threshold without a signed CO. */
  overageUnsigned: boolean;
  payments: RiskPaymentFact[];
  /** The office chose a keyed (MOTO) card as the intended method. */
  intendedKeyed?: boolean;
  customerName: string;
  siteContactName?: string | null;
  afterHours: boolean;
  emergency: boolean;
  /** An after-hours/emergency premium line is on the job. */
  hasPremiumLine: boolean;
  hasUpsellLine: boolean;
  /** Completed (or closed) jobs for the customer before this one. */
  priorCompletedJobs: number;
  /** Prior jobs fully paid with no dispute. */
  priorPaidUndisputedJobs: number;
  /** Lead source kind/key: null or 'other' = unknown. `undefined` = no lead involved (not counted). */
  leadSource: string | null | undefined;
  customerDisputeHistory: boolean;
  /** A card fingerprint on this job appears on a disputed payment. */
  fingerprintDisputed: boolean;
  /** Tagged "complaint", internal rating ≤ 2, or staff "customer unhappy". */
  complaint: boolean;
  depositTaken: boolean;
  scheduledStart: Date | null;
  now: Date;
}

export interface RiskSignal {
  key: RiskSignalKey;
  points: number;
  detail: string;
}

export interface RiskScore {
  score: number;
  band: RiskBand;
  signals: RiskSignal[];
}

const BAND_RANK: Record<RiskBand, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export function bandRank(b: RiskBand): number {
  return BAND_RANK[b];
}

/** Score → band using the (possibly edited) thresholds. */
export function bandFor(score: number, bands?: Partial<RiskBands>): RiskBand {
  const b = { ...RISK_DEFAULT_BANDS, ...bands };
  if (score >= b.critical) return "critical";
  if (score >= b.high) return "high";
  if (score >= b.medium) return "medium";
  return "low";
}

const STOP_TOKENS = new Set(["mr", "mrs", "ms", "dr", "jr", "sr", "the"]);

/** Lower-case alphabetic tokens of a name (≥ 2 letters, titles dropped). */
export function nameTokens(name: string | null | undefined): string[] {
  if (!name) return [];
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length >= 2 && !STOP_TOKENS.has(t));
}

/** Token match: true when the two names share at least one significant token. */
export function namesMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ta = nameTokens(a);
  const tb = new Set(nameTokens(b));
  if (ta.length === 0 || tb.size === 0) return false;
  return ta.some((t) => tb.has(t));
}

const SUCCEEDED = new Set([
  "succeeded",
  "partially_refunded",
  "refunded",
  "disputed",
]);

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Pure §11.1 scoring. Returns every ACTIVE signal (points ≠ 0 after weights) with a
 * short detail for the "why" sheet; the score is the clamped sum.
 */
export function scoreRisk(f: RiskFacts, cfg: RiskConfig = {}): RiskScore {
  const w = (k: RiskSignalKey): number => {
    const v = cfg.weights?.[k];
    return typeof v === "number" && Number.isFinite(v)
      ? v
      : RISK_DEFAULT_WEIGHTS[k];
  };
  const minTicket = cfg.noEstimateMinTicketCents ?? 25_000;
  const signals: RiskSignal[] = [];
  const add = (key: RiskSignalKey, detail: string) => {
    const points = w(key);
    if (points !== 0) signals.push({ key, points, detail });
  };

  // keyed_card
  if (f.intendedKeyed || f.payments.some((p) => p.entryMode === "keyed"))
    add("keyed_card", "A card was typed in (no CVC/AVS checks).");

  // payer_mismatch: any named payer that matches neither the customer nor the site contact
  const mismatch = f.payments.find(
    (p) =>
      p.payerName &&
      nameTokens(p.payerName).length > 0 &&
      !namesMatch(p.payerName, f.customerName) &&
      !namesMatch(p.payerName, f.siteContactName),
  );
  if (mismatch)
    add(
      "payer_mismatch",
      `Payer "${mismatch.payerName}" isn't ${f.customerName}.`,
    );

  // ticket size (take the higher only)
  if (f.ticketCents > 300_000)
    add("ticket_3000", `Ticket ${money(f.ticketCents)}.`);
  else if (f.ticketCents > 100_000)
    add("ticket_1000", `Ticket ${money(f.ticketCents)}.`);

  // no signed estimate (gated by a minimum ticket)
  if (!f.hasSignedAuthorization && f.ticketCents >= minTicket)
    add(
      "no_signed_estimate",
      `No signed estimate for a ${money(f.ticketCents)} job.`,
    );

  if (f.overageUnsigned)
    add(
      "overage_unsigned",
      "Invoice exceeds the signed total; no signed change order.",
    );

  if (f.afterHours || (f.emergency && f.hasPremiumLine))
    add(
      "after_hours",
      f.afterHours ? "After-hours job." : "Emergency with premium.",
    );

  if (f.hasUpsellLine) add("upsell", "Includes an upsell line.");

  if (f.priorCompletedJobs === 0)
    add("new_customer", "No prior completed job.");
  if (
    f.leadSource !== undefined &&
    (f.leadSource === null || f.leadSource === "other")
  )
    add("unknown_source", "Lead source unknown.");

  const avs = f.payments.find(
    (p) =>
      p.avsResult === "fail" ||
      (p.cardCountry != null && p.cardCountry.toUpperCase() !== "US"),
  );
  if (avs)
    add(
      "avs_or_foreign",
      avs.avsResult === "fail"
        ? "ZIP/AVS check failed."
        : `Card issued in ${avs.cardCountry}.`,
    );

  if (f.customerDisputeHistory || f.fingerprintDisputed)
    add(
      "prior_dispute",
      f.customerDisputeHistory
        ? "Customer has disputed before."
        : "This card was used in a past dispute.",
    );

  if (f.complaint) add("complaint", "Complaint or low rating on file.");

  if (f.depositTaken && f.scheduledStart) {
    const days = (f.scheduledStart.getTime() - f.now.getTime()) / 86_400_000;
    if (days > 30)
      add("far_future_deposit", `Deposit taken ${Math.floor(days)} days out.`);
  }

  const strong = f.payments.some(
    (p) =>
      SUCCEEDED.has(p.status) &&
      (p.entryMode === "tap" ||
        p.entryMode === "chip" ||
        p.threeDs === "authenticated"),
  );
  if (strong) add("strong_auth", "Card present or 3-D Secure.");

  if (f.priorPaidUndisputedJobs >= 2)
    add(
      "repeat_customer",
      `${f.priorPaidUndisputedJobs} prior paid jobs, no disputes.`,
    );

  const sum = signals.reduce((s, x) => s + x.points, 0);
  const score = Math.max(0, Math.min(100, Math.round(sum)));
  return { score, band: bandFor(score, cfg.bands), signals };
}
