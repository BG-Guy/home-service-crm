// Allowed values for text "enum" columns (docs/SPEC.md §6.1: stored as text, validated with zod).
// Adding a value never needs a migration — add it here (and handle it in code).
// Pattern: `export const X = [...] as const; export const zX = z.enum(X); export type X = …`.
import { z } from "zod";

const e = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values);

// ---------- §6.2 Company, auth, team, config ----------
export const BASE_ROLES = ["admin", "office", "tech"] as const;
export const zBaseRole = e(BASE_ROLES);
export type BaseRole = (typeof BASE_ROLES)[number];

export const USER_STATUSES = [
  "invited",
  "pending",
  "active",
  "deactivated",
] as const;
export const zUserStatus = e(USER_STATUSES);
export type UserStatus = (typeof USER_STATUSES)[number];

export const WORKER_TYPES = ["w2", "1099"] as const;
export const zWorkerType = e(WORKER_TYPES);
export type WorkerType = (typeof WORKER_TYPES)[number];

export const BANK_ACCOUNT_TYPES = ["checking", "savings"] as const;
export const zBankAccountType = e(BANK_ACCOUNT_TYPES);
export const BANK_HOLDER_TYPES = ["personal", "business"] as const; // PPD | CCD
export const zBankHolderType = e(BANK_HOLDER_TYPES);

export const NOTIFICATION_PREF_VALUES = ["push", "email", "off"] as const;
export const zNotificationPref = e(NOTIFICATION_PREF_VALUES);

export const PERMISSION_EFFECTS = ["allow", "deny"] as const;
export const zPermissionEffect = e(PERMISSION_EFFECTS);

export const COUNTER_KEYS = [
  "job",
  "invoice",
  "estimate",
  "change_order",
  "credit_note",
] as const;
export const zCounterKey = e(COUNTER_KEYS);
export type CounterKey = (typeof COUNTER_KEYS)[number];

export const TIME_ENTRY_SOURCES = ["app", "admin_edit"] as const;
export const zTimeEntrySource = e(TIME_ENTRY_SOURCES);

export const CONTRACT_KINDS = ["repair", "improvement"] as const;
export const zContractKind = e(CONTRACT_KINDS);

/**
 * The three job types every trade books under (service_types.kind): Free estimate,
 * Service call, Project. The trade's own jobs (Lockout, Rekey…) are service_types
 * rows of one of these kinds. Labels, hints and defaults: src/features/jobs/kinds.ts.
 */
export const JOB_KINDS = ["estimate", "service", "project"] as const;
export const zJobKind = e(JOB_KINDS);
export type JobKind = (typeof JOB_KINDS)[number];

export const CHECKLIST_ITEM_TYPES = [
  "check",
  "text",
  "number",
  "photo",
  "signature",
  "select",
] as const;
export const zChecklistItemType = e(CHECKLIST_ITEM_TYPES);

export const TAG_TARGETS = [
  "customer",
  "job",
  "lead",
  "estimate",
  "invoice",
  "vehicle",
  "tool",
] as const;
export const zTagTarget = e(TAG_TARGETS);

export const CUSTOM_FIELD_ENTITIES = [
  "customer",
  "property",
  "job",
  "lead",
  "vehicle",
  "tool",
] as const;
export const zCustomFieldEntity = e(CUSTOM_FIELD_ENTITIES);

export const CUSTOM_FIELD_TYPES = [
  "text",
  "number",
  "money",
  "date",
  "select",
  "multiselect",
  "boolean",
  "photo",
] as const;
export const zCustomFieldType = e(CUSTOM_FIELD_TYPES);

export const POLICY_KINDS = [
  "cancellation",
  "refund",
  "warranty",
  "deposit",
  "esign_consent",
  "sms_terms",
  "privacy",
  "comp_agreement",
  "tool_agreement",
  "monitoring_notice",
  "cooling_off",
  "card_on_file",
  "direct_deposit_auth",
] as const;
export const zPolicyKind = e(POLICY_KINDS);
export type PolicyKind = (typeof POLICY_KINDS)[number];

export const PRICEBOOK_KINDS = [
  "service",
  "labor",
  "part",
  "material",
  "fee",
] as const;
export const zPricebookKind = e(PRICEBOOK_KINDS);

export const DEPOSIT_TRIGGER_TYPES = [
  "always",
  "estimate_total_gte",
  "has_special_order_parts",
  "after_hours",
  "new_customer",
  "risk_band_gte",
  "scheduled_days_out_gte",
  "service_type_in",
  "lead_source_in",
  "customer_flag",
] as const;
export const zDepositTriggerType = e(DEPOSIT_TRIGGER_TYPES);

export const DEPOSIT_AMOUNT_TYPES = [
  "fixed",
  "percent_total",
  "percent_parts",
  "parts_plus_percent",
] as const;
export const zDepositAmountType = e(DEPOSIT_AMOUNT_TYPES);

export const DEPOSIT_MODES = [
  "capture",
  "hold",
  "card_on_file",
  "manual",
] as const;
export const zDepositMode = e(DEPOSIT_MODES);
export type DepositMode = (typeof DEPOSIT_MODES)[number];

// ---------- §6.3 Customers, properties, consent, leads ----------
export const CUSTOMER_TYPES = [
  "residential",
  "commercial",
  "property_manager",
  "home_warranty",
] as const;
export const zCustomerType = e(CUSTOMER_TYPES);

export const PREFERRED_CHANNELS = ["sms", "whatsapp", "email", "call"] as const;
export const zPreferredChannel = e(PREFERRED_CHANNELS);

export const SMS_STATUSES = [
  "unknown",
  "transactional",
  "marketing",
  "opted_out",
] as const;
export const zSmsStatus = e(SMS_STATUSES);

export const GEOCODE_STATUSES = ["pending", "ok", "failed", "manual"] as const;
export const zGeocodeStatus = e(GEOCODE_STATUSES);

export const PROPERTY_TYPES = [
  "house",
  "condo",
  "apartment",
  "commercial",
  "other",
] as const;
export const zPropertyType = e(PROPERTY_TYPES);

export const CONSENT_CHANNELS = ["sms", "whatsapp", "email"] as const;
export const zConsentChannel = e(CONSENT_CHANNELS);
export const CONSENT_PURPOSES = ["transactional", "marketing"] as const;
export const zConsentPurpose = e(CONSENT_PURPOSES);
export const CONSENT_ACTIONS = ["grant", "revoke"] as const;
export const zConsentAction = e(CONSENT_ACTIONS);
export const CONSENT_SOURCES = [
  "web_form",
  "verbal",
  "sms_keyword",
  "admin",
  "import",
  "portal",
  "natural_language",
] as const;
export const zConsentSource = e(CONSENT_SOURCES);

export const LEAD_SOURCE_KINDS = [
  "website",
  "google_lsa",
  "google_ads",
  "angi",
  "thumbtack",
  "yelp",
  "referral",
  "repeat",
  "phone",
  "walk_in",
  "zapier",
  "other",
] as const;
export const zLeadSourceKind = e(LEAD_SOURCE_KINDS);

export const LEAD_SOURCE_PRESETS = [
  "generic",
  "zapier",
  "make",
  "thumbtack",
  "angi",
  "google_ads_leadform",
] as const;
export const zLeadSourcePreset = e(LEAD_SOURCE_PRESETS);

export const LEAD_INTEGRATION_KINDS = [
  "plain_form",
  "js_snippet",
  "hosted_form",
  "json_api",
  "preset",
] as const;
export const zLeadIntegrationKind = e(LEAD_INTEGRATION_KINDS);

export const LEAD_COST_MODELS = ["none", "per_lead", "monthly"] as const;
export const zLeadCostModel = e(LEAD_COST_MODELS);

export const LEAD_STATUSES = [
  "new",
  "contacted",
  "qualified",
  "booked",
  "lost",
  "spam",
] as const;
export const zLeadStatus = e(LEAD_STATUSES);
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_EVENT_KINDS = [
  "received",
  "touch",
  "call_attempt",
  "status",
  "note",
  "spam",
  "mapping_error",
] as const;
export const zLeadEventKind = e(LEAD_EVENT_KINDS);

export const CALL_DIRECTIONS = ["out", "in"] as const;
export const zCallDirection = e(CALL_DIRECTIONS);
export const CALL_OUTCOMES = [
  "connected",
  "no_answer",
  "voicemail",
  "wrong_number",
  "busy",
] as const;
export const zCallOutcome = e(CALL_OUTCOMES);

// ---------- §6.4 Jobs ----------
export const JOB_PRIORITIES = ["normal", "urgent", "emergency"] as const;
export const zJobPriority = e(JOB_PRIORITIES);

export const JOB_STATUSES = [
  "unscheduled",
  "scheduled",
  "confirmed",
  "en_route",
  "arrived",
  "in_progress",
  "on_hold",
  "completed",
  "closed",
  "cancelled",
] as const;
export const zJobStatus = e(JOB_STATUSES);
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_PAYMENT_STATUSES = [
  "none",
  "deposit_paid",
  "partial",
  "paid",
  "refunded",
  "disputed",
] as const;
export const zJobPaymentStatus = e(JOB_PAYMENT_STATUSES);

export const JOB_CANCEL_REASONS = [
  "customer_cancelled",
  "customer_no_show",
  "no_access",
  "price",
  "duplicate",
  "tech_unavailable",
  "weather",
  "other",
] as const;
export const zJobCancelReason = e(JOB_CANCEL_REASONS);

export const CANCEL_REVIEW_STATUSES = ["pending", "ok", "flagged"] as const;
export const zCancelReviewStatus = e(CANCEL_REVIEW_STATUSES);

export const CALLBACK_REASONS = [
  "workmanship",
  "part",
  "customer",
  "other",
] as const;
export const zCallbackReason = e(CALLBACK_REASONS);

export const RISK_BANDS = ["low", "medium", "high", "critical"] as const;
export const zRiskBand = e(RISK_BANDS);
export type RiskBand = (typeof RISK_BANDS)[number];

export const ASSIGNMENT_ROLES = ["primary", "helper"] as const;
export const zAssignmentRole = e(ASSIGNMENT_ROLES);

export const NOTE_VISIBILITIES = ["internal", "customer"] as const;
export const zNoteVisibility = e(NOTE_VISIBILITIES);

// ---------- §6.5 Estimates, invoices, signatures ----------
export const ESTIMATE_STATUSES = [
  "draft",
  "sent",
  "viewed",
  "approved",
  "declined",
  "expired",
] as const;
export const zEstimateStatus = e(ESTIMATE_STATUSES);

export const APPROVAL_CHANNELS = [
  "remote_link",
  "in_person",
  "verbal",
] as const;
export const zApprovalChannel = e(APPROVAL_CHANNELS);

export const CHANGE_ORDER_STATUSES = [
  "draft",
  "sent",
  "approved",
  "declined",
] as const;
export const zChangeOrderStatus = e(CHANGE_ORDER_STATUSES);

export const INVOICE_STATUSES = [
  "draft",
  "issued",
  "partially_paid",
  "paid",
  "void",
  "uncollectible",
] as const;
export const zInvoiceStatus = e(INVOICE_STATUSES);
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const LINE_PARENT_TYPES = [
  "estimate_option",
  "invoice",
  "change_order",
] as const;
export const zLineParentType = e(LINE_PARENT_TYPES);

export const LINE_ITEM_TYPES = [
  "service",
  "labor",
  "part",
  "material",
  "fee",
  "discount",
] as const;
export const zLineItemType = e(LINE_ITEM_TYPES);

export const PART_SOURCES = [
  "company_stock",
  "company_po",
  "company_card",
  "tech_purchased",
] as const;
export const zPartSource = e(PART_SOURCES);

export const SIGNATURE_DOC_TYPES = [
  "estimate",
  "change_order",
  "completion",
  "deposit_terms",
  "ownership",
  "comp_agreement",
  "tool_agreement",
  "monitoring_notice",
  "card_on_file",
  "cooling_off_waiver",
  "statement_ack",
] as const;
export const zSignatureDocType = e(SIGNATURE_DOC_TYPES);

export const SIGNER_KINDS = ["customer", "user"] as const;
export const zSignerKind = e(SIGNER_KINDS);

export const SIGNATURE_CHANNELS = [
  "in_person",
  "remote_link",
  "verbal",
] as const;
export const zSignatureChannel = e(SIGNATURE_CHANNELS);

// ---------- §6.6 Payments, deposits, disputes, risk ----------
export const PAYMENT_KINDS = ["deposit", "payment", "tip_only"] as const;
export const zPaymentKind = e(PAYMENT_KINDS);

export const PAYMENT_METHODS = [
  "card",
  "ach",
  "cash",
  "check",
  "zelle",
  "venmo",
  "other",
] as const;
export const zPaymentMethod = e(PAYMENT_METHODS);
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_PROVIDERS = ["manual", "stripe", "square"] as const;
export const zPaymentProvider = e(PAYMENT_PROVIDERS);

export const PAYMENT_STATUSES = [
  "pending",
  "authorized",
  "succeeded",
  "failed",
  "canceled",
  "refunded",
  "partially_refunded",
  "disputed",
] as const;
export const zPaymentStatus = e(PAYMENT_STATUSES);
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const FEE_SOURCES = ["actual", "configured"] as const;
export const zFeeSource = e(FEE_SOURCES);

export const ENTRY_MODES = [
  "tap",
  "chip",
  "swipe",
  "keyed",
  "online",
  "wallet",
  "cash",
  "check",
  "p2p",
] as const;
export const zEntryMode = e(ENTRY_MODES);

export const REFUND_STATUSES = [
  "scheduled",
  "pending",
  "succeeded",
  "failed",
] as const;
export const zRefundStatus = e(REFUND_STATUSES);

export const DEPOSIT_STATUSES = [
  "required",
  "requested",
  "paid",
  "held",
  "applied",
  "refunded",
  "forfeited",
  "waived",
  "expired",
] as const;
export const zDepositStatus = e(DEPOSIT_STATUSES);

export const CHECKOUT_MODES = ["capture", "hold", "save"] as const;
export const zCheckoutMode = e(CHECKOUT_MODES);
export const CHECKOUT_STATUSES = ["open", "completed", "expired"] as const;
export const zCheckoutStatus = e(CHECKOUT_STATUSES);

export const DISPUTE_CATEGORIES = [
  "fraudulent",
  "unrecognized",
  "product_not_received",
  "product_unacceptable",
  "credit_not_processed",
  "duplicate",
  "subscription_canceled",
  "general",
] as const;
export const zDisputeCategory = e(DISPUTE_CATEGORIES);

export const DISPUTE_STATUSES = [
  "inquiry",
  "needs_response",
  "under_review",
  "won",
  "lost",
  "accepted",
  "warning_closed",
] as const;
export const zDisputeStatus = e(DISPUTE_STATUSES);

export const RISK_TRIGGERS = [
  "estimate_changed",
  "payer_changed",
  "payment_method",
  "schedule",
  "manual",
] as const;
export const zRiskTrigger = e(RISK_TRIGGERS);

// ---------- §6.7 Media ----------
export const MEDIA_KINDS = [
  "photo",
  "document",
  "signature",
  "receipt",
  "avatar",
  "logo",
  "export",
  "backup",
] as const;
export const zMediaKind = e(MEDIA_KINDS);

export const MEDIA_TAGS = [
  "before",
  "during",
  "after",
  "problem",
  "goal",
  "receipt",
  "odometer",
  "document",
  "tool",
  "signature",
  "id_check",
  "other",
] as const;
export const zMediaTag = e(MEDIA_TAGS);

export const MEDIA_FLAGS = [
  "possibly_from_library",
  "no_geo",
  "far_from_site",
] as const;
export const zMediaFlag = e(MEDIA_FLAGS);

// ---------- §6.8 Messaging, automations, notifications, portal ----------
export const MESSAGE_CHANNELS = [
  "sms",
  "whatsapp",
  "email",
  "push",
  "in_app",
] as const;
export const zMessageChannel = e(MESSAGE_CHANNELS);
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

export const TEMPLATE_CHANNELS = ["sms", "email", "push", "in_app"] as const;
export const zTemplateChannel = e(TEMPLATE_CHANNELS);

export const MESSAGE_PURPOSES = [
  "transactional",
  "marketing",
  "review",
  "internal",
] as const;
export const zMessagePurpose = e(MESSAGE_PURPOSES);
export type MessagePurpose = (typeof MESSAGE_PURPOSES)[number];

export const AUDIENCE_TYPES = ["customer", "user"] as const;
export const zAudienceType = e(AUDIENCE_TYPES);

export const SCHEDULED_MESSAGE_STATUSES = [
  "scheduled",
  "deferred_quiet",
  "pending_tap",
  "sent",
  "sent_manual",
  "skipped",
  "delivered",
  "failed",
  "canceled",
  "suppressed_optout",
  "expired",
] as const;
export const zScheduledMessageStatus = e(SCHEDULED_MESSAGE_STATUSES);

export const MESSAGE_DIRECTIONS = ["out", "in"] as const;
export const zMessageDirection = e(MESSAGE_DIRECTIONS);

export const MESSAGE_STATUSES = [
  "queued",
  "sent",
  "sent_manual",
  "delivered",
  "failed",
  "received",
  "logged",
] as const;
export const zMessageStatus = e(MESSAGE_STATUSES);

export const SMS_DRIVERS = [
  "link",
  "console",
  "android_gateway",
  "twilio",
  "telnyx",
] as const;
export const zSmsDriver = e(SMS_DRIVERS);

export const NOTIFICATION_PRIORITIES = ["low", "normal", "high"] as const;
export const zNotificationPriority = e(NOTIFICATION_PRIORITIES);

export const REMINDER_AUDIENCE_TYPES = ["user", "role", "customer"] as const;
export const zReminderAudienceType = e(REMINDER_AUDIENCE_TYPES);
export const REMINDER_CHANNELS = ["push", "email", "sms", "in_app"] as const;
export const zReminderChannel = e(REMINDER_CHANNELS);
export const REMINDER_RECURRENCES = [
  "once",
  "daily",
  "weekly",
  "monthly",
  "every_n_days",
  "every_n_miles",
] as const;
export const zReminderRecurrence = e(REMINDER_RECURRENCES);

export const PUBLIC_TOKEN_KINDS = [
  "job",
  "estimate",
  "invoice",
  "pay",
  "review",
  "tracking",
  "sub_job",
] as const;
export const zPublicTokenKind = e(PUBLIC_TOKEN_KINDS);
export type PublicTokenKind = (typeof PUBLIC_TOKEN_KINDS)[number];

export const PORTAL_ACTIONS = [
  "viewed",
  "signed",
  "approved",
  "declined",
  "pay_opened",
  "paid",
  "confirmed",
  "reschedule_requested",
  "rated",
  "clicked",
  "receipt_flagged",
] as const;
export const zPortalAction = e(PORTAL_ACTIONS);

// ---------- §6.9 Parts & inventory ----------
export const PAID_BY = ["company", "tech"] as const;
export const zPaidBy = e(PAID_BY);

export const PURCHASE_INSTRUMENTS = [
  "personal",
  "company_card",
  "company_account",
  "po",
] as const;
export const zPurchaseInstrument = e(PURCHASE_INSTRUMENTS);

export const PURCHASE_CATEGORIES = [
  "part",
  "fuel",
  "vehicle",
  "tool",
  "supplies",
  "other",
] as const;
export const zPurchaseCategory = e(PURCHASE_CATEGORIES);

export const AI_EXTRACT_STATUSES = [
  "queued",
  "done",
  "failed",
  "skipped",
] as const;
export const zAiExtractStatus = e(AI_EXTRACT_STATUSES);

export const APPROVAL_STATUSES = ["pending", "approved", "rejected"] as const;
export const zApprovalStatus = e(APPROVAL_STATUSES);
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const STOCK_LOCATION_KINDS = ["warehouse", "vehicle"] as const;
export const zStockLocationKind = e(STOCK_LOCATION_KINDS);

export const STOCK_MOVE_KINDS = [
  "receive",
  "transfer",
  "use_on_job",
  "adjust",
  "return",
  "count",
] as const;
export const zStockMoveKind = e(STOCK_MOVE_KINDS);

// ---------- §6.10 Commission, payroll, payouts ----------
export const CASH_SETTLEMENT_MODES = [
  "net_in_payout",
  "separate_remittance",
] as const;
export const zCashSettlementMode = e(CASH_SETTLEMENT_MODES);

export const RATE_SOURCES = [
  "job",
  "tech_service",
  "tech",
  "service",
  "role",
  "plan",
] as const;
export const zRateSource = e(RATE_SOURCES);

export const PAY_PERIOD_STATUSES = ["open", "closed"] as const;
export const zPayPeriodStatus = e(PAY_PERIOD_STATUSES);

export const LEDGER_ENTRY_TYPES = [
  "commission",
  "tip",
  "spiff",
  "reimbursement_parts",
  "reimbursement_expense",
  "reimbursement_mileage",
  "cash_held",
  "cash_remitted",
  "chargeback_hold",
  "chargeback_release",
  "chargeback_clawback",
  "recall_clawback",
  "tool_deduction",
  "tool_allowance",
  "tool_deposit",
  "draw",
  "guarantee_topup",
  "ot_topup",
  "adjustment",
  "payout",
  "carry_forward",
] as const;
export const zLedgerEntryType = e(LEDGER_ENTRY_TYPES);
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

export const WAGE_CLASSES = [
  "wage",
  "reimbursement",
  "custody",
  "n/a",
] as const;
export const zWageClass = e(WAGE_CLASSES);

export const SETTLEMENT_STATUSES = [
  "draft",
  "tech_review",
  "approved",
  "paid",
  "locked",
] as const;
export const zSettlementStatus = e(SETTLEMENT_STATUSES);

export const SETTLEMENT_FLAG_STATUSES = [
  "open",
  "resolved",
  "rejected",
] as const;
export const zSettlementFlagStatus = e(SETTLEMENT_FLAG_STATUSES);

export const PAYOUT_METHODS = [
  "ach_nacha",
  "zelle",
  "check",
  "cash",
  "payroll_provider",
  "stripe_connect",
  "other",
] as const;
export const zPayoutMethod = e(PAYOUT_METHODS);

export const NACHA_SEC_CODES = ["PPD", "CCD"] as const;
export const zNachaSecCode = e(NACHA_SEC_CODES);

export const REMITTANCE_METHODS = ["bank_deposit", "hand_in"] as const;
export const zRemittanceMethod = e(REMITTANCE_METHODS);
export const REMITTANCE_STATUSES = [
  "pending",
  "confirmed",
  "disputed",
] as const;
export const zRemittanceStatus = e(REMITTANCE_STATUSES);

// ---------- §6.11 Vehicles ----------
export const VEHICLE_OWNERSHIP = [
  "company_owned",
  "leased",
  "tech_owned",
] as const;
export const zVehicleOwnership = e(VEHICLE_OWNERSHIP);

export const VEHICLE_STATUSES = ["active", "in_shop", "retired"] as const;
export const zVehicleStatus = e(VEHICLE_STATUSES);

export const ODOMETER_SOURCES = [
  "manual",
  "photo",
  "service",
  "fuel",
  "clock",
] as const;
export const zOdometerSource = e(ODOMETER_SOURCES);

export const VEHICLE_REMINDER_STATUSES = ["ok", "due_soon", "overdue"] as const;
export const zVehicleReminderStatus = e(VEHICLE_REMINDER_STATUSES);

export const VEHICLE_DOCUMENT_KINDS = [
  "registration",
  "insurance",
  "inspection",
  "lease",
  "title",
  "other",
] as const;
export const zVehicleDocumentKind = e(VEHICLE_DOCUMENT_KINDS);

export const ISSUE_SEVERITIES = ["low", "medium", "high", "unsafe"] as const;
export const zIssueSeverity = e(ISSUE_SEVERITIES);

export const VEHICLE_ISSUE_STATUSES = [
  "open",
  "acknowledged",
  "in_repair",
  "resolved",
] as const;
export const zVehicleIssueStatus = e(VEHICLE_ISSUE_STATUSES);

export const TRIP_CLASSIFICATIONS = [
  "business",
  "commute",
  "personal",
] as const;
export const zTripClassification = e(TRIP_CLASSIFICATIONS);

export const APPROVAL_ENTITY_TYPES = [
  "odometer",
  "fuel",
  "service",
  "document",
  "inspection",
  "trip",
  "part_purchase",
  "job_cancel",
  "job_start",
  "settlement_flag",
] as const;
export const zApprovalEntityType = e(APPROVAL_ENTITY_TYPES);

export const APPROVAL_POLICIES = [
  "auto",
  "auto_if_evidence",
  "always_review",
] as const;
export const zApprovalPolicy = e(APPROVAL_POLICIES);

export const AI_TASK_KINDS = [
  "odometer",
  "receipt",
  "shop_invoice",
  "tool_label",
  "maintenance_suggest",
  "explain_flags",
] as const;
export const zAiTaskKind = e(AI_TASK_KINDS);

export const AI_TASK_STATUSES = [
  "queued",
  "running",
  "done",
  "failed",
  "skipped_budget",
  "skipped_policy",
] as const;
export const zAiTaskStatus = e(AI_TASK_STATUSES);

// ---------- §6.12 Tools ----------
export const TOOL_OWNERS = ["company", "tech_owned"] as const;
export const zToolOwner = e(TOOL_OWNERS);

export const TOOL_STATUSES = [
  "available",
  "assigned",
  "in_repair",
  "lost",
  "stolen",
  "retired",
] as const;
export const zToolStatus = e(TOOL_STATUSES);

export const TOOL_CONDITIONS = ["new", "good", "fair", "poor"] as const;
export const zToolCondition = e(TOOL_CONDITIONS);

export const TOOL_AUDIT_STATUSES = [
  "scheduled",
  "in_progress",
  "submitted",
  "reviewed",
] as const;
export const zToolAuditStatus = e(TOOL_AUDIT_STATUSES);

export const TOOL_INCIDENT_KINDS = ["lost", "stolen", "damaged"] as const;
export const zToolIncidentKind = e(TOOL_INCIDENT_KINDS);

export const TOOL_INCIDENT_DECISIONS = [
  "write_off",
  "repair",
  "tech_responsibility",
] as const;
export const zToolIncidentDecision = e(TOOL_INCIDENT_DECISIONS);

// ---------- §6.13 Location, activity, audit, system ----------
export const LOCATION_SOURCES = ["ping", "status"] as const;
export const zLocationSource = e(LOCATION_SOURCES);

export const ACTOR_KINDS = [
  "user",
  "system",
  "api",
  "webhook",
  "public_token",
] as const;
export const zActorKind = e(ACTOR_KINDS);
export type ActorKind = (typeof ACTOR_KINDS)[number];

export const JOB_QUEUE_KINDS = [
  "email",
  "ai",
  "pdf",
  "evidence_pack",
  "export",
  "backup",
  "geocode",
  "vin",
  "recalls",
  "push",
] as const;
export const zJobQueueKind = e(JOB_QUEUE_KINDS);

export const JOB_QUEUE_STATUSES = [
  "queued",
  "running",
  "done",
  "failed",
  "dead",
] as const;
export const zJobQueueStatus = e(JOB_QUEUE_STATUSES);

export const TASK_KINDS = [
  "lead_retry",
  "warranty_claim",
  "restock",
  "callback_customer",
  "refund_due",
  "follow_up",
  "custom",
] as const;
export const zTaskKind = e(TASK_KINDS);

export const TASK_STATUSES = ["open", "done", "dismissed"] as const;
export const zTaskStatus = e(TASK_STATUSES);

export const EXPORT_KINDS = [
  "full",
  "csv",
  "backup",
  "nacha",
  "report",
] as const;
export const zExportKind = e(EXPORT_KINDS);

export const EXPORT_STATUSES = ["queued", "running", "done", "failed"] as const;
export const zExportStatus = e(EXPORT_STATUSES);

// ---------- Polymorphic links (§6.14) ----------
/** Allowed `entity_type` values for media, notes, activity, audit_log, entity_tags, approvals, public_tokens, tasks. */
export const ENTITY_TYPES = [
  "company",
  "user",
  "role",
  "customer",
  "property",
  "lead",
  "lead_source",
  "job",
  "estimate",
  "estimate_option",
  "change_order",
  "invoice",
  "credit_note",
  "line_item",
  "payment",
  "refund",
  "deposit_request",
  "dispute",
  "signature",
  "media",
  "message",
  "scheduled_message",
  "automation",
  "template",
  "reminder",
  "review_request",
  "part_purchase",
  "pricebook_item",
  "stock_location",
  "settlement",
  "settlement_flag",
  "ledger_entry",
  "payout",
  "cash_remittance",
  "comp_plan",
  "vehicle",
  "odometer",
  "fuel",
  "service",
  "document",
  "inspection",
  "vehicle_issue",
  "trip",
  "tool",
  "tool_kit",
  "tool_audit",
  "tool_incident",
  "approval",
  "task",
  "policy_version",
  "time_entry",
  "setting",
  "permission",
  "api_key",
  "export",
] as const;
export const zEntityType = e(ENTITY_TYPES);
export type EntityType = (typeof ENTITY_TYPES)[number];
