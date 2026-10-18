// §6.6 Payments, deposits, disputes, risk (modules: payments, disputes).
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, money, timestamps, tz } from "../columns";
import { depositRules, policyVersions, users } from "./company";
import { customers } from "./customers";
import { estimates, invoices } from "./documents";
import { jobs } from "./jobs";

export const payments = pgTable(
  "payments",
  {
    id: id(),
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    jobId: uuid("job_id").references(() => jobs.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    depositRequestId: uuid("deposit_request_id"),
    kind: text("kind").notNull(), // deposit|payment|tip_only
    method: text("method").notNull(), // card|ach|cash|check|zelle|venmo|other
    provider: text("provider").notNull(), // manual|stripe|square
    providerRef: text("provider_ref"), // PaymentIntent / charge id
    status: text("status").notNull(), // see PAYMENT_STATUSES
    amountCents: money("amount_cents").notNull(), // excludes tip
    tipCents: money("tip_cents").notNull().default(0),
    feeCents: money("fee_cents").notNull().default(0), // processor fee on amount+tip
    feeOnTipCents: money("fee_on_tip_cents").notNull().default(0),
    feeSource: text("fee_source").notNull().default("configured"), // actual|configured
    entryMode: text("entry_mode"), // tap|chip|swipe|keyed|online|wallet|cash|check|p2p
    cardBrand: text("card_brand"),
    cardFunding: text("card_funding"),
    cardLast4: text("card_last4"),
    cardFingerprint: text("card_fingerprint"),
    avsResult: text("avs_result"),
    cvcResult: text("cvc_result"),
    threeDs: text("three_ds"),
    wallet: text("wallet"),
    payerName: text("payer_name"),
    payerIp: text("payer_ip"),
    reference: text("reference"), // check #, Zelle conf
    proofMediaId: uuid("proof_media_id"),
    collectedByUserId: uuid("collected_by_user_id").references(() => users.id),
    verifiedAt: tz("verified_at"),
    verifiedBy: uuid("verified_by").references(() => users.id),
    authorizedAt: tz("authorized_at"),
    captureBefore: tz("capture_before"),
    succeededAt: tz("succeeded_at"),
    clientId: uuid("client_id").unique(),
    idempotencyKey: text("idempotency_key").unique(),
    raw: jsonb("raw"), // provider snapshot (trimmed)
    ...timestamps(),
  },
  (t) => [
    index("payments_invoice_idx").on(t.invoiceId),
    index("payments_job_idx").on(t.jobId),
    index("payments_success_idx")
      .on(t.succeededAt)
      .where(sql`${t.status} = 'succeeded'`),
    index("payments_collected_idx").on(t.collectedByUserId, t.method),
    index("payments_fp_idx").on(t.cardFingerprint),
  ],
);

export const refunds = pgTable(
  "refunds",
  {
    id: id(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
    amountCents: money("amount_cents").notNull(),
    reason: text("reason").notNull(), // incl. 'dispute_lost'
    status: text("status").notNull().default("pending"), // scheduled|pending|succeeded|failed
    dueAt: tz("due_at"), // promised refund date
    providerRef: text("provider_ref"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    completedAt: tz("completed_at"),
  },
  (t) => [
    index("refunds_payment_idx").on(t.paymentId),
    index("refunds_created_idx").on(t.createdAt),
  ],
);

export const depositRequests = pgTable(
  "deposit_requests",
  {
    id: id(),
    jobId: uuid("job_id").references(() => jobs.id),
    estimateId: uuid("estimate_id").references(() => estimates.id),
    ruleId: uuid("rule_id").references(() => depositRules.id),
    amountCents: money("amount_cents").notNull(),
    mode: text("mode").notNull(), // capture|hold|card_on_file|manual
    status: text("status").notNull().default("required"), // see DEPOSIT_STATUSES
    policyVersionId: uuid("policy_version_id").references(
      () => policyVersions.id,
    ),
    policySha256: text("policy_sha256"),
    requestedAt: tz("requested_at"),
    dueAt: tz("due_at"),
    paymentId: uuid("payment_id"),
    specialOrderPoAt: tz("special_order_po_at"),
    waivedBy: uuid("waived_by").references(() => users.id),
    waiveReason: text("waive_reason"),
    forfeitedAt: tz("forfeited_at"),
    capWarning: text("cap_warning"), // ⚖️ compliance warning shown
    ...timestamps(),
  },
  (t) => [index("deposit_requests_job_idx").on(t.jobId)],
);

export const checkoutSessions = pgTable(
  "checkout_sessions",
  {
    id: id(),
    tokenId: uuid("token_id"),
    provider: text("provider").notNull(),
    sessionRef: text("session_ref").notNull().unique(),
    invoiceId: uuid("invoice_id"),
    depositRequestId: uuid("deposit_request_id"),
    amountCents: money("amount_cents").notNull(),
    mode: text("mode").notNull(), // capture|hold|save
    status: text("status").notNull().default("open"), // open|completed|expired
    expiresAt: tz("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("checkout_sessions_status_idx").on(t.status, t.expiresAt)],
);

export const disputes = pgTable(
  "disputes",
  {
    id: id(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
    provider: text("provider").notNull(),
    providerRef: text("provider_ref").notNull().unique(),
    category: text("category").notNull(), // see DISPUTE_CATEGORIES
    networkReasonCode: text("network_reason_code"),
    amountCents: money("amount_cents").notNull(),
    status: text("status").notNull(), // see DISPUTE_STATUSES
    dueBy: tz("due_by"),
    evidence: jsonb("evidence")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}), // NormalizedEvidence (Stripe field names)
    evidenceFiles: jsonb("evidence_files")
      .$type<Record<string, { media_id: string; provider_file_id?: string }>>()
      .notNull()
      .default({}),
    narrative: text("narrative"),
    readinessAtOpen: integer("readiness_at_open"),
    stagedAt: tz("staged_at"),
    submittedAt: tz("submitted_at"),
    outcome: text("outcome"),
    closedAt: tz("closed_at"),
    feeCents: money("fee_cents").notNull().default(1500),
    ...timestamps(),
  },
  (t) => [index("disputes_payment_idx").on(t.paymentId)],
);

export interface RiskSignal {
  key: string;
  points: number;
  detail?: string;
}

export const riskAssessments = pgTable(
  "risk_assessments",
  {
    id: id(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    score: integer("score").notNull(),
    band: text("band").notNull(),
    signals: jsonb("signals").$type<RiskSignal[]>().notNull(),
    trigger: text("trigger").notNull(), // estimate_changed|payer_changed|payment_method|schedule|manual
    computedAt: tz("computed_at").notNull().defaultNow(),
  },
  (t) => [index("risk_job_idx").on(t.jobId, t.computedAt.desc().nullsFirst())],
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: id(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: tz("received_at").notNull().defaultNow(),
    processedAt: tz("processed_at"),
    error: text("error"),
  },
  (t) => [unique("webhook_events_provider_event_uq").on(t.provider, t.eventId)],
);
