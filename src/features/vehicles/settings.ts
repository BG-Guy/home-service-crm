// Settings fragment(s) owned by module `vehicles` (BUILD_PLAN §3.4). Merged into CompanySettings
// by src/features/registry.ts; defaults come from the zod defaults (parse of {}).
// The owner may ADD keys with defaults; never rename or remove keys.
import { z } from "zod";

const policy = (
  tech_can_log: boolean,
  approval: "auto" | "auto_if_evidence" | "always_review",
  ai_optional = false,
) =>
  z
    .object({
      tech_can_log: z.boolean().default(tech_can_log),
      approval: z
        .enum(["auto", "auto_if_evidence", "always_review"])
        .default(approval),
      ai_optional: z.boolean().default(ai_optional),
    })
    .prefault({});

export const settingsShape = {
  vehicles: z
    .object({
      policies: z
        .object({
          // Lead decision (QA T1-10): with AI off (the default) a normal reading
          // with a photo auto-approves; anomalies and an AI mismatch still force
          // review. Fuel/service stay in review without AI (money path).
          odometer: policy(true, "auto_if_evidence", true),
          fuel: policy(true, "auto_if_evidence"),
          service: policy(true, "always_review"),
          document: policy(true, "always_review"),
          inspection: policy(true, "auto"),
          trip: policy(true, "auto_if_evidence"),
        })
        .prefault({}),
      inspection_frequency: z
        .enum(["none", "daily", "weekly"])
        .default("weekly"),
      require_odometer_on_clock: z.boolean().default(false),
      max_daily_miles: z.number().int().default(600),
      /** Rules-first anomaly options (SPEC M17). */
      anomaly: z
        .object({
          weekend_fuel: z.boolean().default(true),
          mpg_drop_pct: z.number().int().min(5).max(90).default(20),
        })
        .prefault({}),
      /** Response-timer target for unacknowledged vehicle issues. */
      issue_ack_target_minutes: z.number().int().min(5).default(60),
      /** Days before expiry when document reminders fire. */
      document_warning_days: z.array(z.number().int()).default([30, 14, 3]),
      /** Reminder-rule seeds applied to new vehicles (SPEC M17). */
      reminder_seeds: z
        .array(
          z.object({
            task: z.string(),
            interval_miles: z.number().int().nullable(),
            interval_days: z.number().int().nullable(),
            due_soon_miles: z.number().int().nullable(),
            due_soon_days: z.number().int().nullable(),
          }),
        )
        .default([
          {
            task: "oil_change",
            interval_miles: 5000,
            interval_days: 182,
            due_soon_miles: 500,
            due_soon_days: 14,
          },
          {
            task: "tire_rotation",
            interval_miles: 7500,
            interval_days: null,
            due_soon_miles: 500,
            due_soon_days: null,
          },
          {
            task: "brake_inspection",
            interval_miles: 15000,
            interval_days: 365,
            due_soon_miles: 1000,
            due_soon_days: 30,
          },
          {
            task: "registration",
            interval_miles: null,
            interval_days: null,
            due_soon_miles: null,
            due_soon_days: 30,
          },
          {
            task: "insurance",
            interval_miles: null,
            interval_days: null,
            due_soon_miles: null,
            due_soon_days: 30,
          },
          {
            task: "inspection",
            interval_miles: null,
            interval_days: null,
            due_soon_miles: null,
            due_soon_days: 30,
          },
        ]),
    })
    .prefault({}),
} as const;
