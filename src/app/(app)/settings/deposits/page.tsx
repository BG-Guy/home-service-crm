import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import { hasCardProcessor } from "@/adapters/payments";
import { db } from "@/db";
import { leadSources } from "@/db/schema";
import {
  DepositPolicyForm,
  DepositRulesEditor,
  DepositSettingsForm,
  type RuleView,
} from "@/features/payments/components/DepositSettings";
import { SettingsShell } from "@/features/payments/components/SettingsShell";
import { DEFAULT_MANUAL_INSTRUCTIONS } from "@/features/payments/defaults";
import { getDepositRulesForSettings } from "@/features/payments/queries";
import { listServiceTypes } from "@/features/settings/api";
import { requireUser } from "@/lib/auth/current";
import { getCurrentPolicy } from "@/lib/policies";
import { getCompanyTimezone, getSettings, isEnabled } from "@/lib/settings";
import { formatDate } from "@/lib/time";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { ListRow, ListSection } from "@/ui/components/List";

export const metadata: Metadata = { title: "Deposits" };

// Settings → Deposits (SPEC M09): rules engine (priority, first match), amounts with
// min/max and rounding, collection modes (fall back to manual without a processor),
// refund / restocking / special-order policy and the versioned deposit policy text.
export default async function SettingsDepositsPage() {
  await requireUser("settings.manage");
  const [on, rules, types, sources, s, policy, tz] = await Promise.all([
    isEnabled("deposits"),
    getDepositRulesForSettings(),
    listServiceTypes(),
    db
      .select({ id: leadSources.id, name: leadSources.name })
      .from(leadSources)
      .orderBy(asc(leadSources.name)),
    getSettings(),
    getCurrentPolicy("deposit"),
    getCompanyTimezone(),
  ]);
  const processor = hasCardProcessor();
  const intro =
    "Ask for deposits automatically on the jobs that need them: big tickets, special-order parts, after-hours calls or risky jobs.";
  // T3-21: a disabled module shows its off state, not live rules nobody uses.
  if (!on)
    return (
      <SettingsShell title="Deposits" intro={intro}>
        <ListSection footer="Deposits are off, so no job asks for one. Turn them on in Features to set up deposit rules and the deposit policy.">
          <ListRow title="Turn on in Features" href="/settings/features" />
        </ListSection>
      </SettingsShell>
    );
  const placeholderPayText =
    !processor &&
    s.payments.manual_instructions.trim() === DEFAULT_MANUAL_INSTRUCTIONS;
  return (
    <SettingsShell title="Deposits" intro={intro}>
      {!processor && (
        <Banner tone="info" title="No card processor">
          Card, hold and card-on-file rules fall back to cash, check or Zelle
          deposits recorded by your team. Nothing breaks without Stripe.
        </Banner>
      )}
      {placeholderPayText && (
        <Banner
          tone="warning"
          title="Deposit links show placeholder pay instructions"
          action={
            <Button href="/settings/payments" size="sm" variant="tinted">
              Edit pay instructions
            </Button>
          }
        >
          Customers see “How to pay” on every deposit link. Add your Zelle or
          Venmo handle and who checks are payable to.
        </Banner>
      )}
      {s.compliance.deposit_cap_warnings && (
        <Banner tone="legal" title="State deposit caps">
          For home-improvement work some states cap deposits (CA: the lesser of
          $1,000 or 10%; MD: one third; MA: one third or special-order cost over
          $1,000). You'll see a warning on deposits that go over.
        </Banner>
      )}
      <DepositRulesEditor
        rules={rules as unknown as RuleView[]}
        serviceTypes={types.map((t) => ({ id: t.id, name: t.name }))}
        leadSources={sources}
        processor={processor}
      />
      <DepositSettingsForm
        initial={{
          hold_max_days_out: s.deposits.hold_max_days_out,
          round_to_cents: s.deposits.round_to_cents,
          refundable_until_hours: s.deposits.refundable_until_hours,
          restocking_pct: s.deposits.restocking_pct,
          nonrefundable_after_po: s.deposits.nonrefundable_after_po,
          due_hours: s.deposits.due_hours,
        }}
      />
      <DepositPolicyForm
        current={
          policy
            ? {
                title: policy.title,
                body: policy.body,
                version: policy.version,
                at: formatDate(policy.effectiveFrom, tz),
              }
            : null
        }
      />
    </SettingsShell>
  );
}
