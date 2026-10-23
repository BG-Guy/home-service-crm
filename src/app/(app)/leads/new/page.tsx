import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { listServiceTypeOptions } from "@/features/jobs/service-types";
import { getCallerDraft } from "@/features/leads/booking-queries";
import {
  type CallerDefaults,
  CallerForm,
} from "@/features/leads/components/booking/CallerForm";
import { listActiveSources } from "@/features/leads/queries";
import { getCustomFieldDefs } from "@/features/settings/api";
import { requireUser } from "@/lib/auth/current";
import { getCompany, getSettings, isEnabled } from "@/lib/settings";
import { Page } from "@/ui/components/AppShell";
import { NavBar } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "New lead" };

/** Booking flow, Who (and What): a phone caller. `?leadId=` = edit a saved lead (Back from When). */
export default async function NewLeadPage({
  searchParams,
}: {
  searchParams: Promise<{ leadId?: string }>;
}) {
  const user = await requireUser("leads.create");
  if (!(await isEnabled("leads"))) notFound();
  const { leadId } = await searchParams;
  const [sources, types, settings, customDefs, company, draft] =
    await Promise.all([
      listActiveSources(),
      listServiceTypeOptions().catch(() => []),
      getSettings(),
      getCustomFieldDefs("lead").catch(() => []),
      getCompany().catch(() => null),
      getCallerDraft(user, leadId),
    ]);
  const phoneSource = sources.find((s) => s.kind === "phone");
  const companyState = company?.address?.state ?? company?.state ?? "";
  const canSchedule =
    user.perms.has("leads.convert") && user.perms.has("jobs.create");
  const defaults: CallerDefaults = draft ?? {
    leadId: null,
    name: "",
    phone: "",
    street: "",
    unit: "",
    city: "",
    state: companyState,
    zip: "",
    serviceTypeId: null,
    kind: null,
    service: "",
    notes: "",
    sourceId: phoneSource?.id ?? settings.leads.default_source_id,
    priceCents: null,
    smsConsent: false,
    priority: "normal",
    afterHours: false,
  };
  return (
    <PageTransition>
      <NavBar
        title={draft ? "Edit lead" : "New lead"}
        back={
          user.perms.has("leads.view")
            ? { href: "/leads", label: "Leads" }
            : { href: "/today", label: "Today" }
        }
      />
      <Page className="pt-2">
        <div className="mx-auto w-full max-w-[640px]">
          <CallerForm
            // A new draft (Back from When) remounts the form with its values.
            key={draft?.leadId ?? "new"}
            defaults={defaults}
            sources={sources}
            types={types}
            zipHint={company?.address?.zip ?? null}
            cityHint={company?.address?.city ?? null}
            consentText={settings.compliance.sms_consent_text}
            customDefs={customDefs}
            canSchedule={canSchedule}
          />
        </div>
      </Page>
    </PageTransition>
  );
}
