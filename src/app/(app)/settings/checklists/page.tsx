import type { Metadata } from "next";
import { ChecklistsManager } from "@/features/settings/components/ChecklistsManager";
import { SettingsScreen } from "@/features/settings/components/SettingsScreen";
import { listChecklistTemplates } from "@/features/settings/queries";
import { requireUser } from "@/lib/auth/current";

export const metadata: Metadata = { title: "Checklists" };

// Settings → Checklists (SPEC M21): job checklist templates per service type.
export default async function SettingsChecklistsPage() {
  await requireUser("custom_fields.manage");
  const lists = await listChecklistTemplates();
  return (
    <SettingsScreen
      title="Checklists"
      intro="Step-by-step lists techs complete on the job: checks, readings, photos and signatures."
    >
      <ChecklistsManager lists={lists} />
    </SettingsScreen>
  );
}
