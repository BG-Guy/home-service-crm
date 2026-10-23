import "server-only";
import { eq, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { POLICY_KINDS } from "@/db/enums";
import {
  automations,
  compPlans,
  counters,
  depositRules,
  messageTemplates,
  mileageRates,
  policyVersions,
  rolePermissions,
  roles,
  serviceTypes,
  taxRates,
} from "@/db/schema";
import {
  builtinAutomations,
  builtinTemplates,
} from "@/features/automations/builtin";
import {
  KIND_COLOR,
  KIND_DEFAULTS,
  KIND_ICON,
  KIND_LABEL,
} from "@/features/jobs/kinds";
import { modules } from "@/features/registry";
import { DEFAULT_PREFIXES } from "@/lib/counters";
import { sha256Hex } from "@/lib/hash";
import { ALL_PERMS, DEFAULT_GRANTS } from "@/lib/permissions";
import { seedId } from "./demo-ids";
import { POLICIES_V1 } from "./policies-v1";

// Base seed (SPEC §15.3; BUILD_PLAN §10.1 step 2). Idempotent: every insert is
// ON CONFLICT DO NOTHING with deterministic ids, so admin edits survive and the boot
// hook can run on every process start. Never emits events. Exception: built-in
// templates and automations upsert to the shipped catalog while no person has edited
// them (updated_by null); see below.

const UNTOUCHED_T = `case when "message_templates"."updated_by" is null`;

export const PARTNER_25_CONFIG = {
  basis: "net_after_deductions",
  rate_bps: 2500,
  overrides: { by_service_type: {} },
  deductions_before_split: {
    company_parts: true,
    tech_parts: true,
    processing_fees: "actual",
    lead_cost: false,
    subcontract_cost: false,
  },
  fee_methods: ["card", "ach", "venmo"],
  tips: { pct_to_tech_bps: 10000, deduct_card_fee_on_tip: false },
  tech_parts_reimburse_bps: 10000,
  cash: {
    tech_keeps_cash: true,
    settlement: "net_in_payout",
    max_cash_held_cents: 150000,
    remit_within_days: 3,
    methods: ["cash"],
  },
  deposits: {
    counts_toward_revenue: true,
    forfeited_deposit_commission_bps: 0,
  },
  recalls: { window_days: 30, policy: "no_commission_on_recall" },
  chargebacks: {
    window_days: 120,
    on_open: "hold",
    on_lost: "clawback_100",
    dispute_fee_to_tech: false,
  },
  spiffs: [],
  splits: { default: "primary_100" },
  earned_on: "paid_in_full",
  negative_balance: "carry_forward",
  w2_floor_check: false,
  min_wage_cents_per_hour: 725,
} as const;

/**
 * The three job types (leads-flow redesign, item 6): each kind's own row, the card a
 * booking starts from; the trade's jobs (demo profiles, or added in Settings → Job
 * types) sit under them. The keys are the pre-redesign ones on purpose: seed ids stay
 * the same, so a database migrated by drizzle/0006 (which renamed these rows in
 * place) matches a fresh one and this idempotent seed never inserts a duplicate.
 * "repair" and "maintenance" are retired (`RETIRED_SERVICE_TYPE_KEYS`): 0006 set them
 * inactive on old databases and fresh ones never get them.
 */
export const GENERIC_SERVICE_TYPES = [
  {
    key: "estimate_visit",
    kind: "estimate",
    name: KIND_LABEL.estimate,
    color: KIND_COLOR.estimate,
    icon: KIND_ICON.estimate,
    duration: KIND_DEFAULTS.estimate.durationMin,
    contractKind: KIND_DEFAULTS.estimate.contractKind,
    sort: 0,
    aliases: ["estimate", "free estimate", "quote", "bid"],
  },
  {
    key: "service_call",
    kind: "service",
    name: KIND_LABEL.service,
    color: KIND_COLOR.service,
    icon: KIND_ICON.service,
    duration: KIND_DEFAULTS.service.durationMin,
    contractKind: KIND_DEFAULTS.service.contractKind,
    sort: 1,
    aliases: ["service call", "diagnostic", "inspection", "repair", "fix"],
  },
  {
    key: "installation",
    kind: "project",
    name: KIND_LABEL.project,
    color: KIND_COLOR.project,
    icon: KIND_ICON.project,
    duration: KIND_DEFAULTS.project.durationMin,
    contractKind: KIND_DEFAULTS.project.contractKind,
    sort: 2,
    aliases: ["project", "install", "installation", "replace", "replacement"],
  },
] as const;

/** Generic types retired by the redesign (inactive on migrated databases only). */
export const RETIRED_SERVICE_TYPE_KEYS = ["repair", "maintenance"] as const;

export async function seedBase(db: DB): Promise<void> {
  // Roles + default grants (explicit grid rows; the resolver also falls back to code defaults).
  await db
    .insert(roles)
    .values([
      { key: "admin", name: "Admin", baseRole: "admin", builtin: true },
      { key: "office", name: "Office", baseRole: "office", builtin: true },
      { key: "tech", name: "Technician", baseRole: "tech", builtin: true },
    ])
    .onConflictDoNothing();
  const grid = (["admin", "office", "tech"] as const).flatMap((role) =>
    ALL_PERMS.map((perm) => ({
      role,
      perm,
      granted: DEFAULT_GRANTS[role].has(perm),
    })),
  );
  await db.insert(rolePermissions).values(grid).onConflictDoNothing();

  // Gapless counters.
  await db
    .insert(counters)
    .values(
      Object.entries(DEFAULT_PREFIXES).map(([key, prefix]) => ({
        key,
        prefix,
        nextValue: 1001,
      })),
    )
    .onConflictDoNothing();

  // Policies v1.
  await db
    .insert(policyVersions)
    .values(
      POLICY_KINDS.map((kind) => {
        const p = POLICIES_V1[kind];
        return {
          id: seedId("policy", kind),
          kind,
          version: 1,
          title: p.title,
          body: p.body,
          sha256: sha256Hex(`${p.title}\n\n${p.body}`),
        };
      }),
    )
    .onConflictDoNothing();

  // Templates + automations: B5's builtin catalog plus any manifest-declared seeds.
  const templates = [
    ...builtinTemplates,
    ...modules.flatMap((m) => m.templates ?? []),
  ];
  if (templates.length) {
    await db
      .insert(messageTemplates)
      .values(
        templates.map((t) => ({
          key: t.key,
          channel: t.channel,
          locale: t.locale ?? "en",
          purpose: t.purpose,
          subject: t.subject ?? null,
          body: t.body,
          defaultBody: t.body,
          expiresAfterMinutes: t.expiresAfterMinutes ?? null,
          allowOutsideQuietHours: t.allowOutsideQuietHours ?? false,
          builtin: true,
        })),
      )
      // Built-ins track the shipped catalog (QA round 2): `default_body` and
      // `purpose` always follow it ("Reset" restores the newest text); the editable
      // fields follow it only while no person has edited the row (updated_by null).
      // No-op when nothing changed, so it is safe on every boot.
      .onConflictDoUpdate({
        target: [
          messageTemplates.key,
          messageTemplates.channel,
          messageTemplates.locale,
        ],
        set: {
          defaultBody: sql.raw("excluded.default_body"),
          purpose: sql.raw("excluded.purpose"),
          body: sql.raw(
            `${UNTOUCHED_T} then excluded.body else "message_templates"."body" end`,
          ),
          subject: sql.raw(
            `${UNTOUCHED_T} then excluded.subject else "message_templates"."subject" end`,
          ),
          expiresAfterMinutes: sql.raw(
            `${UNTOUCHED_T} then excluded.expires_after_minutes else "message_templates"."expires_after_minutes" end`,
          ),
          allowOutsideQuietHours: sql.raw(
            `${UNTOUCHED_T} then excluded.allow_outside_quiet_hours else "message_templates"."allow_outside_quiet_hours" end`,
          ),
          updatedAt: sql.raw("now()"),
        },
        setWhere: sql.raw(`"message_templates"."builtin" and (
          "message_templates"."default_body" is distinct from excluded.default_body
          or "message_templates"."purpose" is distinct from excluded.purpose
          or ("message_templates"."updated_by" is null and (
            "message_templates"."body" is distinct from excluded.body
            or "message_templates"."subject" is distinct from excluded.subject
            or "message_templates"."expires_after_minutes" is distinct from excluded.expires_after_minutes
            or "message_templates"."allow_outside_quiet_hours" is distinct from excluded.allow_outside_quiet_hours)))`),
      });
  }
  const autos = [
    ...builtinAutomations,
    ...modules.flatMap((m) => m.automations ?? []),
  ];
  if (autos.length) {
    await db
      .insert(automations)
      .values(
        autos.map((a) => ({
          key: a.key,
          name: a.name,
          description: a.description ?? null,
          triggerEvent: a.triggerEvent,
          conditions: a.conditions ?? {},
          steps: a.steps,
          cancelOn: a.cancelOn ?? [],
          featureFlag: a.featureFlag ?? null,
          enabled: a.enabled ?? true,
          builtin: true,
        })),
      )
      // Built-in automations no person has edited or toggled (updated_by null) follow
      // the shipped definition (QA round 2: B5 fixed triggers, cancel rules and
      // steps). Edited rows are left alone. No-op when nothing changed.
      .onConflictDoUpdate({
        target: automations.key,
        set: {
          name: sql.raw("excluded.name"),
          description: sql.raw("excluded.description"),
          triggerEvent: sql.raw("excluded.trigger_event"),
          conditions: sql.raw("excluded.conditions"),
          steps: sql.raw("excluded.steps"),
          cancelOn: sql.raw("excluded.cancel_on"),
          featureFlag: sql.raw("excluded.feature_flag"),
          enabled: sql.raw("excluded.enabled"),
          updatedAt: sql.raw("now()"),
        },
        setWhere:
          sql.raw(`"automations"."builtin" and "automations"."updated_by" is null and (
          "automations"."name" is distinct from excluded.name
          or "automations"."description" is distinct from excluded.description
          or "automations"."trigger_event" is distinct from excluded.trigger_event
          or "automations"."conditions" is distinct from excluded.conditions
          or "automations"."steps" is distinct from excluded.steps
          or "automations"."cancel_on" is distinct from excluded.cancel_on
          or "automations"."feature_flag" is distinct from excluded.feature_flag
          or "automations"."enabled" is distinct from excluded.enabled)`),
      });
  }

  // Default comp plan (§10.1 "partner_25" v1).
  await db
    .insert(compPlans)
    .values({
      id: seedId("comp_plan", "partner_25:1"),
      planKey: "partner_25",
      name: "Partner 25% after parts & card fee",
      version: 1,
      effectiveFrom: "2026-01-01",
      config: PARTNER_25_CONFIG as unknown as Record<string, unknown>,
    })
    .onConflictDoNothing();

  // IRS mileage rate 2026 (72.5¢; ⚠ verify mid-year changes in Settings).
  await db
    .insert(mileageRates)
    .values({
      id: seedId("mileage_rate", "2026"),
      effectiveFrom: "2026-01-01",
      millicentsPerMile: 72500,
      source: "IRS 2026 standard rate",
    })
    .onConflictDoNothing();

  // The three job types (trade presets and demo profiles add their jobs; §15.3).
  await db
    .insert(serviceTypes)
    .values(
      GENERIC_SERVICE_TYPES.map((s) => ({
        id: seedId("service_type", s.key),
        name: s.name,
        kind: s.kind,
        color: s.color,
        icon: s.icon,
        aliases: [...s.aliases],
        defaultDurationMin: s.duration,
        contractKind: s.contractKind,
        sort: s.sort,
      })),
    )
    .onConflictDoNothing();

  // Default deposit rules: special-order parts → parts + 10 %; risk ≥ High → 25 %.
  const depositPolicyId = seedId("policy", "deposit");
  await db
    .insert(depositRules)
    .values([
      {
        id: seedId("deposit_rule", "special_order"),
        name: "Special-order parts",
        priority: 10,
        trigger: { type: "has_special_order_parts" },
        amount: { type: "parts_plus_percent", value: 10, round_to_cents: 500 },
        mode: "capture",
        policyVersionId: depositPolicyId,
      },
      {
        id: seedId("deposit_rule", "high_risk"),
        name: "High-risk jobs",
        priority: 20,
        trigger: { type: "risk_band_gte", value: "high" },
        amount: { type: "percent_total", value: 25, round_to_cents: 500 },
        mode: "capture",
        policyVersionId: depositPolicyId,
      },
    ])
    .onConflictDoNothing();

  // Tax placeholder (owner sets the real rate in Settings → Taxes).
  const existingDefault = await db
    .select({ id: taxRates.id })
    .from(taxRates)
    .where(eq(taxRates.isDefault, true))
    .limit(1);
  if (existingDefault.length === 0) {
    await db
      .insert(taxRates)
      .values({
        id: seedId("tax_rate", "default"),
        name: "Sales tax (set your rate)",
        rateBps: 0,
        isDefault: true,
      })
      .onConflictDoNothing();
  }
}
