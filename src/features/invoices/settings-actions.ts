"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";
import { execRows } from "@/db";
import { action, zf } from "@/lib/action";
import { ValidationError } from "@/lib/errors";
import { publishPolicyVersion } from "@/lib/policies";
import { updateSettings } from "@/lib/settings";

// Settings → Invoices & estimates (BUILD_PLAN §3.4): the `estimates`, `invoices` and
// `portal` namespaces, `limits.max_discount_pct` (edited here by plan), the B3
// counters (prefix + next number) and the document policies shown on estimates and
// invoices (warranty, e-sign consent, cooling-off). All admin-only, audited.

const pct = z.coerce.number().min(0).max(100);

export const saveDocumentSettings = action({
  perm: "settings.manage",
  input: z.object({
    invoices: z.object({
      auto_issue_on_complete: zf.checkbox(),
      photos_on_invoice: zf.checkbox(),
      photos_on_receipt: zf.checkbox(),
      residential_terms: z.enum(["due_on_receipt", "net_15", "net_30"]),
      commercial_terms: z.enum(["due_on_receipt", "net_15", "net_30"]),
      footer: z.string().trim().max(500).default(""),
      late_fee: z.object({
        enabled: zf.checkbox(),
        pct: z.coerce.number().min(0).max(25).default(0),
      }),
    }),
    estimates: z.object({
      expiry_days: z.coerce.number().int().min(1).max(365),
      change_order_threshold_pct: pct,
      change_order_threshold_dollars: z.coerce.number().min(0).max(1_000_000),
      option_labels: zf.array(z.string().trim().max(24)),
    }),
    portal: z.object({
      show_tech_photo: zf.checkbox(),
      allow_reschedule_request: zf.checkbox(),
    }),
    discount: z.object({ admin: pct, office: pct, tech: pct }),
  }),
  audit: "settings.invoices_updated",
  async run({ input, tx, actor }) {
    // Labels are by position (an estimate has 1–3 options): a blank one gets its
    // default name ("Option 2"), so a later label never shifts into its slot.
    const labels = [0, 1, 2].map(
      (i) => input.estimates.option_labels[i]?.trim() || `Option ${i + 1}`,
    );
    await updateSettings(
      tx,
      {
        invoices: {
          auto_issue_on_complete: input.invoices.auto_issue_on_complete,
          photos_on_invoice: input.invoices.photos_on_invoice,
          photos_on_receipt: input.invoices.photos_on_receipt,
          residential_terms: input.invoices.residential_terms,
          commercial_terms: input.invoices.commercial_terms,
          footer: input.invoices.footer,
          late_fee: {
            enabled: input.invoices.late_fee.enabled,
            pct_bps: Math.round(input.invoices.late_fee.pct * 100),
          },
        },
        estimates: {
          expiry_days: input.estimates.expiry_days,
          change_order_threshold_pct:
            input.estimates.change_order_threshold_pct,
          change_order_threshold_cents: Math.round(
            input.estimates.change_order_threshold_dollars * 100,
          ),
          option_labels: labels,
        },
        portal: input.portal,
        limits: { max_discount_pct: input.discount },
      },
      actor,
    );
    return { ok: true };
  },
  revalidate: () => ["/settings/invoices"],
});

const COUNTER_KEYS = [
  "invoice",
  "estimate",
  "change_order",
  "credit_note",
] as const;

const counterField = z.object({
  prefix: z
    .string()
    .trim()
    .max(8)
    .regex(/^[A-Za-z0-9-]*$/, "Letters, digits and dashes only."),
  next: z.coerce.number().int().min(1).max(999_999_999),
});

export const saveCounters = action({
  perm: "settings.manage",
  input: z.object({
    counters: z.object({
      invoice: counterField,
      estimate: counterField,
      change_order: counterField,
      credit_note: counterField,
    }),
  }),
  audit: "settings.counters_updated",
  async run({ input, tx }) {
    const current = await execRows<{ key: string; next_value: number }>(
      sql`select key, next_value::int as next_value from counters where key in ('invoice','estimate','change_order','credit_note') for update`,
      tx,
    );
    const now = new Map(current.map((c) => [c.key, Number(c.next_value)]));
    const errors: Record<string, string[]> = {};
    for (const k of COUNTER_KEYS) {
      const want = input.counters[k];
      const cur = now.get(k) ?? 1001;
      // Never reuse a number: the next value can only move forward.
      if (want.next < cur)
        errors[`counters.${k}.next`] = [
          `Can't go below ${cur} (numbers already used).`,
        ];
    }
    if (Object.keys(errors).length) throw new ValidationError(errors);
    for (const k of COUNTER_KEYS) {
      const want = input.counters[k];
      await execRows(
        sql`insert into counters (key, prefix, next_value) values (${k}, ${want.prefix}, ${want.next})
            on conflict (key) do update set prefix = excluded.prefix, next_value = excluded.next_value`,
        tx,
      );
    }
    return { ok: true };
  },
  revalidate: () => ["/settings/invoices"],
});

export const publishDocumentPolicy = action({
  perm: "settings.manage",
  input: z.object({
    kind: z.enum(["warranty", "esign_consent", "cooling_off"]),
    title: z.string().trim().min(1, "Enter a title.").max(120),
    body: z.string().trim().min(10, "Enter the policy text.").max(20_000),
  }),
  audit: "policy.published",
  async run({ input, tx, actor }) {
    const row = await publishPolicyVersion(tx, input, actor);
    return { version: row.version };
  },
  revalidate: () => ["/settings/invoices"],
});
