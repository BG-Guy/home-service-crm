import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCallerDraft } from "@/features/leads/booking-queries";
import { BookingSteps } from "@/features/leads/components/booking/BookingSteps";
import {
  type CallerDefaults,
  CallerForm,
} from "@/features/leads/components/booking/CallerForm";
import { listActiveSources } from "@/features/leads/queries";
import { getCustomFieldDefs, listServiceTypes } from "@/features/settings/api";
import { requireUser } from "@/lib/auth/current";
import { getCompany, getSettings, isEnabled } from "@/lib/settings";
import { Page } from "@/ui/components/AppShell";
import { NavBar } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "New call" };

/** Call-to-booking step 1, "Caller" (`?leadId=` = back from step 2). */
export default async function NewLeadPage({
  searchParams,
}: {
  searchParams: Promise<{ leadId?: string }>;
}) {
  const user = await requireUser("leads.create");
  if (!(await isEnabled("leads"))) notFound();
  const { leadId } = await searchParams;
  const [sources, services, settings, customDefs, company, draft] =
    await Promise.all([
      listActiveSources(),
      listServiceTypes().catch(() => []),
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
    service: "",
    notes: "",
    sourceId: phoneSource?.id ?? settings.leads.default_source_id,
    priceCents: null,
    smsConsent: false,
  };
  return (
    <PageTransition>
      <NavBar
        title={draft ? "Edit caller" : "New call"}
        back={
          user.perms.has("leads.view")
            ? { href: "/leads", label: "Leads" }
            : { href: "/today", label: "Today" }
        }
      />
      <Page className="pt-2">
        <div className="mx-auto w-full max-w-[640px]">
          {canSchedule && <BookingSteps current={1} className="mb-5" />}
          <CallerForm
            // A new draft (back from step 2) remounts the form with its values.
            key={draft?.leadId ?? "new"}
            defaults={defaults}
            sources={sources}
            services={services.map((s) => ({ id: s.id, name: s.name }))}
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
