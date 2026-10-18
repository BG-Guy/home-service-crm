import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { aiProviderName } from "@/adapters/ai";
import { PartsSettingsForm } from "@/features/parts/components/PartsSettingsForm";
import { listUsers } from "@/features/team/api";
import { requireUser } from "@/lib/auth/current";
import { getSettings, isEnabled } from "@/lib/settings";
import { Page } from "@/ui/components/AppShell";
import { NavBar } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Parts & receipts" };

export default async function SettingsPartsPage() {
  await requireUser("settings.manage");
  if (!(await isEnabled("parts"))) notFound();
  const s = await getSettings();
  const people = await listUsers({ statuses: ["active"] });
  return (
    <PageTransition>
      <NavBar
        title="Parts & receipts"
        back={{ href: "/settings", label: "Settings" }}
      />
      <Page className="pt-4">
        <PartsSettingsForm
          inventoryOn={!!s.features.inventory}
          aiOn={aiProviderName() !== "none"}
          people={people
            .filter((p) => p.baseRole !== "tech")
            .map((p) => ({ id: p.id, name: p.name }))}
          initial={{
            receiptRequiredOverCents: s.parts.receipt_required_over_cents,
            autoApproveUnderCents: s.limits.auto_approve_under_cents,
            aiMatchToleranceCents: s.parts.ai_match_tolerance_cents,
            receiptMaxAgeDays: s.parts.receipt_max_age_days,
            staleReceiptDays: s.parts.stale_receipt_days,
            warrantyClaimDays: s.parts.warranty_claim_days,
            cycleCountDay: s.inventory.cycle_count_day,
            decrementOnUse: s.inventory.decrement_on_use,
            restockAssigneeUserId: s.inventory.restock_assignee_user_id,
          }}
        />
      </Page>
    </PageTransition>
  );
}
