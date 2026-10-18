import type { Metadata } from "next";
import { AutomationList } from "@/features/automations/components/AutomationList";
import { listAutomations } from "@/features/automations/queries";
import { PushedScreen } from "@/features/messaging/components/PushedScreen";
import { requireUser } from "@/lib/auth/current";

export const metadata: Metadata = { title: "Automations" };

// Settings → Automations (SPEC M13): every built-in and custom automation with an
// on/off toggle; tap one to edit timing, audience, channel, message and conditions.
export default async function SettingsAutomationsPage() {
  await requireUser("automations.manage");
  const items = await listAutomations();
  return (
    <PushedScreen
      title="Automations"
      intro="Texts, emails and alerts that go out on their own when something happens."
    >
      <AutomationList items={items} />
    </PushedScreen>
  );
}
