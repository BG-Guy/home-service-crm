import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LeadForm } from "@/features/leads/components/LeadForm";
import { listActiveSources } from "@/features/leads/queries";
import { getCustomFieldDefs, listServiceTypes } from "@/features/settings/api";
import { requireUser } from "@/lib/auth/current";
import { getSettings, isEnabled } from "@/lib/settings";
import { Page } from "@/ui/components/AppShell";
import { NavBar } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "New lead" };

export default async function NewLeadPage() {
  const user = await requireUser("leads.create");
  if (!(await isEnabled("leads"))) notFound();
  const [sources, services, settings, customDefs] = await Promise.all([
    listActiveSources(),
    listServiceTypes().catch(() => []),
    getSettings(),
    getCustomFieldDefs("lead").catch(() => []),
  ]);
  const phoneSource = sources.find((s) => s.kind === "phone");
  return (
    <PageTransition>
      <NavBar
        title="New lead"
        back={
          user.perms.has("leads.view")
            ? { href: "/leads", label: "Leads" }
            : { href: "/today", label: "Today" }
        }
      />
      <Page className="max-w-[640px] pt-4">
        <LeadForm
          sources={sources}
          services={services.map((s) => ({ id: s.id, name: s.name }))}
          defaultSourceId={phoneSource?.id ?? settings.leads.default_source_id}
          consentText={settings.compliance.sms_consent_text}
          customDefs={customDefs}
        />
      </Page>
    </PageTransition>
  );
}
