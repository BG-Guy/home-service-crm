// §6.10 Commission, payroll, payouts (module: payroll).
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { bps, createdAt, day, id, money, timestamps, tz } from "../columns";
import { users } from "./company";
import { jobs } from "./jobs";

export const compPlans = pgTable(
  "comp_plans",
  {
    id: id(),
    planKey: text("plan_key").notNull(), // 'partner_25'
    name: text("name").notNull(),
    version: integer("version").notNull(),
    effectiveFrom: day("effective_from").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull(), // CompPlan (§10.1), zod-validated
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    archivedAt: tz("archived_at"),
  },
  (t) => [unique("comp_plans_key_version_uq").on(t.planKey, t.version)],
);

export interface TechCompOverrides {
  rate_bps?: number;
  by_service_type?: Record<string, number>;
  tech_keeps_cash?: boolean;
  cash_settlement?: "net_in_payout" | "separate_remittance";
}

/** Plan assignment history per tech. */
export const techComp = pgTable(
  "tech_comp",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    planKey: text("plan_key").notNull(),
    overrides: jsonb("overrides")
      .$type<TechCompOverrides>()
      .notNull()
      .default({}),
    effectiveFrom: day("effective_from").notNull(),
    agreementSignatureId: uuid("agreement_signature_id"),
    agreementPlanVersion: integer("agreement_plan_version"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("tech_comp_user_idx").on(
      t.userId,
      t.effectiveFrom.desc().nullsFirst(),
    ),
  ],
);

/** One per job; recomputed until locked. */
export const jobFinancials = pgTable("job_financials", {
  jobId: uuid("job_id")
    .primaryKey()
    .references(() => jobs.id),
  revenueCents: money("revenue_cents").notNull(), // subtotal - discounts (excl tax, tip)
  taxCents: money("tax_cents").notNull(),
  tipCents: money("tip_cents").notNull(),
  companyPartsCents: money("company_parts_cents").notNull(),
  techPartsCents: money("tech_parts_cents").notNull(),
  feesCents: money("fees_cents").notNull(), // fees attributable to revenue (excl tip fee)
  feesOnTipsCents: money("fees_on_tips_cents").notNull(),
  otherDeductionsCents: money("other_deductions_cents").notNull().default(0),
  baseCents: money("base_cents").notNull(),
  companyNetCents: money("company_net_cents").notNull(),
  planKey: text("plan_key").notNull(),
  planVersion: integer("plan_version").notNull(),
  trace: jsonb("trace").notNull(),
  computedAt: tz("computed_at").notNull().defaultNow(),
  lockedSettlementId: uuid("locked_settlement_id"),
  lockedAt: tz("locked_at"),
});

/** Per tech per job. */
export const jobEarnings = pgTable(
  "job_earnings",
  {
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    splitBps: bps("split_bps").notNull(),
    rateBps: bps("rate_bps").notNull(),
    rateSource: text("rate_source").notNull(), // job|tech_service|tech|service|role|plan
    commissionCents: money("commission_cents").notNull(),
    spiffsCents: money("spiffs_cents").notNull().default(0),
    tipCents: money("tip_cents").notNull(),
    reimbursementCents: money("reimbursement_cents").notNull(),
    cashHeldCents: money("cash_held_cents").notNull(),
    netCents: money("net_cents").notNull(),
    trace: jsonb("trace").notNull(),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.userId] })],
);

export const payPeriods = pgTable("pay_periods", {
  id: id(),
  startsOn: day("starts_on").notNull().unique(),
  endsOn: day("ends_on").notNull(),
  status: text("status").notNull().default("open"), // open|closed
  closedAt: tz("closed_at"),
});

/** Append-only (trigger); + = company owes tech. Corrections are reversals. */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    type: text("type").notNull(), // see LEDGER_ENTRY_TYPES
    amountCents: money("amount_cents").notNull(),
    effectiveDate: day("effective_date").notNull(),
    jobId: uuid("job_id"),
    refTable: text("ref_table"),
    refId: uuid("ref_id"),
    payPeriodId: uuid("pay_period_id").references(() => payPeriods.id),
    settlementId: uuid("settlement_id"),
    reversesId: uuid("reverses_id").references(
      (): AnyPgColumn => ledgerEntries.id,
    ),
    wageClass: text("wage_class").notNull().default("n/a"), // wage|reimbursement|custody|n/a
    needsReview: boolean("needs_review").notNull().default(false), // ⚖️ W-2 deductions
    memo: text("memo"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("ledger_user_period_idx").on(t.userId, t.payPeriodId),
    index("ledger_unsettled_idx")
      .on(t.userId)
      .where(sql`${t.settlementId} is null`),
    index("ledger_job_idx").on(t.jobId),
    index("ledger_ref_idx").on(t.refTable, t.refId),
    index("ledger_effective_idx").on(t.effectiveDate, t.type),
  ],
);

export const settlements = pgTable(
  "settlements",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    payPeriodId: uuid("pay_period_id")
      .notNull()
      .references(() => payPeriods.id),
    status: text("status").notNull().default("draft"), // draft|tech_review|approved|paid|locked
    workerType: text("worker_type").notNull(),
    openingBalanceCents: money("opening_balance_cents").notNull(),
    periodNetCents: money("period_net_cents").notNull(),
    closingBalanceCents: money("closing_balance_cents").notNull(),
    totals: jsonb("totals").$type<Record<string, unknown>>().notNull(),
    reviewDeadline: tz("review_deadline"),
    techAckAt: tz("tech_ack_at"),
    techAckName: text("tech_ack_name"),
    techAckIp: text("tech_ack_ip"),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: tz("approved_at"),
    paidAt: tz("paid_at"),
    lockedAt: tz("locked_at"),
    ...timestamps(),
  },
  (t) => [unique("settlements_user_period_uq").on(t.userId, t.payPeriodId)],
);

export const settlementFlags = pgTable("settlement_flags", {
  id: id(),
  settlementId: uuid("settlement_id")
    .notNull()
    .references(() => settlements.id),
  ledgerEntryId: uuid("ledger_entry_id").references(() => ledgerEntries.id),
  jobId: uuid("job_id"),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  comment: text("comment").notNull(),
  status: text("status").notNull().default("open"), // open|resolved|rejected
  resolution: text("resolution"),
  resolvedBy: uuid("resolved_by").references(() => users.id),
  createdAt: createdAt(),
  resolvedAt: tz("resolved_at"),
});

export const payouts = pgTable("payouts", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  amountCents: money("amount_cents").notNull(),
  method: text("method").notNull(), // ach_nacha|zelle|check|cash|payroll_provider|stripe_connect|other
  reference: text("reference"),
  paidOn: day("paid_on").notNull(),
  proofMediaId: uuid("proof_media_id"),
  nachaBatchId: uuid("nacha_batch_id"),
  ledgerEntryId: uuid("ledger_entry_id"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
});

export const payoutSettlements = pgTable(
  "payout_settlements",
  {
    payoutId: uuid("payout_id")
      .notNull()
      .references(() => payouts.id),
    settlementId: uuid("settlement_id")
      .notNull()
      .references(() => settlements.id),
    amountCents: money("amount_cents").notNull(),
  },
  (t) => [primaryKey({ columns: [t.payoutId, t.settlementId] })],
);

export const nachaBatches = pgTable("nacha_batches", {
  id: id(),
  storageKey: text("storage_key").notNull(),
  secCode: text("sec_code").notNull(), // PPD|CCD
  entryCount: integer("entry_count").notNull(),
  totalCents: money("total_cents").notNull(),
  effectiveDate: day("effective_date").notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
});

export const cashRemittances = pgTable(
  "cash_remittances",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    amountCents: money("amount_cents").notNull(),
    method: text("method").notNull(), // bank_deposit|hand_in
    proofMediaId: uuid("proof_media_id"),
    status: text("status").notNull().default("pending"), // pending|confirmed|disputed
    receivedBy: uuid("received_by").references(() => users.id),
    receivedAt: tz("received_at"),
    ledgerEntryId: uuid("ledger_entry_id"),
    clientId: uuid("client_id").unique(),
    ...timestamps(),
  },
  (t) => [index("cash_remittances_user_idx").on(t.userId, t.status)],
);

export const mileageRates = pgTable("mileage_rates", {
  id: id(),
  effectiveFrom: day("effective_from").notNull().unique(),
  millicentsPerMile: integer("millicents_per_mile").notNull(), // 72500 = 72.5¢
  source: text("source"),
});
