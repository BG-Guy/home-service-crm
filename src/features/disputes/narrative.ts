// Dispute narrative + Stripe evidence-field mapping (SPEC M10, RESEARCH §2.4).
// PURE and template-based — never AI on the money path. Tested in tests/disputes/.

export type DisputeCategory =
  | "fraudulent"
  | "unrecognized"
  | "product_not_received"
  | "product_unacceptable"
  | "credit_not_processed"
  | "duplicate"
  | "subscription_canceled"
  | "general";

export const DISPUTE_CATEGORY_LABELS: Record<DisputeCategory, string> = {
  fraudulent: "Fraudulent",
  unrecognized: "Unrecognized",
  product_not_received: "Service not received",
  product_unacceptable: "Service unacceptable",
  credit_not_processed: "Credit not processed",
  duplicate: "Duplicate",
  subscription_canceled: "Subscription canceled",
  general: "General",
};

/** What the evidence builder knows about the job (dates are pre-formatted strings). */
export interface NarrativeFacts {
  companyName: string;
  customerName: string;
  customerEmail: string | null;
  serviceAddress: string;
  jobNumber: string;
  serviceName: string;
  /** "Oct 14, 2026" */
  bookedOn: string | null;
  serviceDate: string | null;
  arrivedAt: string | null;
  completedAt: string | null;
  techName: string | null;
  techLicense: string | null;
  lineSummary: string; // "Drain clearing ($189.00); Labor 4 h ($340.00)"
  totalFormatted: string;
  amountFormatted: string;
  paymentMethodLabel: string; // "Visa ••4242 (tap)"
  paidAt: string | null;
  estimateSigned: { signer: string; at: string; channel: string } | null;
  completionSigned: { signer: string; at: string } | null;
  arrivalGeostamped: boolean;
  completionGeostamped: boolean;
  beforePhotos: number;
  afterPhotos: number;
  messagesCount: number;
  portalViews: number;
  receiptSent: boolean;
  refundPolicy: string | null;
  cancellationPolicy: string | null;
  priorJobs: number;
  depositAndBalance: { depositRef: string; balanceRef: string } | null;
  ip: string | null;
}

const join = (parts: (string | null | false | undefined)[]) =>
  parts.filter(Boolean).join(" ");

/** Neutral, chronological 5–8 sentence narrative for `uncategorized_text`. */
export function buildNarrative(
  category: DisputeCategory,
  f: NarrativeFacts,
): string {
  const s: string[] = [];
  s.push(
    join([
      `${f.customerName} requested ${f.serviceName.toLowerCase()} at ${f.serviceAddress}`,
      f.bookedOn ? `and booked the visit on ${f.bookedOn}` : null,
      `(job ${f.jobNumber}).`,
    ]),
  );
  if (f.estimateSigned)
    s.push(
      `Before work began, ${f.estimateSigned.signer} reviewed and signed the itemized estimate (${f.estimateSigned.channel.replace("_", " ")}) on ${f.estimateSigned.at}, accepting the price and our policies.`,
    );
  if (f.arrivedAt)
    s.push(
      join([
        `${f.techName ?? "Our technician"}${f.techLicense ? ` (license ${f.techLicense})` : ""} arrived on ${f.arrivedAt}`,
        f.arrivalGeostamped
          ? "and the arrival was recorded with the device location."
          : ".",
      ]).replace(" .", "."),
    );
  s.push(
    `The work performed was: ${f.lineSummary}, for a total of ${f.totalFormatted}.`,
  );
  if (f.beforePhotos + f.afterPhotos > 0)
    s.push(
      `${f.beforePhotos} before and ${f.afterPhotos} after photos were taken on site with time and location stamps.`,
    );
  if (f.completionSigned)
    s.push(
      `On completion (${f.completedAt ?? f.completionSigned.at}), ${f.completionSigned.signer} signed an acknowledgment that the work was completed.`,
    );
  else if (f.completedAt) s.push(`The job was completed on ${f.completedAt}.`);
  s.push(
    join([
      `Payment of ${f.amountFormatted} was made by ${f.paymentMethodLabel}`,
      f.paidAt ? `on ${f.paidAt}` : null,
      f.receiptSent ? "and a receipt was sent immediately." : ".",
    ]).replace(" .", "."),
  );
  switch (category) {
    case "fraudulent":
    case "unrecognized":
      s.push(
        join([
          "The cardholder was present for the service",
          f.priorJobs > 0
            ? `and has used ${f.companyName} ${f.priorJobs} time${f.priorJobs === 1 ? "" : "s"} before.`
            : ".",
        ]).replace(" .", "."),
      );
      break;
    case "product_not_received":
      s.push(
        `The service was delivered on ${f.serviceDate ?? f.completedAt ?? "the scheduled date"}, as the geostamps and photos show.`,
      );
      break;
    case "product_unacceptable":
      s.push(
        "The customer approved the scope and price in advance and signed off on the completed work; no complaint was raised before the dispute.",
      );
      break;
    case "credit_not_processed":
      s.push(
        f.refundPolicy
          ? "No refund was owed under the refund policy the customer accepted."
          : "No refund was promised or owed for this completed service.",
      );
      break;
    case "duplicate":
      s.push(
        f.depositAndBalance
          ? `The charges are a deposit (${f.depositAndBalance.depositRef}) and the remaining balance (${f.depositAndBalance.balanceRef}), not a duplicate.`
          : "Each charge corresponds to a separate amount owed; none was a duplicate.",
      );
      break;
    default:
      break;
  }
  return s.slice(0, 9).join(" ");
}

/** Stripe evidence text fields (NormalizedEvidence without files). */
export interface EvidenceText {
  customer_name?: string;
  customer_email_address?: string;
  customer_purchase_ip?: string;
  billing_address?: string;
  product_description?: string;
  service_date?: string;
  cancellation_policy_disclosure?: string;
  cancellation_rebuttal?: string;
  refund_policy_disclosure?: string;
  refund_refusal_explanation?: string;
  duplicate_charge_explanation?: string;
  uncategorized_text?: string;
}

export const EVIDENCE_TEXT_FIELDS: readonly {
  key: keyof EvidenceText;
  label: string;
  multiline?: boolean;
}[] = [
  { key: "customer_name", label: "Customer name" },
  { key: "customer_email_address", label: "Customer email" },
  { key: "customer_purchase_ip", label: "Customer IP" },
  { key: "billing_address", label: "Service address" },
  { key: "service_date", label: "Service date" },
  { key: "product_description", label: "Service description", multiline: true },
  {
    key: "refund_policy_disclosure",
    label: "Refund policy disclosure",
    multiline: true,
  },
  {
    key: "refund_refusal_explanation",
    label: "Refund refusal explanation",
    multiline: true,
  },
  {
    key: "cancellation_policy_disclosure",
    label: "Cancellation policy disclosure",
    multiline: true,
  },
  {
    key: "cancellation_rebuttal",
    label: "Cancellation rebuttal",
    multiline: true,
  },
  {
    key: "duplicate_charge_explanation",
    label: "Duplicate charge explanation",
    multiline: true,
  },
  { key: "uncategorized_text", label: "Narrative", multiline: true },
];

/** File evidence slots (one file per type on Stripe). */
export const EVIDENCE_FILE_FIELDS = [
  { key: "customer_signature", label: "Customer signature" },
  { key: "service_documentation", label: "Service documentation" },
  { key: "receipt", label: "Receipt" },
  { key: "customer_communication", label: "Customer communication" },
  { key: "refund_policy", label: "Refund policy" },
  { key: "cancellation_policy", label: "Cancellation policy" },
  { key: "duplicate_charge_documentation", label: "Duplicate charge ledger" },
  { key: "access_activity_log", label: "Portal access log" },
  { key: "uncategorized_file", label: "Other file" },
] as const;
export type EvidenceFileKey = (typeof EVIDENCE_FILE_FIELDS)[number]["key"];

/** Which text fields matter for each category (others stay available but empty). */
export function relevantTextFields(
  category: DisputeCategory,
): (keyof EvidenceText)[] {
  const base: (keyof EvidenceText)[] = [
    "customer_name",
    "customer_email_address",
    "billing_address",
    "service_date",
    "product_description",
    "uncategorized_text",
  ];
  switch (category) {
    case "fraudulent":
    case "unrecognized":
      return [...base, "customer_purchase_ip"];
    case "credit_not_processed":
      return [
        ...base,
        "refund_policy_disclosure",
        "refund_refusal_explanation",
      ];
    case "subscription_canceled":
      return [
        ...base,
        "cancellation_policy_disclosure",
        "cancellation_rebuttal",
      ];
    case "duplicate":
      return [...base, "duplicate_charge_explanation"];
    case "product_unacceptable":
      return [...base, "refund_policy_disclosure"];
    default:
      return base;
  }
}

/** Map facts → Stripe text fields for a category (the editor starts from this). */
export function buildEvidenceText(
  category: DisputeCategory,
  f: NarrativeFacts,
): EvidenceText {
  const out: EvidenceText = {
    customer_name: f.customerName,
    customer_email_address: f.customerEmail ?? undefined,
    billing_address: f.serviceAddress,
    service_date: f.serviceDate ?? f.completedAt ?? undefined,
    product_description: `${f.serviceName} — ${f.lineSummary}. Total ${f.totalFormatted}. Job ${f.jobNumber}.`,
    uncategorized_text: buildNarrative(category, f),
  };
  const want = new Set(relevantTextFields(category));
  if (want.has("customer_purchase_ip") && f.ip) out.customer_purchase_ip = f.ip;
  if (want.has("refund_policy_disclosure") && f.refundPolicy)
    out.refund_policy_disclosure = `The customer accepted our refund policy before work began: ${f.refundPolicy}`;
  if (want.has("refund_refusal_explanation"))
    out.refund_refusal_explanation =
      "The service was completed as agreed and signed off by the customer; no refund was requested before the dispute.";
  if (want.has("cancellation_policy_disclosure") && f.cancellationPolicy)
    out.cancellation_policy_disclosure = f.cancellationPolicy;
  if (want.has("cancellation_rebuttal"))
    out.cancellation_rebuttal =
      "The service was not cancelled; it was performed on the scheduled date.";
  if (want.has("duplicate_charge_explanation"))
    out.duplicate_charge_explanation = f.depositAndBalance
      ? `The first charge (${f.depositAndBalance.depositRef}) was the deposit; the second (${f.depositAndBalance.balanceRef}) was the remaining balance. Together they equal the invoice total.`
      : "Each charge was for a separate amount owed.";
  for (const k of Object.keys(out) as (keyof EvidenceText)[])
    if (out[k] == null || out[k] === "") delete out[k];
  return out;
}

/** Suggest "Accept" when the amount is small and the evidence is weak (SPEC M10). */
export function suggestAccept(i: {
  amountCents: number;
  readiness: number | null;
  underCents?: number;
  readinessBelow?: number;
}): boolean {
  return (
    i.amountCents < (i.underCents ?? 5000) &&
    (i.readiness ?? 0) < (i.readinessBelow ?? 50)
  );
}

/** Early-fraud-warning refund suggestion: amount ≤ dispute fee × multiplier. */
export function suggestEfwRefund(i: {
  amountCents: number;
  disputeFeeCents: number;
  multiplier: number;
}): boolean {
  return i.amountCents <= i.disputeFeeCents * i.multiplier;
}
