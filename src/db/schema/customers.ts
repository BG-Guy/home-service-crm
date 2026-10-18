// §6.3 Customers, properties, consent, leads (modules: customers, leads).
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  char,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  type AddressJson,
  createdAt,
  custom,
  day,
  id,
  money,
  softDelete,
  textArray,
  timestamps,
  tz,
} from "../columns";
import { serviceTypes, users } from "./company";

export const customers = pgTable(
  "customers",
  {
    id: id(),
    type: text("type").notNull().default("residential"), // residential|commercial|property_manager|home_warranty
    firstName: text("first_name"),
    lastName: text("last_name"),
    displayName: text("display_name").notNull(),
    companyName: text("company_name"),
    phone: text("phone"), // E.164
    phoneAlt: text("phone_alt"),
    email: text("email"), // lower-cased
    preferredChannel: text("preferred_channel").notNull().default("sms"), // sms|whatsapp|email|call
    language: text("language").notNull().default("en"),
    smsStatus: text("sms_status").notNull().default("unknown"), // unknown|transactional|marketing|opted_out (derived)
    doNotService: boolean("do_not_service").notNull().default(false),
    prepayRequired: boolean("prepay_required").notNull().default(false),
    disputeHistory: boolean("dispute_history").notNull().default(false),
    vip: boolean("vip").notNull().default(false),
    taxExempt: boolean("tax_exempt").notNull().default(false),
    taxExemptMediaId: uuid("tax_exempt_media_id"),
    doNotText: boolean("do_not_text").notNull().default(false),
    doNotContact: boolean("do_not_contact").notNull().default(false),
    isTest: boolean("is_test").notNull().default(false),
    waivedFeeCount: integer("waived_fee_count").notNull().default(0),
    cardFingerprints: textArray("card_fingerprints"), // from payments (risk matching)
    leadSourceId: uuid("lead_source_id"),
    source: text("source"), // denormalized first source
    firstTouch: jsonb("first_touch").$type<Record<string, unknown>>(),
    custom: custom(),
    notes: text("notes"),
    mergedIntoId: uuid("merged_into_id").references(
      (): AnyPgColumn => customers.id,
    ),
    anonymizedAt: tz("anonymized_at"),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    index("customers_phone_idx").on(t.phone),
    index("customers_phone_alt_idx").on(t.phoneAlt),
    index("customers_email_idx").on(t.email),
    index("customers_name_idx").on(
      sql`lower(${t.displayName}) text_pattern_ops`,
    ),
    index("customers_fp_idx").using("gin", t.cardFingerprints),
    index("customers_email_lower_idx").on(
      sql`lower(${t.email}) text_pattern_ops`,
    ),
  ],
);

export const properties = pgTable(
  "properties",
  {
    id: id(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    label: text("label"), // 'Home', 'Rental #2'
    street: text("street").notNull(),
    unit: text("unit"),
    city: text("city").notNull(),
    state: char("state", { length: 2 }).notNull(),
    zip: text("zip").notNull(),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    geocodeStatus: text("geocode_status").notNull().default("pending"), // pending|ok|failed|manual
    timezone: text("timezone"), // derived from ZIP (quiet hours)
    accessNotes: text("access_notes"),
    gateCodeEnc: text("gate_code_enc"),
    pets: text("pets"),
    siteContactName: text("site_contact_name"),
    siteContactPhone: text("site_contact_phone"),
    propertyType: text("property_type"), // house|condo|apartment|commercial|other
    isPrimary: boolean("is_primary").notNull().default(false),
    custom: custom(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    index("properties_customer_idx").on(t.customerId),
    index("properties_addr_idx").on(t.zip, sql`lower(${t.street})`),
    index("properties_street_lower_idx").on(
      sql`lower(${t.street}) text_pattern_ops`,
    ),
  ],
);

/** Append-only (trigger), keep >= 5 years. */
export const consentEvents = pgTable(
  "consent_events",
  {
    id: id(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    address: text("address").notNull(), // phone (E.164) or email
    channel: text("channel").notNull(), // sms|whatsapp|email
    purpose: text("purpose").notNull(), // transactional|marketing
    action: text("action").notNull(), // grant|revoke
    source: text("source").notNull(), // web_form|verbal|sms_keyword|admin|import|portal|natural_language
    textShown: text("text_shown"),
    pageUrl: text("page_url"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    messageId: uuid("message_id"), // inbound message that caused it
    createdAt: createdAt(),
  },
  (t) => [index("consent_customer_idx").on(t.customerId, t.createdAt)],
);

export const leadSources = pgTable("lead_sources", {
  id: id(),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // website|google_lsa|google_ads|angi|thumbtack|yelp|referral|repeat|phone|walk_in|zapier|other
  preset: text("preset").notNull().default("generic"), // generic|zapier|make|thumbtack|angi|google_ads_leadform
  publicKey: text("public_key").unique(), // 'pk_live_…' (not secret)
  secretHash: text("secret_hash"), // sha256 of 'sk_…'
  hookSecretHash: text("hook_secret_hash"), // path secret for presets
  allowedOrigins: textArray("allowed_origins"),
  mapping: jsonb("mapping").$type<Record<string, string>>(),
  turnstileRequired: boolean("turnstile_required").notNull().default(false),
  integrationKind: text("integration_kind").notNull().default("js_snippet"), // plain_form|js_snippet|hosted_form|json_api|preset
  requireTs: boolean("require_ts").notNull().default(true),
  dailyCap: integer("daily_cap").notNull().default(500),
  costModel: text("cost_model").notNull().default("none"), // none|per_lead|monthly
  defaultCostCents: money("default_cost_cents"),
  googleKeyHash: text("google_key_hash"),
  active: boolean("active").notNull().default(true),
  ...timestamps(),
});

export const sourceSpend = pgTable(
  "source_spend",
  {
    id: id(),
    leadSourceId: uuid("lead_source_id")
      .notNull()
      .references(() => leadSources.id),
    month: day("month").notNull(),
    amountCents: money("amount_cents").notNull(),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [unique("source_spend_source_month_uq").on(t.leadSourceId, t.month)],
);

export const leads = pgTable(
  "leads",
  {
    id: id(),
    leadSourceId: uuid("lead_source_id").references(() => leadSources.id),
    externalId: text("external_id"), // marketplace id
    status: text("status").notNull().default("new"), // new|contacted|qualified|booked|lost|spam
    customerId: uuid("customer_id").references(() => customers.id),
    propertyId: uuid("property_id").references(() => properties.id),
    name: text("name"),
    phone: text("phone"),
    email: text("email"),
    address: jsonb("address").$type<AddressJson>(),
    serviceTypeId: uuid("service_type_id").references(() => serviceTypes.id),
    serviceText: text("service_text"),
    quotedPriceCents: money("quoted_price_cents"),
    preferredDate: day("preferred_date"),
    preferredWindow: text("preferred_window"),
    notes: text("notes"),
    attribution: jsonb("attribution")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    extra: jsonb("extra")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /** Values for lead custom fields (custom_field_defs entity 'lead'). */
    custom: jsonb("custom")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    sourceCostCents: money("source_cost_cents"),
    smsConsent: boolean("sms_consent").notNull().default(false),
    marketingConsent: boolean("marketing_consent").notNull().default(false),
    spamScore: integer("spam_score").notNull().default(0),
    isReturning: boolean("is_returning").notNull().default(false),
    isTest: boolean("is_test").notNull().default(false),
    assignedUserId: uuid("assigned_user_id").references(() => users.id),
    firstResponseAt: tz("first_response_at"),
    firstResponseBy: uuid("first_response_by").references(() => users.id),
    lostReason: text("lost_reason"),
    spamReason: text("spam_reason"),
    convertedJobId: uuid("converted_job_id"),
    convertedEstimateId: uuid("converted_estimate_id"),
    dedupeHash: text("dedupe_hash"), // sha256(phone|service)
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("leads_source_ext_uq")
      .on(t.leadSourceId, t.externalId)
      .where(sql`${t.externalId} is not null`),
    index("leads_status_idx").on(t.status, t.createdAt.desc().nullsFirst()),
    index("leads_dedupe_idx").on(t.dedupeHash, t.createdAt),
    index("leads_phone_idx").on(t.phone),
    index("leads_customer_idx").on(t.customerId),
    index("leads_new_assignee_idx")
      .on(t.assignedUserId)
      .where(sql`${t.status} = 'new'`),
    index("leads_created_idx").on(t.createdAt),
  ],
);

export const leadEvents = pgTable(
  "lead_events",
  {
    id: id(),
    leadId: uuid("lead_id").references(() => leads.id),
    leadSourceId: uuid("lead_source_id").references(() => leadSources.id),
    kind: text("kind").notNull(), // received|touch|call_attempt|status|note|spam|mapping_error
    raw: jsonb("raw"),
    outcome: text("outcome"), // connected|no_answer|voicemail|wrong_number
    actorUserId: uuid("actor_user_id").references(() => users.id),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [
    index("lead_events_lead_idx").on(t.leadId, t.createdAt),
    index("lead_events_source_idx").on(t.leadSourceId, t.createdAt.desc()),
  ],
);

/** Manual call log (tel: links). */
export const calls = pgTable(
  "calls",
  {
    id: id(),
    customerId: uuid("customer_id").references(() => customers.id),
    leadId: uuid("lead_id").references(() => leads.id),
    jobId: uuid("job_id"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    direction: text("direction").notNull(), // out|in
    outcome: text("outcome").notNull(), // connected|no_answer|voicemail|wrong_number|busy
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [
    index("calls_lead_idx").on(t.leadId),
    index("calls_customer_idx").on(t.customerId, t.createdAt),
  ],
);
