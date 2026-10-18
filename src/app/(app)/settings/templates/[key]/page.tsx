import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TemplateEditor } from "@/features/automations/components/TemplateEditor";
import { getTemplateEditor } from "@/features/automations/queries";
import { PushedScreen } from "@/features/messaging/components/PushedScreen";
import { templateLabel } from "@/features/messaging/labels";
import { requireUser } from "@/lib/auth/current";
import { NotFoundError } from "@/lib/errors";

export const metadata: Metadata = { title: "Edit template" };

// One template key (SPEC M13): per channel, variable picker, live preview with a real
// job, GSM-7 lint + segments, link and review-incentive linters, reset to default.
export default async function TemplateEditPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const user = await requireUser("templates.manage");
  const key = decodeURIComponent((await params).key);
  let rows: Awaited<ReturnType<typeof getTemplateEditor>>;
  try {
    rows = await getTemplateEditor(key);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  return (
    <PushedScreen
      title={templateLabel(key)}
      back={{ href: "/settings/templates", label: "Templates" }}
      intro={<span className="font-mono">{key}</span>}
    >
      <TemplateEditor rows={rows} isAdmin={user.baseRole === "admin"} />
    </PushedScreen>
  );
}
