import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ToolSettingsForm } from "@/features/tools/components/ToolSettingsForm";
import { requireUser } from "@/lib/auth/current";
import { findCompany, getSettings, isEnabled } from "@/lib/settings";
import { Page } from "@/ui/components/AppShell";
import { NavBar } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Tools" };

const DEFAULT_AGREEMENT =
  "I received the company tools listed in my custody. I'll use them for company work, keep them secure, report loss, theft or damage right away, and return them when asked or when I leave.";

export default async function SettingsToolsPage() {
  await requireUser("settings.manage");
  if (!(await isEnabled("tools"))) notFound();
  const [settings, company] = await Promise.all([getSettings(), findCompany()]);
  const t = settings.tools;
  const state = company?.state?.toUpperCase() ?? null;
  const blocked =
    state && settings.compliance.wage_deduction_blocked_states.includes(state)
      ? state
      : null;
  return (
    <PageTransition>
      <NavBar title="Tools" back={{ href: "/settings", label: "Settings" }} />
      <Page className="pt-4">
        <ToolSettingsForm
          initial={{
            audit_frequency_days: t.audit_frequency_days,
            deductions_enabled: t.deductions_enabled,
            agreement_text: t.agreement_text,
            block_on_calibration_overdue: t.block_on_calibration_overdue,
            require_handoff_photo: t.require_handoff_photo,
            maintenance_warning_days: t.maintenance_warning_days,
            maintenance_interval_days_by_category:
              t.maintenance_interval_days_by_category,
          }}
          defaultAgreement={DEFAULT_AGREEMENT}
          w2Blocked={blocked}
        />
      </Page>
    </PageTransition>
  );
}
