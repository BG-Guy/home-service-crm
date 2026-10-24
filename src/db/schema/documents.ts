// §6.5 Estimates, invoices, signatures (modules: estimates, invoices).
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  pgView,
  real,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import {
  bps,
  createdAt,
  id,
  money,
  qty,
  timestamps,
  tz,
  uuidArray,
} from "../columns";
import { pricebookItems, serviceTypes, users } from "./company";
import { customers, properties } from "./customers";
import { jobs } from "./jobs";

export const estimates = pgTable(
  "estimates",
  {
    id: id(),
    number: text("number").notNull().unique(), // 'E-1001'
    jobId: uuid("job_id").references(() => jobs.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    propertyId: uuid("property_id").references(() => properties.id),
    status: text("status").notNull().default("draft"), // draft|sent|viewed|approved|declined|expired|superseded
    title: text("title"),
    notes: text("notes"),
    warrantyText: text("warranty_text"),
    expiresAt: tz("expires_at"),
    sentAt: tz("sent_at"),
    viewedAt: tz("viewed_at"),
    approvedAt: tz("approved_at"),
    declinedAt: tz("declined_at"),
    declineReason: text("decline_reason"),
    approvedOptionId: uuid("approved_option_id"),
    signatureId: uuid("signature_id"),
    approvalChannel: text("approval_channel"), // remote_link|in_person|verbal
    policyVersionIds: uuidArray("policy_version_ids"),
    /** For estimates without a job (cooling-off rule, compliance notes). */
    serviceTypeId: uuid("service_type_id").references(() => serviceTypes.id),
    /** Staff-chosen photos shown on the estimate (empty = the job's "problem" photos). */
    photoMediaIds: uuidArray("photo_media_ids"),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    index("estimates_status_idx").on(t.status, t.sentAt),
    index("estimates_customer_idx").on(t.customerId),
    index("estimates_sent_idx").on(t.sentAt),
  ],
);

export const estimateOptions = pgTable("estimate_options", {
  id: id(),
  estimateId: uuid("estimate_id")
    .notNull()
    .references(() => estimates.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  sort: integer("sort").notNull().default(0),
  recommended: boolean("recommended").notNull().default(false),
  notes: text("notes"),
  ...timestamps(),
});

export const changeOrders = pgTable("change_orders", {
  id: id(),
  number: text("number").notNull().unique(), // 'CO-1001'
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id),
  estimateId: uuid("estimate_id").references(() => estimates.id),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("draft"), // draft|sent|approved|declined
  deltaCents: money("delta_cents").notNull().default(0),
  signatureId: uuid("signature_id"),
  createdBy: uuid("created_by").references(() => users.id),
  ...timestamps(),
});

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    number: text("number").notNull().unique(), // 'INV-1001'
    jobId: uuid("job_id").references(() => jobs.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    propertyId: uuid("property_id").references(() => properties.id),
    status: text("status").notNull().default("draft"), // draft|issued|partially_paid|paid|void|uncollectible (cache)
    version: integer("version").notNull().default(1),
    issuedAt: tz("issued_at"),
    dueAt: tz("due_at"),
    subtotalCents: money("subtotal_cents").notNull().default(0),
    discountCents: money("discount_cents").notNull().default(0),
    taxCents: money("tax_cents").notNull().default(0),
    totalCents: money("total_cents").notNull().default(0), // frozen at issue
    terms: text("terms"),
    notes: text("notes"),
    warrantyText: text("warranty_text"),
    showPhotos: boolean("show_photos").notNull().default(true),
    photoMediaIds: uuidArray("photo_media_ids"), // ordered selection
    descriptorSuffix: text("descriptor_suffix"), // e.g. 'J1042'
    voidedAt: tz("voided_at"),
    voidReason: text("void_reason"),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps(),
  },
  (t) => [
    index("invoices_customer_idx").on(t.customerId),
    index("invoices_status_idx").on(t.status, t.dueAt),
    index("invoices_issued_idx").on(t.issuedAt),
  ],
);

/** Lines whose parent invoice is issued are immutable (DAL-enforced; revisions copy lines). */
export const lineItems = pgTable(
  "line_items",
  {
    id: id(),
    parentType: text("parent_type").notNull(), // estimate_option|invoice|change_order
    parentId: uuid("parent_id").notNull(),
    sort: integer("sort").notNull().default(0),
    type: text("type").notNull(), // service|labor|part|material|fee|discount
    pricebookItemId: uuid("pricebook_item_id").references(
      () => pricebookItems.id,
    ),
    name: text("name").notNull(),
    description: text("description"),
    qty: qty("qty").notNull().default(1),
    unitPriceCents: money("unit_price_cents").notNull(),
    unitCostCents: money("unit_cost_cents"),
    discountCents: money("discount_cents").notNull().default(0),
    totalCents: money("total_cents").notNull(), // round(qty*unit_price) - discount
    taxable: boolean("taxable").notNull().default(true),
    taxRateBps: bps("tax_rate_bps"),
    partSource: text("part_source"), // company_stock|company_po|company_card|tech_purchased
    partPurchaseId: uuid("part_purchase_id"), // -> part_purchases
    isOptional: boolean("is_optional").notNull().default(false),
    isSelected: boolean("is_selected").notNull().default(true),
    isUpsell: boolean("is_upsell").notNull().default(false), // ⚖️ cooling-off
    isServiceFee: boolean("is_service_fee").notNull().default(false),
    warrantyDays: integer("warranty_days"),
    manufacturerWarrantyMonths: integer("manufacturer_warranty_months"),
    serial: text("serial"),
    /**
     * Where an invoice line came from: estimate|change_order|lead_quote|part|manual
     * (LINE_SOURCE_TYPES; null on older rows). With `source_id` (the estimate or
     * change order) an approved estimate replaces what an earlier one put on the
     * draft instead of billing it twice, and "Schedule later" finds its lines.
     */
    sourceType: text("source_type"),
    sourceId: uuid("source_id"),
    ...timestamps(),
  },
  (t) => [index("line_items_parent_idx").on(t.parentType, t.parentId)],
);

/** Append-only (trigger). */
export const invoiceRevisions = pgTable(
  "invoice_revisions",
  {
    id: id(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    sha256: text("sha256").notNull(),
    diff: jsonb("diff"),
    reason: text("reason"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("invoice_revisions_invoice_version_uq").on(t.invoiceId, t.version),
  ],
);

export const creditNotes = pgTable("credit_notes", {
  id: id(),
  number: text("number").notNull().unique(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id),
  amountCents: money("amount_cents").notNull(),
  reason: text("reason").notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
});

/** Append-only (trigger). */
export const signatures = pgTable(
  "signatures",
  {
    id: id(),
    docType: text("doc_type").notNull(), // see SIGNATURE_DOC_TYPES
    docId: uuid("doc_id").notNull(),
    docSha256: text("doc_sha256").notNull(), // hash of rendered snapshot
    docSnapshot: jsonb("doc_snapshot"),
    policyVersionIds: uuidArray("policy_version_ids"),
    signerName: text("signer_name").notNull(),
    signerKind: text("signer_kind").notNull(), // customer|user
    signerUserId: uuid("signer_user_id").references(() => users.id),
    customerId: uuid("customer_id").references(() => customers.id),
    signatureMediaId: uuid("signature_media_id"),
    channel: text("channel").notNull(), // in_person|remote_link|verbal
    esignConsent: boolean("esign_consent").notNull(),
    consentText: text("consent_text"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    accuracyM: real("accuracy_m"),
    deviceTs: tz("device_ts"),
    signedAt: tz("signed_at").notNull().defaultNow(),
    tokenId: uuid("token_id"), // public_tokens (remote)
  },
  (t) => [index("signatures_doc_idx").on(t.docType, t.docId)],
);

/**
 * Derived invoice balances. The view itself is created in a hand-written
 * migration (drizzle/0001_*.sql); `.existing()` keeps drizzle-kit from managing it.
 * balance_cents = total - paid + refunded - credited (tips never in amount_cents).
 */
export const invoiceBalances = pgView("invoice_balances", {
  invoiceId: uuid("invoice_id").notNull(),
  totalCents: bigint("total_cents", { mode: "number" }).notNull(),
  paidCents: bigint("paid_cents", { mode: "number" }).notNull(),
  refundedCents: bigint("refunded_cents", { mode: "number" }).notNull(),
  creditedCents: bigint("credited_cents", { mode: "number" }).notNull(),
}).existing();
