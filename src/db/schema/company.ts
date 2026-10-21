// §6.2 Company, auth, team, config (modules: auth, team, settings).
// Enum-like text columns: allowed values live in src/db/enums.ts.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  type AddressJson,
  bps,
  createdAt,
  day,
  id,
  identityId,
  money,
  softDelete,
  textArray,
  timestamps,
  tz,
  uuidArray,
} from "../columns";

/** Singleton company row (id = 1). */
export const company = pgTable(
  "company",
  {
    id: smallint("id").primaryKey().default(1),
    name: text("name").notNull(), // brand / DBA shown to customers
    legalName: text("legal_name"),
    phone: text("phone"),
    email: text("email"),
    website: text("website"),
    address: jsonb("address").$type<AddressJson>(),
    timezone: text("timezone").notNull().default("America/New_York"),
    state: char("state", { length: 2 }), // compliance profile state
    logoMediaId: uuid("logo_media_id"), // -> media (no FK)
    settings: jsonb("settings")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}), // CompanySettings (zod, defaults merged on read)
    settingsVersion: integer("settings_version").notNull().default(1),
    ...timestamps(),
  },
  (t) => [check("company_singleton_ck", sql`${t.id} = 1`)],
);

export const roles = pgTable("roles", {
  key: text("key").primaryKey(), // 'admin' | 'office' | 'tech' | custom
  name: text("name").notNull(),
  baseRole: text("base_role").notNull(), // admin|office|tech
  builtin: boolean("builtin").notNull().default(false),
  ...timestamps(),
});

export interface LicenseNumber {
  state: string;
  trade: string;
  number: string;
  expires_on?: string;
}

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(), // lower-cased
    phone: text("phone"), // E.164
    name: text("name").notNull(),
    role: text("role")
      .notNull()
      .references(() => roles.key),
    status: text("status").notNull().default("active"), // invited|pending|active|deactivated
    passwordHash: text("password_hash"), // PHC string (argon2id or scrypt)
    avatarMediaId: uuid("avatar_media_id"),
    color: text("color"), // calendar color hex
    licenseNumbers: jsonb("license_numbers")
      .$type<LicenseNumber[]>()
      .notNull()
      .default([]),
    workerType: text("worker_type").notNull().default("1099"), // w2|1099
    compPlanKey: text("comp_plan_key"),
    usesCompanyTools: boolean("uses_company_tools").notNull().default(true),
    usesCompanyVehicle: boolean("uses_company_vehicle").notNull().default(true),
    skills: uuidArray("skills"), // service_type ids
    serviceZips: textArray("service_zips"),
    homeBase: jsonb("home_base").$type<AddressJson>(),
    hireDate: day("hire_date"),
    // Assign hub (team profile). Shown to dispatchers; never an input to the
    // dispatch recommendation (src/features/jobs/dispatch/recommend.ts).
    experienceYears: smallint("experience_years"), // years in the trade (0-60)
    // ⚖️ Personal data: visible only with users.manage or to the member themself;
    // never sent to AI, never on public pages, never used for dispatch ranking.
    birthDate: day("birth_date"),
    monitoringNoticeAckAt: tz("monitoring_notice_ack_at"), // ⚖️ required before location.share
    esignConsentAt: tz("esign_consent_at"),
    bankRoutingEnc: text("bank_routing_enc"),
    bankAccountEnc: text("bank_account_enc"),
    bankLast4: text("bank_last4"),
    bankAccountType: text("bank_account_type"), // checking|savings
    bankHolderType: text("bank_holder_type"), // personal(PPD)|business(CCD)
    bankHolderNameEnc: text("bank_holder_name_enc"), // NACHA receiver name (encrypted)
    bankChangedAt: tz("bank_changed_at"),
    bankVerifiedAt: tz("bank_verified_at"),
    bankVerifiedBy: uuid("bank_verified_by"),
    notificationPrefs: jsonb("notification_prefs")
      .$type<Record<string, "push" | "email" | "off">>()
      .notNull()
      .default({}),
    lastLoginAt: tz("last_login_at"),
    deactivatedAt: tz("deactivated_at"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("users_email_uq").on(t.email),
    index("users_role_idx").on(t.role).where(sql`${t.status} = 'active'`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(), // sha256(base64url token)
    remember: boolean("remember").notNull().default(false),
    expiresAt: tz("expires_at").notNull(),
    lastSeenAt: tz("last_seen_at").notNull().defaultNow(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    revokedAt: tz("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("sessions_user_idx").on(t.userId).where(sql`${t.revokedAt} is null`),
  ],
);

export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: identityId(),
    email: text("email"),
    ip: text("ip"),
    success: boolean("success").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("login_attempts_email_idx").on(t.email, t.createdAt),
    index("login_attempts_ip_idx").on(t.ip, t.createdAt),
  ],
);

export const invites = pgTable("invites", {
  id: id(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  role: text("role")
    .notNull()
    .references(() => roles.key),
  workerType: text("worker_type").notNull().default("1099"),
  tokenHash: text("token_hash").notNull().unique(),
  invitedBy: uuid("invited_by")
    .notNull()
    .references(() => users.id),
  expiresAt: tz("expires_at").notNull(),
  acceptedAt: tz("accepted_at"),
  acceptedUserId: uuid("accepted_user_id").references(() => users.id),
  revokedAt: tz("revoked_at"),
  createdAt: createdAt(),
});

export const passwordResets = pgTable("password_resets", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: tz("expires_at").notNull(),
  usedAt: tz("used_at"),
  createdBy: uuid("created_by").references(() => users.id), // admin-generated link
  createdAt: createdAt(),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    role: text("role")
      .notNull()
      .references(() => roles.key, { onDelete: "cascade" }),
    perm: text("perm").notNull(),
    granted: boolean("granted").notNull(),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.role, t.perm] })],
);

export const userPermissionOverrides = pgTable(
  "user_permission_overrides",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    perm: text("perm").notNull(),
    effect: text("effect").notNull(), // allow|deny
    reason: text("reason"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.perm] }),
    check(
      "user_permission_overrides_effect_ck",
      sql`${t.effect} in ('allow','deny')`,
    ),
  ],
);

/** Integration credentials set via UI (env wins). value_enc = AES-256-GCM `v1:iv:ct:tag`. */
export const secrets = pgTable("secrets", {
  key: text("key").primaryKey(),
  valueEnc: text("value_enc").notNull(),
  last4: text("last4"),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: tz("updated_at").notNull().defaultNow(),
});

/** General server API keys (Zapier etc.). */
export const apiKeys = pgTable("api_keys", {
  id: id(),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(), // 'sk_live_ab12'
  keyHash: text("key_hash").notNull().unique(),
  scopes: text("scopes")
    .array()
    .notNull()
    .default(sql`'{leads:write}'::text[]`),
  lastUsedAt: tz("last_used_at"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
  revokedAt: tz("revoked_at"),
});

/**
 * Gapless human numbers. Next number (same tx as the insert):
 * UPDATE counters SET next_value = next_value + 1 WHERE key=$1 RETURNING prefix, next_value - 1
 */
export const counters = pgTable("counters", {
  key: text("key").primaryKey(), // job|invoice|estimate|change_order|credit_note
  prefix: text("prefix").notNull(),
  nextValue: bigint("next_value", { mode: "number" }).notNull().default(1001),
});

export const timeEntries = pgTable(
  "time_entries",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    clockInAt: tz("clock_in_at").notNull(),
    clockOutAt: tz("clock_out_at"),
    inLat: doublePrecision("in_lat"),
    inLng: doublePrecision("in_lng"),
    outLat: doublePrecision("out_lat"),
    outLng: doublePrecision("out_lng"),
    inOdometerId: uuid("in_odometer_id"), // -> odometer_readings
    outOdometerId: uuid("out_odometer_id"),
    vehicleId: uuid("vehicle_id"),
    breakMinutes: integer("break_minutes").notNull().default(0),
    source: text("source").notNull().default("app"), // app|admin_edit
    editedBy: uuid("edited_by").references(() => users.id),
    editReason: text("edit_reason"),
    clientId: uuid("client_id").unique(), // offline idempotency
    ...timestamps(),
  },
  (t) => [
    index("time_entries_user_idx").on(
      t.userId,
      t.clockInAt.desc().nullsFirst(),
    ),
  ],
);

export const serviceTypes = pgTable("service_types", {
  id: id(),
  name: text("name").notNull(),
  color: text("color"),
  icon: text("icon"),
  aliases: textArray("aliases"), // lead fuzzy matching
  defaultDurationMin: integer("default_duration_min").notNull().default(60),
  defaultPriceCents: money("default_price_cents"),
  contractKind: text("contract_kind").notNull().default("repair"), // repair|improvement
  checklistTemplateId: uuid("checklist_template_id"),
  photosRequiredBefore: integer("photos_required_before").notNull().default(0),
  photosRequiredAfter: integer("photos_required_after").notNull().default(0),
  photosOnInvoice: boolean("photos_on_invoice").notNull().default(true),
  requiresSignedEstimate: boolean("requires_signed_estimate")
    .notNull()
    .default(false),
  requiresOwnershipCheck: boolean("requires_ownership_check")
    .notNull()
    .default(false),
  upsellCovered: boolean("upsell_covered").notNull().default(false), // ⚖️ FTC cooling-off
  warrantyDays: integer("warranty_days").notNull().default(30),
  maintenanceIntervalMonths: integer("maintenance_interval_months"),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
  ...timestamps(),
  ...softDelete(),
});

export interface ChecklistItemDef {
  id: string;
  label: string;
  type: "check" | "text" | "number" | "photo" | "signature" | "select";
  required?: boolean;
  options?: string[];
}

export const checklistTemplates = pgTable("checklist_templates", {
  id: id(),
  name: text("name").notNull(),
  items: jsonb("items").$type<ChecklistItemDef[]>().notNull(),
  ...timestamps(),
});

export const tags = pgTable(
  "tags",
  {
    id: id(),
    name: text("name").notNull(),
    color: text("color").notNull().default("gray"),
    appliesTo: text("applies_to").array().notNull(), // customer|job|lead|estimate|invoice|vehicle|tool
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("tags_name_uq").on(sql`lower(${t.name})`)],
);

export const entityTags = pgTable(
  "entity_tags",
  {
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tagId, t.entityType, t.entityId] }),
    index("entity_tags_entity_idx").on(t.entityType, t.entityId),
  ],
);

export const customFieldDefs = pgTable(
  "custom_field_defs",
  {
    id: id(),
    entityType: text("entity_type").notNull(), // customer|property|job|lead|vehicle|tool
    key: text("key").notNull(),
    label: text("label").notNull(),
    type: text("type").notNull(), // text|number|money|date|select|multiselect|boolean|photo
    options: jsonb("options"),
    required: boolean("required").notNull().default(false),
    serviceTypeIds: uuidArray("service_type_ids"), // empty = all
    showOnInvoice: boolean("show_on_invoice").notNull().default(false),
    sort: integer("sort").notNull().default(0),
    active: boolean("active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [unique("custom_field_defs_entity_key_uq").on(t.entityType, t.key)],
);

export const taxRates = pgTable("tax_rates", {
  id: id(),
  name: text("name").notNull(),
  rateBps: bps("rate_bps").notNull(), // 825 = 8.25%
  isDefault: boolean("is_default").notNull().default(false),
  active: boolean("active").notNull().default(true),
  ...timestamps(),
});

/** Immutable once referenced. */
export const policyVersions = pgTable(
  "policy_versions",
  {
    id: id(),
    kind: text("kind").notNull(), // see POLICY_KINDS
    version: integer("version").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    sha256: text("sha256").notNull(),
    effectiveFrom: tz("effective_from").notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [unique("policy_versions_kind_version_uq").on(t.kind, t.version)],
);

export const pricebookItems = pgTable(
  "pricebook_items",
  {
    id: id(),
    kind: text("kind").notNull(), // service|labor|part|material|fee
    sku: text("sku"),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category"),
    unitCostCents: money("unit_cost_cents"),
    unitPriceCents: money("unit_price_cents"), // null price => markup matrix
    avgCostCents: money("avg_cost_cents"), // maintained by stock moves
    taxable: boolean("taxable").notNull().default(true),
    warrantyDays: integer("warranty_days"),
    manufacturerWarrantyMonths: integer("manufacturer_warranty_months"),
    isSpecialOrder: boolean("is_special_order").notNull().default(false),
    vendor: text("vendor"),
    active: boolean("active").notNull().default(true),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    index("pricebook_name_idx").on(sql`lower(${t.name}) text_pattern_ops`),
  ],
);

export interface DepositRuleTrigger {
  type:
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
  value?: unknown;
}

export interface DepositRuleAmount {
  type: "fixed" | "percent_total" | "percent_parts" | "parts_plus_percent";
  value: number;
  min_cents?: number;
  max_cents?: number;
  round_to_cents?: number;
}

export const depositRules = pgTable("deposit_rules", {
  id: id(),
  name: text("name").notNull(),
  priority: integer("priority").notNull(),
  trigger: jsonb("trigger").$type<DepositRuleTrigger>().notNull(),
  amount: jsonb("amount").$type<DepositRuleAmount>().notNull(),
  mode: text("mode").notNull(), // capture|hold|card_on_file|manual
  policyVersionId: uuid("policy_version_id").references(
    () => policyVersions.id,
  ),
  active: boolean("active").notNull().default(true),
  ...timestamps(),
});
