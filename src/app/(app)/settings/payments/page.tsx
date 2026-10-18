import type { Metadata } from "next";
import { hasCardProcessor } from "@/adapters/payments";
import {
  PaymentSettingsForm,
  type PaymentSettingsValues,
} from "@/features/payments/components/PaymentSettingsForm";
import { SettingsShell } from "@/features/payments/components/SettingsShell";
import { companyState } from "@/features/payments/internal";
import { requireUser } from "@/lib/auth/current";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Payments" };

// Settings → Payments (SPEC M09, M21): accepted methods, reference rules, fee policy
// (absorb / cash discount / surcharge ⚖️), tips, keyed cards, descriptor, refund limits.
export default async function SettingsPaymentsPage() {
  await requireUser("settings.manage");
  const [s, state] = await Promise.all([getSettings(), companyState()]);
  const p = s.payments;
  const initial: PaymentSettingsValues = {
    methods: p.methods as PaymentSettingsValues["methods"],
    fee_policy: p.fee_policy,
    surcharge_bps: p.surcharge_bps,
    cash_discount_bps: p.cash_discount_bps,
    tips_enabled: p.tips_enabled,
    tip_presets_pct: p.tip_presets_pct,
    tip_on_fees: p.tip_on_fees,
    allow_keyed: p.allow_keyed,
    require_check_photo: p.require_check_photo,
    reference_required:
      p.reference_required as PaymentSettingsValues["reference_required"],
    statement_descriptor: p.statement_descriptor,
    descriptor_suffix: p.descriptor_suffix,
    pay_link_expires_minutes: p.pay_link_expires_minutes,
    unverified_alert_days: p.unverified_alert_days,
    manual_instructions: p.manual_instructions,
    promised_refund_days: p.promised_refund_days,
    fee_pct_by_method: p.fee_pct_by_method,
    max_refund_cents: s.limits.max_refund_cents,
  };
  return (
    <SettingsShell
      title="Payments"
      intro="How you get paid in the field and online, and the guard rails that keep payments clean."
    >
      <PaymentSettingsForm
        initial={initial}
        state={state}
        processor={hasCardProcessor()}
      />
    </SettingsShell>
  );
}
