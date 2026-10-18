// Readiness Score engine (SPEC §11.2). PURE: golden-tested in tests/golden/readiness.test.ts.
// readiness = round(100 × Σ earned / Σ weights), where an item that isn't applicable earns
// FULL credit (e.g. no change order was needed; a cash-only job gets the strong-auth item).
// The DB loader (./api.ts computeReadiness) builds `ReadinessFacts`.

export const READINESS_KEYS = [
  "signed_estimate",
  "completion_signed",
  "before_after_photos",
  "geostamps",
  "change_orders_signed",
  "receipt_delivered",
  "comms_log",
  "strong_auth",
] as const;
export type ReadinessKey = (typeof READINESS_KEYS)[number];

export const READINESS_DEFAULT_WEIGHTS: Readonly<Record<ReadinessKey, number>> =
  {
    signed_estimate: 25,
    completion_signed: 20,
    before_after_photos: 15,
    geostamps: 10,
    change_orders_signed: 10,
    receipt_delivered: 10,
    comms_log: 5,
    strong_auth: 5,
  };

export const READINESS_LABELS: Readonly<Record<ReadinessKey, string>> = {
  signed_estimate: "Signed estimate with policies",
  completion_signed: "Completion acknowledgment signed",
  before_after_photos: "Before/after photos",
  geostamps: "Arrival & departure geostamps",
  change_orders_signed: "Change orders signed",
  receipt_delivered: "Receipt delivered",
  comms_log: "Communications log",
  strong_auth: "Strong auth",
};

export interface ReadinessFacts {
  /** A signature on the estimate / work authorization that references policy versions. */
  signedEstimateWithPolicies: boolean;
  /** False when the ticket is under settings.risk.no_estimate_min_ticket_cents (routine call). */
  estimateApplicable: boolean;
  completionSigned: boolean;
  /** Job photos are on (flags `photos` AND `before_after`); off ⇒ item not applicable. */
  photosEnabled: boolean;
  /** Stamped (geo or server-time, not "possibly from library") photos by tag. */
  beforePhotos: number;
  afterPhotos: number;
  arrivedGeostamp: boolean;
  completedGeostamp: boolean;
  /** Change orders that were approved (or are still pending) on the job. */
  changeOrdersTotal: number;
  /** …of which approved WITH a signature. */
  changeOrdersSigned: number;
  /** B3 says a change order is required (overage without a signed CO). */
  changeOrderRequired: boolean;
  /** Succeeded payments on the job (excluding tip-only). */
  paymentsCount: number;
  /** Receipt messages sent/sent_manual/delivered for the job. */
  receiptsDelivered: number;
  /** Customer messages logged on the job (in or out). */
  customerMessages: number;
  /** Card payments on the job (cash/check-only jobs: strong auth not applicable). */
  cardPayments: number;
  /** Card payments with tap/chip/3DS or AVS + CVC pass. */
  strongAuthPayments: number;
}

export interface ReadinessItemResult {
  key: ReadinessKey;
  label: string;
  weight: number;
  applicable: boolean;
  earned: boolean;
  hint: string;
}

export interface ReadinessScore {
  score: number;
  items: ReadinessItemResult[];
}

export const MIN_BEFORE_AFTER = 2;

/** Ring tone (SPEC §11.2): red < 50, amber 50–79, green ≥ 80. */
export function readinessBand(score: number): "red" | "amber" | "green" {
  return score >= 80 ? "green" : score >= 50 ? "amber" : "red";
}

export function scoreReadiness(
  f: ReadinessFacts,
  weights: Partial<Record<string, number>> = {},
): ReadinessScore {
  const w = (k: ReadinessKey) => {
    const v = weights[k];
    return typeof v === "number" && Number.isFinite(v) && v >= 0
      ? v
      : READINESS_DEFAULT_WEIGHTS[k];
  };
  const item = (
    key: ReadinessKey,
    applicable: boolean,
    earned: boolean,
    hint: string,
  ): ReadinessItemResult => ({
    key,
    label: READINESS_LABELS[key],
    weight: w(key),
    applicable,
    earned: applicable ? earned : true,
    hint,
  });

  const coApplicable = f.changeOrdersTotal > 0 || f.changeOrderRequired;
  const items: ReadinessItemResult[] = [
    item(
      "signed_estimate",
      f.estimateApplicable,
      f.signedEstimateWithPolicies,
      !f.estimateApplicable
        ? "Not needed for a small service call."
        : f.signedEstimateWithPolicies
          ? "Signed with the policies shown."
          : "Have the customer sign the estimate before work starts.",
    ),
    item(
      "completion_signed",
      true,
      f.completionSigned,
      f.completionSigned
        ? "Customer signed off on the work."
        : "Get the customer's completion signature.",
    ),
    item(
      "before_after_photos",
      f.photosEnabled,
      f.beforePhotos >= MIN_BEFORE_AFTER && f.afterPhotos >= MIN_BEFORE_AFTER,
      !f.photosEnabled
        ? "Photos are off for this company."
        : `${f.beforePhotos} before, ${f.afterPhotos} after (need ${MIN_BEFORE_AFTER} + ${MIN_BEFORE_AFTER}).`,
    ),
    item(
      "geostamps",
      true,
      f.arrivedGeostamp && f.completedGeostamp,
      f.arrivedGeostamp && f.completedGeostamp
        ? "Arrival and completion were geostamped."
        : !f.arrivedGeostamp
          ? "Arrival has no location stamp."
          : "Completion has no location stamp.",
    ),
    item(
      "change_orders_signed",
      coApplicable,
      !f.changeOrderRequired && f.changeOrdersSigned >= f.changeOrdersTotal,
      !coApplicable
        ? "No change order was needed."
        : f.changeOrderRequired
          ? "The invoice exceeds the signed total; get a signed change order."
          : `${f.changeOrdersSigned} of ${f.changeOrdersTotal} signed.`,
    ),
    item(
      "receipt_delivered",
      f.paymentsCount > 0,
      f.receiptsDelivered >= f.paymentsCount,
      f.paymentsCount === 0
        ? "No payments yet."
        : `${Math.min(f.receiptsDelivered, f.paymentsCount)} of ${f.paymentsCount} receipts sent.`,
    ),
    item(
      "comms_log",
      true,
      f.customerMessages > 0,
      f.customerMessages > 0
        ? `${f.customerMessages} message${f.customerMessages === 1 ? "" : "s"} logged.`
        : "No customer messages on this job.",
    ),
    item(
      "strong_auth",
      f.cardPayments > 0,
      f.strongAuthPayments > 0,
      f.cardPayments === 0
        ? "No card payments."
        : f.strongAuthPayments > 0
          ? "Card present, 3-D Secure or AVS + CVC passed."
          : "Card was not strongly authenticated.",
    ),
  ];
  const total = items.reduce((s, i) => s + i.weight, 0);
  const earned = items.reduce((s, i) => s + (i.earned ? i.weight : 0), 0);
  const score = total === 0 ? 100 : Math.round((100 * earned) / total);
  return { score, items };
}
