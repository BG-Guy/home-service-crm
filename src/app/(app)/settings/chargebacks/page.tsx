import type { Metadata } from "next";
import { ChargebackSettingsForm } from "@/features/disputes/components/ChargebackSettingsForm";
import {
  READINESS_DEFAULT_WEIGHTS,
  READINESS_KEYS,
  READINESS_LABELS,
} from "@/features/disputes/readiness";
import {
  RISK_DEFAULT_WEIGHTS,
  RISK_SIGNAL_KEYS,
  RISK_SIGNAL_LABELS,
} from "@/features/disputes/risk";
import { SettingsShell } from "@/features/payments/components/SettingsShell";
import { requireUser } from "@/lib/auth/current";
import { getSettings, isEnabled } from "@/lib/settings";
import { ListRow, ListSection } from "@/ui/components/List";

export const metadata: Metadata = { title: "Chargeback protection" };

// Settings → Chargeback protection (SPEC §11, M10, M11): risk weights and bands, band
// controls and the Critical option, readiness weights, dispute suggestions (Accept,
// EFW refund multiplier), the dispute-rate line, and photo-evidence media settings.
export default async function SettingsChargebacksPage() {
  await requireUser("settings.manage");
  const [s, on] = await Promise.all([
    getSettings(),
    isEnabled("chargeback_protection"),
  ]);
  return (
    <SettingsShell
      title="Chargeback protection"
      intro="Score each job's dispute risk before work starts, require the right evidence, and keep every job dispute-ready."
    >
      {!on && (
        <ListSection footer="Chargeback protection is off: risk chips, readiness rings, controls and the disputes inbox are hidden. Turn it on to set risk weights, band controls and readiness.">
          <ListRow title="Turn it on in Features" href="/settings/features" />
        </ListSection>
      )}
      <ChargebackSettingsForm
        mediaOnly={!on}
        initial={{
          risk: {
            weights: s.risk.weights,
            bands: s.risk.bands,
            no_estimate_min_ticket_cents: s.risk.no_estimate_min_ticket_cents,
            critical_control: s.risk.critical_control,
            enforce_controls: s.risk.enforce_controls,
          },
          disputes: {
            efw_refund_multiplier: s.disputes.efw_refund_multiplier,
            dispute_fee_cents: s.disputes.dispute_fee_cents,
            suggest_accept_under_cents: s.disputes.suggest_accept_under_cents,
            suggest_accept_readiness_below:
              s.disputes.suggest_accept_readiness_below,
            readiness_weights: s.disputes.readiness_weights,
            rate_threshold_bps: s.disputes.rate_threshold_bps,
          },
          media: {
            keep_originals: s.media.keep_originals,
            keep_originals_tags: s.media.keep_originals_tags,
            max_upload_mb: s.media.max_upload_mb,
            far_from_site_m: s.media.far_from_site_m,
          },
        }}
        riskSignals={RISK_SIGNAL_KEYS.map((k) => ({
          key: k,
          label: RISK_SIGNAL_LABELS[k],
          default: RISK_DEFAULT_WEIGHTS[k],
        }))}
        readinessItems={READINESS_KEYS.map((k) => ({
          key: k,
          label: READINESS_LABELS[k],
          default: READINESS_DEFAULT_WEIGHTS[k],
        }))}
      />
    </SettingsShell>
  );
}
