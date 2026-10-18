import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AutomationEditor } from "@/features/automations/components/AutomationEditor";
import { getAutomationEditor } from "@/features/automations/queries";
import { PushedScreen } from "@/features/messaging/components/PushedScreen";
import { requireUser } from "@/lib/auth/current";
import { NotFoundError } from "@/lib/errors";

export const metadata: Metadata = { title: "Edit automation" };

// One automation (SPEC M13): form editor (trigger, conditions, steps, cancel-on),
// raw JSON for admins, "Send test to me" and "Preview with a real job".
export default async function AutomationEditPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  await requireUser("automations.manage");
  const { key } = await params;
  let data: Awaited<ReturnType<typeof getAutomationEditor>>;
  try {
    data = await getAutomationEditor(key);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  return (
    <PushedScreen
      title={data.automation.name}
      back={{ href: "/settings/automations", label: "Automations" }}
      intro={data.automation.description ?? undefined}
    >
      <AutomationEditor
        automation={data.automation}
        templates={data.templates}
        perms={data.perms}
        roles={data.roles}
        isAdmin={data.isAdmin}
      />
    </PushedScreen>
  );
}
