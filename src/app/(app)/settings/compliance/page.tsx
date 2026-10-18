import type { Metadata } from "next";
import {
  ComplianceForm,
  MonitoringNoticeForm,
} from "@/features/settings/components/ComplianceForm";
import { SettingsScreen } from "@/features/settings/components/SettingsScreen";
import { requireUser } from "@/lib/auth/current";
import { getCurrentPolicy } from "@/lib/policies";
import { getCompany, getSettings } from "@/lib/settings";
import { formatDate } from "@/lib/time";

export const metadata: Metadata = { title: "Compliance profile" };

// Settings → Compliance profile ⚖️ (SPEC M21): state, contract/deposit/surcharge
// warnings, W-2 deduction restrictions, quiet hours, frequency caps, consent texts and
// the versioned monitoring notice. Warnings are never removed, only configured.
export default async function SettingsCompliancePage() {
  await requireUser("settings.manage");
  const [c, s, notice] = await Promise.all([
    getCompany(),
    getSettings(),
    getCurrentPolicy("monitoring_notice"),
  ]);
  const k = s.compliance;
  return (
    <SettingsScreen
      title="Compliance profile"
      intro="Safe defaults for texting, deposits, surcharges and tech pay in your state."
    >
      <div className="flex flex-col gap-[var(--section-gap)]">
        <ComplianceForm
          initial={{
            state: c.state ?? c.address?.state ?? "",
            contractTemplates: k.contract_templates,
            depositCapWarnings: k.deposit_cap_warnings,
            surchargeRestrictions: k.surcharge_restrictions,
            wageDeductionBlockedStates: k.wage_deduction_blocked_states,
            quietStart: k.quiet_hours.start,
            quietEnd: k.quiet_hours.end,
            automatedPer24h: k.frequency_caps.automated_per_24h,
            marketingPer7d: k.frequency_caps.marketing_per_7d,
            smsConsentText: k.sms_consent_text,
            marketingConsentText: k.marketing_consent_text,
          }}
        />
        <MonitoringNoticeForm
          current={
            notice
              ? {
                  version: notice.version,
                  title: notice.title,
                  body: notice.body,
                  at: formatDate(notice.effectiveFrom, c.timezone),
                }
              : null
          }
        />
      </div>
    </SettingsScreen>
  );
}
