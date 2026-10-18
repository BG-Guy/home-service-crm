CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" text[] DEFAULT '{leads:write}'::text[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "checklist_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"items" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"phone" text,
	"email" text,
	"website" text,
	"address" jsonb,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"state" char(2),
	"logo_media_id" uuid,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"settings_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_singleton_ck" CHECK ("company"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "counters" (
	"key" text PRIMARY KEY NOT NULL,
	"prefix" text NOT NULL,
	"next_value" bigint DEFAULT 1001 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_field_defs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"type" text NOT NULL,
	"options" jsonb,
	"required" boolean DEFAULT false NOT NULL,
	"service_type_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"show_on_invoice" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_field_defs_entity_key_uq" UNIQUE("entity_type","key")
);
--> statement-breakpoint
CREATE TABLE "deposit_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"priority" integer NOT NULL,
	"trigger" jsonb NOT NULL,
	"amount" jsonb NOT NULL,
	"mode" text NOT NULL,
	"policy_version_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_tags" (
	"tag_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_tags_tag_id_entity_type_entity_id_pk" PRIMARY KEY("tag_id","entity_type","entity_id")
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"role" text NOT NULL,
	"worker_type" text DEFAULT '1099' NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "login_attempts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"email" text,
	"ip" text,
	"success" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_resets_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "policy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"sha256" text NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_versions_kind_version_uq" UNIQUE("kind","version")
);
--> statement-breakpoint
CREATE TABLE "pricebook_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"sku" text,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"unit_cost_cents" bigint,
	"unit_price_cents" bigint,
	"avg_cost_cents" bigint,
	"taxable" boolean DEFAULT true NOT NULL,
	"warranty_days" integer,
	"manufacturer_warranty_months" integer,
	"is_special_order" boolean DEFAULT false NOT NULL,
	"vendor" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role" text NOT NULL,
	"perm" text NOT NULL,
	"granted" boolean NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_role_perm_pk" PRIMARY KEY("role","perm")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"base_role" text NOT NULL,
	"builtin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secrets" (
	"key" text PRIMARY KEY NOT NULL,
	"value_enc" text NOT NULL,
	"last4" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"icon" text,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"default_duration_min" integer DEFAULT 60 NOT NULL,
	"default_price_cents" bigint,
	"contract_kind" text DEFAULT 'repair' NOT NULL,
	"checklist_template_id" uuid,
	"photos_required_before" integer DEFAULT 0 NOT NULL,
	"photos_required_after" integer DEFAULT 0 NOT NULL,
	"photos_on_invoice" boolean DEFAULT true NOT NULL,
	"requires_signed_estimate" boolean DEFAULT false NOT NULL,
	"requires_ownership_check" boolean DEFAULT false NOT NULL,
	"upsell_covered" boolean DEFAULT false NOT NULL,
	"warranty_days" integer DEFAULT 30 NOT NULL,
	"maintenance_interval_months" integer,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"remember" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'gray' NOT NULL,
	"applies_to" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"rate_bps" integer NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"clock_in_at" timestamp with time zone NOT NULL,
	"clock_out_at" timestamp with time zone,
	"in_lat" double precision,
	"in_lng" double precision,
	"out_lat" double precision,
	"out_lng" double precision,
	"in_odometer_id" uuid,
	"out_odometer_id" uuid,
	"vehicle_id" uuid,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'app' NOT NULL,
	"edited_by" uuid,
	"edit_reason" text,
	"client_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_entries_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "user_permission_overrides" (
	"user_id" uuid NOT NULL,
	"perm" text NOT NULL,
	"effect" text NOT NULL,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_permission_overrides_user_id_perm_pk" PRIMARY KEY("user_id","perm"),
	CONSTRAINT "user_permission_overrides_effect_ck" CHECK ("user_permission_overrides"."effect" in ('allow','deny'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"password_hash" text,
	"avatar_media_id" uuid,
	"color" text,
	"license_numbers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"worker_type" text DEFAULT '1099' NOT NULL,
	"comp_plan_key" text,
	"uses_company_tools" boolean DEFAULT true NOT NULL,
	"uses_company_vehicle" boolean DEFAULT true NOT NULL,
	"skills" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"service_zips" text[] DEFAULT '{}'::text[] NOT NULL,
	"home_base" jsonb,
	"hire_date" date,
	"monitoring_notice_ack_at" timestamp with time zone,
	"esign_consent_at" timestamp with time zone,
	"bank_routing_enc" text,
	"bank_account_enc" text,
	"bank_last4" text,
	"bank_account_type" text,
	"bank_holder_type" text,
	"bank_changed_at" timestamp with time zone,
	"bank_verified_at" timestamp with time zone,
	"bank_verified_by" uuid,
	"notification_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_login_at" timestamp with time zone,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid,
	"lead_id" uuid,
	"job_id" uuid,
	"user_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"outcome" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"address" text NOT NULL,
	"channel" text NOT NULL,
	"purpose" text NOT NULL,
	"action" text NOT NULL,
	"source" text NOT NULL,
	"text_shown" text,
	"page_url" text,
	"ip" text,
	"user_agent" text,
	"actor_user_id" uuid,
	"message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text DEFAULT 'residential' NOT NULL,
	"first_name" text,
	"last_name" text,
	"display_name" text NOT NULL,
	"company_name" text,
	"phone" text,
	"phone_alt" text,
	"email" text,
	"preferred_channel" text DEFAULT 'sms' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"sms_status" text DEFAULT 'unknown' NOT NULL,
	"do_not_service" boolean DEFAULT false NOT NULL,
	"prepay_required" boolean DEFAULT false NOT NULL,
	"dispute_history" boolean DEFAULT false NOT NULL,
	"vip" boolean DEFAULT false NOT NULL,
	"tax_exempt" boolean DEFAULT false NOT NULL,
	"tax_exempt_media_id" uuid,
	"do_not_text" boolean DEFAULT false NOT NULL,
	"do_not_contact" boolean DEFAULT false NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"waived_fee_count" integer DEFAULT 0 NOT NULL,
	"card_fingerprints" text[] DEFAULT '{}'::text[] NOT NULL,
	"lead_source_id" uuid,
	"source" text,
	"first_touch" jsonb,
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"merged_into_id" uuid,
	"anonymized_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lead_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid,
	"lead_source_id" uuid,
	"kind" text NOT NULL,
	"raw" jsonb,
	"outcome" text,
	"actor_user_id" uuid,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"preset" text DEFAULT 'generic' NOT NULL,
	"public_key" text,
	"secret_hash" text,
	"hook_secret_hash" text,
	"allowed_origins" text[] DEFAULT '{}'::text[] NOT NULL,
	"mapping" jsonb,
	"turnstile_required" boolean DEFAULT false NOT NULL,
	"integration_kind" text DEFAULT 'js_snippet' NOT NULL,
	"require_ts" boolean DEFAULT true NOT NULL,
	"daily_cap" integer DEFAULT 500 NOT NULL,
	"cost_model" text DEFAULT 'none' NOT NULL,
	"default_cost_cents" bigint,
	"google_key_hash" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_sources_public_key_unique" UNIQUE("public_key")
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_source_id" uuid,
	"external_id" text,
	"status" text DEFAULT 'new' NOT NULL,
	"customer_id" uuid,
	"property_id" uuid,
	"name" text,
	"phone" text,
	"email" text,
	"address" jsonb,
	"service_type_id" uuid,
	"service_text" text,
	"quoted_price_cents" bigint,
	"preferred_date" date,
	"preferred_window" text,
	"notes" text,
	"attribution" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_cost_cents" bigint,
	"sms_consent" boolean DEFAULT false NOT NULL,
	"marketing_consent" boolean DEFAULT false NOT NULL,
	"spam_score" integer DEFAULT 0 NOT NULL,
	"is_returning" boolean DEFAULT false NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"assigned_user_id" uuid,
	"first_response_at" timestamp with time zone,
	"first_response_by" uuid,
	"lost_reason" text,
	"spam_reason" text,
	"converted_job_id" uuid,
	"converted_estimate_id" uuid,
	"dedupe_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"label" text,
	"street" text NOT NULL,
	"unit" text,
	"city" text NOT NULL,
	"state" char(2) NOT NULL,
	"zip" text NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"geocode_status" text DEFAULT 'pending' NOT NULL,
	"timezone" text,
	"access_notes" text,
	"gate_code_enc" text,
	"pets" text,
	"site_contact_name" text,
	"site_contact_phone" text,
	"property_type" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "source_spend" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_source_id" uuid NOT NULL,
	"month" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_spend_source_month_uq" UNIQUE("lead_source_id","month")
);
--> statement-breakpoint
CREATE TABLE "job_assignments" (
	"job_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'primary' NOT NULL,
	"split_bps" integer DEFAULT 10000 NOT NULL,
	"assigned_by" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_assignments_job_id_user_id_pk" PRIMARY KEY("job_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "job_status_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_ts" timestamp with time zone,
	"lat" double precision,
	"lng" double precision,
	"accuracy_m" real,
	"distance_m" real,
	"eta_minutes" integer,
	"note" text,
	"client_id" uuid,
	CONSTRAINT "job_status_events_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"service_type_id" uuid,
	"lead_id" uuid,
	"estimate_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"customer_notes" text,
	"priority" text DEFAULT 'normal' NOT NULL,
	"after_hours" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'unscheduled' NOT NULL,
	"payment_status" text DEFAULT 'none' NOT NULL,
	"scheduled_start" timestamp with time zone,
	"scheduled_end" timestamp with time zone,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"en_route_at" timestamp with time zone,
	"eta_at" timestamp with time zone,
	"arrived_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"cancel_note" text,
	"cancel_review_status" text,
	"is_callback" boolean DEFAULT false NOT NULL,
	"callback_of_job_id" uuid,
	"callback_reason" text,
	"warranty_expires_at" timestamp with time zone,
	"recurrence" jsonb,
	"visit_count" integer DEFAULT 1 NOT NULL,
	"custom_rate_bps" integer,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"risk_score" integer,
	"risk_band" text,
	"readiness_score" integer,
	"cancellation_policy_version_id" uuid,
	"service_fee_disclosure" text,
	"settlement_locked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"customer_id" uuid,
	"job_id" uuid,
	"body" text NOT NULL,
	"visibility" text DEFAULT 'internal' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"author_id" uuid,
	"client_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "notes_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "change_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"job_id" uuid NOT NULL,
	"estimate_id" uuid,
	"reason" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"delta_cents" bigint DEFAULT 0 NOT NULL,
	"signature_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "change_orders_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_notes_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "estimate_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"estimate_id" uuid NOT NULL,
	"label" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"recommended" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estimates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"job_id" uuid,
	"customer_id" uuid NOT NULL,
	"property_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"title" text,
	"notes" text,
	"warranty_text" text,
	"expires_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"decline_reason" text,
	"approved_option_id" uuid,
	"signature_id" uuid,
	"approval_channel" text,
	"policy_version_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "estimates_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "invoice_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"sha256" text NOT NULL,
	"diff" jsonb,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_revisions_invoice_version_uq" UNIQUE("invoice_id","version")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"job_id" uuid,
	"customer_id" uuid NOT NULL,
	"property_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"issued_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"subtotal_cents" bigint DEFAULT 0 NOT NULL,
	"discount_cents" bigint DEFAULT 0 NOT NULL,
	"tax_cents" bigint DEFAULT 0 NOT NULL,
	"total_cents" bigint DEFAULT 0 NOT NULL,
	"terms" text,
	"notes" text,
	"warranty_text" text,
	"show_photos" boolean DEFAULT true NOT NULL,
	"photo_media_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"descriptor_suffix" text,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_type" text NOT NULL,
	"parent_id" uuid NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"type" text NOT NULL,
	"pricebook_item_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"qty" numeric(12, 3) DEFAULT 1 NOT NULL,
	"unit_price_cents" bigint NOT NULL,
	"unit_cost_cents" bigint,
	"discount_cents" bigint DEFAULT 0 NOT NULL,
	"total_cents" bigint NOT NULL,
	"taxable" boolean DEFAULT true NOT NULL,
	"tax_rate_bps" integer,
	"part_source" text,
	"part_purchase_id" uuid,
	"is_optional" boolean DEFAULT false NOT NULL,
	"is_selected" boolean DEFAULT true NOT NULL,
	"is_upsell" boolean DEFAULT false NOT NULL,
	"is_service_fee" boolean DEFAULT false NOT NULL,
	"warranty_days" integer,
	"manufacturer_warranty_months" integer,
	"serial" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_type" text NOT NULL,
	"doc_id" uuid NOT NULL,
	"doc_sha256" text NOT NULL,
	"doc_snapshot" jsonb,
	"policy_version_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"signer_name" text NOT NULL,
	"signer_kind" text NOT NULL,
	"signer_user_id" uuid,
	"customer_id" uuid,
	"signature_media_id" uuid,
	"channel" text NOT NULL,
	"esign_consent" boolean NOT NULL,
	"consent_text" text,
	"ip" text,
	"user_agent" text,
	"lat" double precision,
	"lng" double precision,
	"accuracy_m" real,
	"device_ts" timestamp with time zone,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"token_id" uuid
);
--> statement-breakpoint
CREATE TABLE "checkout_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_id" uuid,
	"provider" text NOT NULL,
	"session_ref" text NOT NULL,
	"invoice_id" uuid,
	"deposit_request_id" uuid,
	"amount_cents" bigint NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkout_sessions_session_ref_unique" UNIQUE("session_ref")
);
--> statement-breakpoint
CREATE TABLE "deposit_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"estimate_id" uuid,
	"rule_id" uuid,
	"amount_cents" bigint NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'required' NOT NULL,
	"policy_version_id" uuid,
	"policy_sha256" text,
	"requested_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"payment_id" uuid,
	"special_order_po_at" timestamp with time zone,
	"waived_by" uuid,
	"waive_reason" text,
	"forfeited_at" timestamp with time zone,
	"cap_warning" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text NOT NULL,
	"category" text NOT NULL,
	"network_reason_code" text,
	"amount_cents" bigint NOT NULL,
	"status" text NOT NULL,
	"due_by" timestamp with time zone,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evidence_files" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"narrative" text,
	"readiness_at_open" integer,
	"staged_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"outcome" text,
	"closed_at" timestamp with time zone,
	"fee_cents" bigint DEFAULT 1500 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disputes_provider_ref_unique" UNIQUE("provider_ref")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid,
	"job_id" uuid,
	"customer_id" uuid NOT NULL,
	"deposit_request_id" uuid,
	"kind" text NOT NULL,
	"method" text NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"status" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"tip_cents" bigint DEFAULT 0 NOT NULL,
	"fee_cents" bigint DEFAULT 0 NOT NULL,
	"fee_on_tip_cents" bigint DEFAULT 0 NOT NULL,
	"fee_source" text DEFAULT 'configured' NOT NULL,
	"entry_mode" text,
	"card_brand" text,
	"card_funding" text,
	"card_last4" text,
	"card_fingerprint" text,
	"avs_result" text,
	"cvc_result" text,
	"three_ds" text,
	"wallet" text,
	"payer_name" text,
	"payer_ip" text,
	"reference" text,
	"proof_media_id" uuid,
	"collected_by_user_id" uuid,
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"authorized_at" timestamp with time zone,
	"capture_before" timestamp with time zone,
	"succeeded_at" timestamp with time zone,
	"client_id" uuid,
	"idempotency_key" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_client_id_unique" UNIQUE("client_id"),
	CONSTRAINT "payments_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"due_at" timestamp with time zone,
	"provider_ref" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "risk_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"band" text NOT NULL,
	"signals" jsonb NOT NULL,
	"trigger" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "webhook_events_provider_event_uq" UNIQUE("provider","event_id")
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"tag" text,
	"storage_key" text NOT NULL,
	"thumb_key" text,
	"original_key" text,
	"mime" text NOT NULL,
	"width" integer,
	"height" integer,
	"bytes" integer,
	"sha256_original" text,
	"sha256_stored" text,
	"caption" text,
	"job_id" uuid,
	"customer_id" uuid,
	"entity_type" text,
	"entity_id" uuid,
	"uploader_id" uuid,
	"file_last_modified" timestamp with time zone,
	"client_captured_at" timestamp with time zone,
	"server_received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"accuracy_m" real,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"include_in_invoice" boolean DEFAULT false NOT NULL,
	"evidence_locked" boolean DEFAULT false NOT NULL,
	"client_id" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger_event" text NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"steps" jsonb NOT NULL,
	"cancel_on" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"feature_flag" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"builtin" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automations_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"type" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"payload" jsonb NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"channel" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"purpose" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"default_body" text NOT NULL,
	"expires_after_minutes" integer,
	"allow_outside_quiet_hours" boolean DEFAULT false NOT NULL,
	"builtin" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_templates_key_channel_locale_uq" UNIQUE("key","channel","locale")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid,
	"lead_id" uuid,
	"job_id" uuid,
	"user_id" uuid,
	"direction" text NOT NULL,
	"channel" text NOT NULL,
	"driver" text NOT NULL,
	"purpose" text NOT NULL,
	"to_address" text,
	"from_address" text,
	"subject" text,
	"body" text NOT NULL,
	"media_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"status" text NOT NULL,
	"provider_id" text,
	"error" text,
	"scheduled_message_id" uuid,
	"template_key" text,
	"sent_by_user_id" uuid,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"url" text,
	"entity_type" text,
	"entity_id" uuid,
	"priority" text DEFAULT 'normal' NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_access_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "portal_access_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"token_id" uuid NOT NULL,
	"path" text NOT NULL,
	"action" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"kind" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"customer_id" uuid,
	"job_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"use_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"last_success_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"template_key" text,
	"audience" jsonb NOT NULL,
	"channel" text NOT NULL,
	"recurrence" jsonb NOT NULL,
	"next_at" timestamp with time zone,
	"last_at" timestamp with time zone,
	"entity_type" text,
	"entity_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"tech_user_id" uuid,
	"token_id" uuid,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"first_sent_at" timestamp with time zone,
	"last_sent_at" timestamp with time zone,
	"clicked_at" timestamp with time zone,
	"click_count" integer DEFAULT 0 NOT NULL,
	"rating" integer,
	"feedback" text,
	"wants_callback" boolean,
	"review_received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_requests_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "scheduled_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" uuid,
	"step_index" integer,
	"dedupe_key" text NOT NULL,
	"event_id" bigint,
	"template_key" text NOT NULL,
	"channel" text NOT NULL,
	"purpose" text NOT NULL,
	"audience_type" text NOT NULL,
	"recipient_customer_id" uuid,
	"recipient_user_id" uuid,
	"to_address" text,
	"entity_type" text,
	"entity_id" uuid,
	"job_id" uuid,
	"send_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"driver" text,
	"assigned_user_id" uuid,
	"rendered_subject" text,
	"rendered_body" text,
	"message_id" uuid,
	"provider_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_messages_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "inventory_levels" (
	"location_id" uuid NOT NULL,
	"pricebook_item_id" uuid NOT NULL,
	"on_hand" numeric(12, 3) DEFAULT 0 NOT NULL,
	"min_qty" numeric(12, 3),
	"max_qty" numeric(12, 3),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_levels_location_id_pricebook_item_id_pk" PRIMARY KEY("location_id","pricebook_item_id")
);
--> statement-breakpoint
CREATE TABLE "part_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paid_by" text NOT NULL,
	"instrument" text,
	"purchaser_user_id" uuid,
	"category" text DEFAULT 'part' NOT NULL,
	"job_id" uuid,
	"vehicle_id" uuid,
	"tool_id" uuid,
	"vendor" text,
	"purchased_on" date,
	"subtotal_cents" bigint,
	"tax_cents" bigint,
	"total_cents" bigint NOT NULL,
	"receipt_media_id" uuid,
	"ai_extract" jsonb,
	"ai_status" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"reject_reason" text,
	"auto_approved" boolean DEFAULT false NOT NULL,
	"ledger_entry_id" uuid,
	"notes" text,
	"client_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "part_purchases_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "stock_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"vehicle_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pricebook_item_id" uuid NOT NULL,
	"from_location_id" uuid,
	"to_location_id" uuid,
	"qty" numeric(12, 3) NOT NULL,
	"unit_cost_cents" bigint,
	"kind" text NOT NULL,
	"job_id" uuid,
	"line_item_id" uuid,
	"note" text,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_remittances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"method" text NOT NULL,
	"proof_media_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"received_by" uuid,
	"received_at" timestamp with time zone,
	"ledger_entry_id" uuid,
	"client_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_remittances_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "comp_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_key" text NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"effective_from" date NOT NULL,
	"config" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "comp_plans_key_version_uq" UNIQUE("plan_key","version")
);
--> statement-breakpoint
CREATE TABLE "job_earnings" (
	"job_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"split_bps" integer NOT NULL,
	"rate_bps" integer NOT NULL,
	"rate_source" text NOT NULL,
	"commission_cents" bigint NOT NULL,
	"spiffs_cents" bigint DEFAULT 0 NOT NULL,
	"tip_cents" bigint NOT NULL,
	"reimbursement_cents" bigint NOT NULL,
	"cash_held_cents" bigint NOT NULL,
	"net_cents" bigint NOT NULL,
	"trace" jsonb NOT NULL,
	CONSTRAINT "job_earnings_job_id_user_id_pk" PRIMARY KEY("job_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "job_financials" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"revenue_cents" bigint NOT NULL,
	"tax_cents" bigint NOT NULL,
	"tip_cents" bigint NOT NULL,
	"company_parts_cents" bigint NOT NULL,
	"tech_parts_cents" bigint NOT NULL,
	"fees_cents" bigint NOT NULL,
	"fees_on_tips_cents" bigint NOT NULL,
	"other_deductions_cents" bigint DEFAULT 0 NOT NULL,
	"base_cents" bigint NOT NULL,
	"company_net_cents" bigint NOT NULL,
	"plan_key" text NOT NULL,
	"plan_version" integer NOT NULL,
	"trace" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_settlement_id" uuid,
	"locked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"effective_date" date NOT NULL,
	"job_id" uuid,
	"ref_table" text,
	"ref_id" uuid,
	"pay_period_id" uuid,
	"settlement_id" uuid,
	"reverses_id" uuid,
	"wage_class" text DEFAULT 'n/a' NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"memo" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mileage_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"effective_from" date NOT NULL,
	"millicents_per_mile" integer NOT NULL,
	"source" text,
	CONSTRAINT "mileage_rates_effective_from_unique" UNIQUE("effective_from")
);
--> statement-breakpoint
CREATE TABLE "nacha_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_key" text NOT NULL,
	"sec_code" text NOT NULL,
	"entry_count" integer NOT NULL,
	"total_cents" bigint NOT NULL,
	"effective_date" date NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pay_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "pay_periods_starts_on_unique" UNIQUE("starts_on")
);
--> statement-breakpoint
CREATE TABLE "payout_settlements" (
	"payout_id" uuid NOT NULL,
	"settlement_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	CONSTRAINT "payout_settlements_payout_id_settlement_id_pk" PRIMARY KEY("payout_id","settlement_id")
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"paid_on" date NOT NULL,
	"proof_media_id" uuid,
	"nacha_batch_id" uuid,
	"ledger_entry_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_id" uuid NOT NULL,
	"ledger_entry_id" uuid,
	"job_id" uuid,
	"user_id" uuid NOT NULL,
	"comment" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"pay_period_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"worker_type" text NOT NULL,
	"opening_balance_cents" bigint NOT NULL,
	"period_net_cents" bigint NOT NULL,
	"closing_balance_cents" bigint NOT NULL,
	"totals" jsonb NOT NULL,
	"review_deadline" timestamp with time zone,
	"tech_ack_at" timestamp with time zone,
	"tech_ack_name" text,
	"tech_ack_ip" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlements_user_period_uq" UNIQUE("user_id","pay_period_id")
);
--> statement-breakpoint
CREATE TABLE "tech_comp" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_key" text NOT NULL,
	"overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"effective_from" date NOT NULL,
	"agreement_signature_id" uuid,
	"agreement_plan_version" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fuel_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"user_id" uuid,
	"gallons" numeric(8, 3) NOT NULL,
	"total_cents" bigint NOT NULL,
	"odometer_reading_id" uuid,
	"receipt_media_id" uuid,
	"part_purchase_id" uuid,
	"filled_at" timestamp with time zone NOT NULL,
	"approval_status" text DEFAULT 'pending' NOT NULL,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"client_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_logs_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"user_id" uuid,
	"results" jsonb NOT NULL,
	"passed" boolean NOT NULL,
	"media_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"approval_status" text DEFAULT 'pending' NOT NULL,
	"client_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inspections_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "odometer_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"value" integer NOT NULL,
	"unit" text DEFAULT 'mi' NOT NULL,
	"source" text NOT NULL,
	"photo_media_id" uuid,
	"ai_value" integer,
	"ai_confidence" real,
	"recorded_by" uuid,
	"recorded_at" timestamp with time zone NOT NULL,
	"approval_status" text DEFAULT 'pending' NOT NULL,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"client_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "odometer_readings_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "service_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"tasks" text[] NOT NULL,
	"performed_on" date NOT NULL,
	"odometer" integer,
	"vendor" text,
	"cost_cents" bigint,
	"paid_by" text DEFAULT 'company' NOT NULL,
	"receipt_media_id" uuid,
	"part_purchase_id" uuid,
	"ai_extract" jsonb,
	"notes" text,
	"approval_status" text DEFAULT 'pending' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"vehicle_id" uuid,
	"trip_date" date NOT NULL,
	"start_odometer" integer,
	"end_odometer" integer,
	"miles" numeric(8, 1) NOT NULL,
	"destinations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"purpose" text,
	"classification" text DEFAULT 'business' NOT NULL,
	"reimbursable" boolean DEFAULT false NOT NULL,
	"ledger_entry_id" uuid,
	"approval_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trips_user_date_vehicle_uq" UNIQUE("user_id","trip_date","vehicle_id")
);
--> statement-breakpoint
CREATE TABLE "vehicle_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"media_id" uuid NOT NULL,
	"expires_on" date,
	"approval_status" text DEFAULT 'pending' NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"reported_by" uuid,
	"description" text NOT NULL,
	"severity" text NOT NULL,
	"can_drive" boolean NOT NULL,
	"media_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_reminder_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"task" text NOT NULL,
	"interval_miles" integer,
	"interval_days" integer,
	"due_soon_miles" integer,
	"due_soon_days" integer,
	"last_done_on" date,
	"last_done_odometer" integer,
	"next_due_on" date,
	"next_due_miles" integer,
	"status" text DEFAULT 'ok' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_reminder_rules_vehicle_task_uq" UNIQUE("vehicle_id","task")
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nickname" text NOT NULL,
	"vin" text,
	"year" integer,
	"make" text,
	"model" text,
	"trim" text,
	"engine" text,
	"fuel_type" text,
	"gvwr_lbs" integer,
	"usdot_number" text,
	"plate" text,
	"plate_state" char(2),
	"ownership" text DEFAULT 'company_owned' NOT NULL,
	"assigned_user_id" uuid,
	"tank_gal" numeric(6, 2),
	"status" text DEFAULT 'active' NOT NULL,
	"decoded" jsonb,
	"odometer_cached" integer,
	"avg_daily_miles" numeric(8, 2),
	"open_recalls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tool_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool_id" uuid NOT NULL,
	"user_id" uuid,
	"vehicle_id" uuid,
	"checked_out_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_in_at" timestamp with time zone,
	"out_condition" text,
	"in_condition" text,
	"out_media_id" uuid,
	"in_media_id" uuid,
	"acknowledged_at" timestamp with time zone,
	"by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "tool_audit_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_id" uuid NOT NULL,
	"tool_id" uuid NOT NULL,
	"present" boolean,
	"condition" text,
	"media_id" uuid,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "tool_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"due_on" date NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"submitted_at" timestamp with time zone,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool_id" uuid NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"description" text,
	"media_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"police_report_no" text,
	"decision" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"deduction_ledger_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_kits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"vehicle_id" uuid,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_maintenance_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool_id" uuid NOT NULL,
	"task" text NOT NULL,
	"performed_on" date NOT NULL,
	"performed_by_user_id" uuid,
	"vendor" text,
	"cost_cents" bigint,
	"paid_by" text DEFAULT 'company' NOT NULL,
	"part_purchase_id" uuid,
	"media_id" uuid,
	"notes" text,
	"client_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_maintenance_logs_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"brand" text,
	"model" text,
	"serial" text,
	"asset_tag" text,
	"purchase_date" date,
	"purchase_cost_cents" bigint,
	"replacement_cost_cents" bigint,
	"owner" text DEFAULT 'company' NOT NULL,
	"owner_user_id" uuid,
	"status" text DEFAULT 'available' NOT NULL,
	"condition" text DEFAULT 'good' NOT NULL,
	"calibration_due_on" date,
	"maintenance_interval_days" integer,
	"maintenance_task" text,
	"last_maintained_on" date,
	"next_maintenance_on" date,
	"kit_id" uuid,
	"current_user_id" uuid,
	"current_vehicle_id" uuid,
	"notes" text,
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "tools_asset_tag_unique" UNIQUE("asset_tag")
);
--> statement-breakpoint
CREATE TABLE "action_receipts" (
	"client_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "activity_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"customer_id" uuid,
	"job_id" uuid,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"data" jsonb,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"input_hash" text NOT NULL,
	"media_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"model" text,
	"output" jsonb,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "ai_tasks_kind_input_uq" UNIQUE("kind","input_hash")
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"day" date PRIMARY KEY NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"policy" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid,
	"reviewer_id" uuid,
	"decided_at" timestamp with time zone,
	"reason" text,
	"evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_user_id" uuid,
	"actor_kind" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"storage_key" text,
	"requested_by" uuid,
	"params" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "job_queue" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "job_queue_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"dedupe_key" text,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "job_queue_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "location_breadcrumbs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "location_breadcrumbs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"accuracy_m" real,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "scheduler_state" (
	"key" text PRIMARY KEY NOT NULL,
	"last_run_at" timestamp with time zone,
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"payload" jsonb,
	"assignee_user_id" uuid,
	"entity_type" text,
	"entity_id" uuid,
	"customer_id" uuid,
	"job_id" uuid,
	"due_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tech_locations" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"accuracy_m" real,
	"heading" real,
	"speed" real,
	"source" text NOT NULL,
	"job_id" uuid,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_rules" ADD CONSTRAINT "deposit_rules_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_tags" ADD CONSTRAINT "entity_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_role_roles_key_fk" FOREIGN KEY ("role") REFERENCES "public"."roles"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_accepted_user_id_users_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_roles_key_fk" FOREIGN KEY ("role") REFERENCES "public"."roles"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_edited_by_users_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_roles_key_fk" FOREIGN KEY ("role") REFERENCES "public"."roles"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_merged_into_id_customers_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_lead_source_id_lead_sources_id_fk" FOREIGN KEY ("lead_source_id") REFERENCES "public"."lead_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_lead_source_id_lead_sources_id_fk" FOREIGN KEY ("lead_source_id") REFERENCES "public"."lead_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_service_type_id_service_types_id_fk" FOREIGN KEY ("service_type_id") REFERENCES "public"."service_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_first_response_by_users_id_fk" FOREIGN KEY ("first_response_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_spend" ADD CONSTRAINT "source_spend_lead_source_id_lead_sources_id_fk" FOREIGN KEY ("lead_source_id") REFERENCES "public"."lead_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_assignments" ADD CONSTRAINT "job_assignments_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_assignments" ADD CONSTRAINT "job_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_assignments" ADD CONSTRAINT "job_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_status_events" ADD CONSTRAINT "job_status_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_status_events" ADD CONSTRAINT "job_status_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_service_type_id_service_types_id_fk" FOREIGN KEY ("service_type_id") REFERENCES "public"."service_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_callback_of_job_id_jobs_id_fk" FOREIGN KEY ("callback_of_job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_cancellation_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("cancellation_policy_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_estimate_id_estimates_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."estimates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_options" ADD CONSTRAINT "estimate_options_estimate_id_estimates_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."estimates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_revisions" ADD CONSTRAINT "invoice_revisions_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_revisions" ADD CONSTRAINT "invoice_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_items" ADD CONSTRAINT "line_items_pricebook_item_id_pricebook_items_id_fk" FOREIGN KEY ("pricebook_item_id") REFERENCES "public"."pricebook_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_signer_user_id_users_id_fk" FOREIGN KEY ("signer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_requests" ADD CONSTRAINT "deposit_requests_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_requests" ADD CONSTRAINT "deposit_requests_estimate_id_estimates_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."estimates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_requests" ADD CONSTRAINT "deposit_requests_rule_id_deposit_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."deposit_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_requests" ADD CONSTRAINT "deposit_requests_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_requests" ADD CONSTRAINT "deposit_requests_waived_by_users_id_fk" FOREIGN KEY ("waived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_collected_by_user_id_users_id_fk" FOREIGN KEY ("collected_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_tech_user_id_users_id_fk" FOREIGN KEY ("tech_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_location_id_stock_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."stock_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_pricebook_item_id_pricebook_items_id_fk" FOREIGN KEY ("pricebook_item_id") REFERENCES "public"."pricebook_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_purchases" ADD CONSTRAINT "part_purchases_purchaser_user_id_users_id_fk" FOREIGN KEY ("purchaser_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_purchases" ADD CONSTRAINT "part_purchases_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_purchases" ADD CONSTRAINT "part_purchases_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_pricebook_item_id_pricebook_items_id_fk" FOREIGN KEY ("pricebook_item_id") REFERENCES "public"."pricebook_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_from_location_id_stock_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."stock_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_to_location_id_stock_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."stock_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_remittances" ADD CONSTRAINT "cash_remittances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_remittances" ADD CONSTRAINT "cash_remittances_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comp_plans" ADD CONSTRAINT "comp_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_earnings" ADD CONSTRAINT "job_earnings_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_earnings" ADD CONSTRAINT "job_earnings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_financials" ADD CONSTRAINT "job_financials_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_pay_period_id_pay_periods_id_fk" FOREIGN KEY ("pay_period_id") REFERENCES "public"."pay_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reverses_id_ledger_entries_id_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nacha_batches" ADD CONSTRAINT "nacha_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_settlements" ADD CONSTRAINT "payout_settlements_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_settlements" ADD CONSTRAINT "payout_settlements_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_flags" ADD CONSTRAINT "settlement_flags_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_flags" ADD CONSTRAINT "settlement_flags_ledger_entry_id_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_flags" ADD CONSTRAINT "settlement_flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_flags" ADD CONSTRAINT "settlement_flags_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_pay_period_id_pay_periods_id_fk" FOREIGN KEY ("pay_period_id") REFERENCES "public"."pay_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tech_comp" ADD CONSTRAINT "tech_comp_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tech_comp" ADD CONSTRAINT "tech_comp_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_logs" ADD CONSTRAINT "fuel_logs_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_logs" ADD CONSTRAINT "fuel_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odometer_readings" ADD CONSTRAINT "odometer_readings_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odometer_readings" ADD CONSTRAINT "odometer_readings_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_issues" ADD CONSTRAINT "vehicle_issues_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_issues" ADD CONSTRAINT "vehicle_issues_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_reminder_rules" ADD CONSTRAINT "vehicle_reminder_rules_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_assignments" ADD CONSTRAINT "tool_assignments_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_assignments" ADD CONSTRAINT "tool_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_assignments" ADD CONSTRAINT "tool_assignments_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_audit_items" ADD CONSTRAINT "tool_audit_items_audit_id_tool_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."tool_audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_audit_items" ADD CONSTRAINT "tool_audit_items_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_audits" ADD CONSTRAINT "tool_audits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_incidents" ADD CONSTRAINT "tool_incidents_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_incidents" ADD CONSTRAINT "tool_incidents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_maintenance_logs" ADD CONSTRAINT "tool_maintenance_logs_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_maintenance_logs" ADD CONSTRAINT "tool_maintenance_logs_performed_by_user_id_users_id_fk" FOREIGN KEY ("performed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tools" ADD CONSTRAINT "tools_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tools" ADD CONSTRAINT "tools_current_user_id_users_id_fk" FOREIGN KEY ("current_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tech_locations" ADD CONSTRAINT "tech_locations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entity_tags_entity_idx" ON "entity_tags" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "login_attempts_email_idx" ON "login_attempts" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "login_attempts_ip_idx" ON "login_attempts" USING btree ("ip","created_at");--> statement-breakpoint
CREATE INDEX "pricebook_name_idx" ON "pricebook_items" USING btree (lower("name") text_pattern_ops);--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id") WHERE "sessions"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "tags_name_uq" ON "tags" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "time_entries_user_idx" ON "time_entries" USING btree ("user_id","clock_in_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role") WHERE "users"."status" = 'active';--> statement-breakpoint
CREATE INDEX "consent_customer_idx" ON "consent_events" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "customers_phone_idx" ON "customers" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "customers_phone_alt_idx" ON "customers" USING btree ("phone_alt");--> statement-breakpoint
CREATE INDEX "customers_email_idx" ON "customers" USING btree ("email");--> statement-breakpoint
CREATE INDEX "customers_name_idx" ON "customers" USING btree (lower("display_name") text_pattern_ops);--> statement-breakpoint
CREATE INDEX "customers_fp_idx" ON "customers" USING gin ("card_fingerprints");--> statement-breakpoint
CREATE INDEX "lead_events_lead_idx" ON "lead_events" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_source_ext_uq" ON "leads" USING btree ("lead_source_id","external_id") WHERE "leads"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "leads_dedupe_idx" ON "leads" USING btree ("dedupe_hash","created_at");--> statement-breakpoint
CREATE INDEX "leads_phone_idx" ON "leads" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "properties_customer_idx" ON "properties" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "properties_addr_idx" ON "properties" USING btree ("zip",lower("street"));--> statement-breakpoint
CREATE INDEX "job_assignments_user_idx" ON "job_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "job_status_events_job_idx" ON "job_status_events" USING btree ("job_id","at");--> statement-breakpoint
CREATE INDEX "jobs_sched_idx" ON "jobs" USING btree ("scheduled_start") WHERE "jobs"."status" not in ('cancelled','closed');--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status","scheduled_start");--> statement-breakpoint
CREATE INDEX "jobs_customer_idx" ON "jobs" USING btree ("customer_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "jobs_completed_idx" ON "jobs" USING btree ("completed_at");--> statement-breakpoint
CREATE INDEX "jobs_callback_idx" ON "jobs" USING btree ("callback_of_job_id");--> statement-breakpoint
CREATE INDEX "notes_entity_idx" ON "notes" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "estimates_status_idx" ON "estimates" USING btree ("status","sent_at");--> statement-breakpoint
CREATE INDEX "estimates_customer_idx" ON "estimates" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "invoices_customer_idx" ON "invoices" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "line_items_parent_idx" ON "line_items" USING btree ("parent_type","parent_id");--> statement-breakpoint
CREATE INDEX "signatures_doc_idx" ON "signatures" USING btree ("doc_type","doc_id");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payments_job_idx" ON "payments" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "payments_success_idx" ON "payments" USING btree ("succeeded_at") WHERE "payments"."status" = 'succeeded';--> statement-breakpoint
CREATE INDEX "payments_collected_idx" ON "payments" USING btree ("collected_by_user_id","method");--> statement-breakpoint
CREATE INDEX "payments_fp_idx" ON "payments" USING btree ("card_fingerprint");--> statement-breakpoint
CREATE INDEX "risk_job_idx" ON "risk_assessments" USING btree ("job_id","computed_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "media_job_idx" ON "media" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE INDEX "media_entity_idx" ON "media" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "events_unprocessed_idx" ON "events" USING btree ("id") WHERE "events"."processed_at" is null;--> statement-breakpoint
CREATE INDEX "messages_customer_idx" ON "messages" USING btree ("customer_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "messages_provider_idx" ON "messages" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS FIRST) WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE INDEX "portal_log_token_idx" ON "portal_access_log" USING btree ("token_id","created_at");--> statement-breakpoint
CREATE INDEX "reminders_due_idx" ON "reminders" USING btree ("next_at") WHERE "reminders"."active";--> statement-breakpoint
CREATE INDEX "sched_due_idx" ON "scheduled_messages" USING btree ("send_at") WHERE "scheduled_messages"."status" in ('scheduled','deferred_quiet');--> statement-breakpoint
CREATE INDEX "sched_outbox_idx" ON "scheduled_messages" USING btree ("assigned_user_id","status") WHERE "scheduled_messages"."status" = 'pending_tap';--> statement-breakpoint
CREATE INDEX "sched_entity_idx" ON "scheduled_messages" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "part_purchases_status_idx" ON "part_purchases" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "part_purchases_job_idx" ON "part_purchases" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "ledger_user_period_idx" ON "ledger_entries" USING btree ("user_id","pay_period_id");--> statement-breakpoint
CREATE INDEX "ledger_unsettled_idx" ON "ledger_entries" USING btree ("user_id") WHERE "ledger_entries"."settlement_id" is null;--> statement-breakpoint
CREATE INDEX "ledger_job_idx" ON "ledger_entries" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "tech_comp_user_idx" ON "tech_comp" USING btree ("user_id","effective_from" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "odometer_vehicle_idx" ON "odometer_readings" USING btree ("vehicle_id","recorded_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "tool_assign_tool_idx" ON "tool_assignments" USING btree ("tool_id","checked_out_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "tool_maint_tool_idx" ON "tool_maintenance_logs" USING btree ("tool_id","performed_on" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "tools_current_user_idx" ON "tools" USING btree ("current_user_id");--> statement-breakpoint
CREATE INDEX "activity_customer_idx" ON "activity" USING btree ("customer_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "activity_job_idx" ON "activity" USING btree ("job_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "activity_entity_idx" ON "activity" USING btree ("entity_type","entity_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "approvals_pending_idx" ON "approvals" USING btree ("entity_type","created_at") WHERE "approvals"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_log" USING btree ("actor_user_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "job_queue_due_idx" ON "job_queue" USING btree ("run_at") WHERE "job_queue"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "breadcrumbs_user_idx" ON "location_breadcrumbs" USING btree ("user_id","recorded_at");--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "tasks" USING btree ("assignee_user_id","due_at") WHERE "tasks"."status" = 'open';--> statement-breakpoint
CREATE INDEX "tasks_entity_idx" ON "tasks" USING btree ("entity_type","entity_id");