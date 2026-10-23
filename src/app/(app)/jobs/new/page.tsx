import type { Metadata } from "next";
import { getJobForUser } from "@/features/jobs/api";
import {
  type NewJobDefaults,
  NewJobForm,
} from "@/features/jobs/components/NewJobForm";
import { serviceFeeDisclosure } from "@/features/jobs/internal";
import { isJobKind } from "@/features/jobs/kinds";
import { techRoster } from "@/features/jobs/schedule-queries";
import { listServiceTypeOptions } from "@/features/jobs/service-types";
import { getLeadPrefill } from "@/features/leads/api";
import { getCustomFieldDefs } from "@/features/settings/api";
import { requireUser } from "@/lib/auth/current";
import { formatMoney } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { Page } from "@/ui/components/AppShell";
import { NavBar } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "New job" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) ?? "";
const uuidOrNull = (v: string) => (/^[0-9a-f-]{36}$/i.test(v) ? v : null);

const PRIORITIES = new Set(["normal", "urgent", "emergency"]);

/**
 * /jobs/new?customerId&propertyId&leadId&callbackOf&date (Appendix A). From a lead
 * it keeps what the lead says (job type, urgency, after-hours, notes); the booking's
 * "Book by hand on New job" link adds `serviceTypeId`, `priority` and `afterHours`.
 */
export default async function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const user = await requireUser("jobs.create");
  const sp = await searchParams;
  const settings = await getSettings();
  const leadId = uuidOrNull(one(sp.leadId));
  const callbackOfId = uuidOrNull(one(sp.callbackOf));
  const canAssign = user.perms.has("jobs.assign");

  const [lead, orig, serviceTypes, techs, defs] = await Promise.all([
    leadId ? getLeadPrefill(leadId, user).catch(() => null) : null,
    callbackOfId ? getJobForUser(callbackOfId, user) : null,
    listServiceTypeOptions(),
    canAssign ? techRoster() : Promise.resolve([]),
    getCustomFieldDefs("job").catch(() => []),
  ]);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(one(sp.date))
    ? one(sp.date)
    : (lead?.preferredDate ?? "");
  const askedType = uuidOrNull(one(sp.serviceTypeId));
  const askedPriority = one(sp.priority);
  const priority = PRIORITIES.has(askedPriority)
    ? (askedPriority as "normal" | "urgent" | "emergency")
    : (lead?.priority ?? "normal");
  const defaults: NewJobDefaults = {
    customerId:
      orig?.customerId ?? lead?.customerId ?? uuidOrNull(one(sp.customerId)),
    propertyId:
      orig?.propertyId ?? lead?.propertyId ?? uuidOrNull(one(sp.propertyId)),
    serviceTypeId:
      orig?.serviceTypeId ??
      (askedType && serviceTypes.some((t) => t.id === askedType)
        ? askedType
        : null) ??
      lead?.serviceTypeId ??
      null,
    kind: isJobKind(lead?.kind) ? lead.kind : null,
    title: orig ? `Callback: ${orig.title}` : (lead?.serviceText ?? ""),
    description: "",
    customerNotes: lead?.notes ?? "",
    date,
    start: "09:00",
    priority: orig ? "normal" : priority,
    afterHours:
      !orig && (one(sp.afterHours) === "1" || lead?.afterHours === true),
    leadId: lead?.leadId ?? null,
    quotedPriceCents: lead?.quotedPriceCents ?? null,
    callbackOf: orig
      ? { id: orig.id, number: orig.number, title: orig.title }
      : null,
  };
  const p = settings.jobs.cancellation_policy;
  const cancellationSummary =
    p.late_cancel_fee_cents > 0 || p.no_show_fee_cents > 0
      ? [
          p.late_cancel_fee_cents > 0
            ? `Cancelling within ${p.late_cancel_hours} h of the window costs ${formatMoney(p.late_cancel_fee_cents)}.`
            : null,
          p.no_show_fee_cents > 0
            ? `No-show fee: ${formatMoney(p.no_show_fee_cents)}.`
            : null,
        ]
          .filter(Boolean)
          .join(" ")
      : null;

  return (
    <PageTransition>
      <NavBar
        title={orig ? "New callback" : "New job"}
        back={
          orig
            ? { href: `/jobs/${orig.id}`, label: orig.number }
            : lead
              ? { href: `/leads/${lead.leadId}`, label: "Lead" }
              : defaults.customerId && one(sp.customerId)
                ? {
                    href: `/customers/${defaults.customerId}`,
                    label: "Customer",
                  }
                : { href: "/jobs", label: "Jobs" }
        }
      />
      <Page className="pt-4">
        <div className="mx-auto max-w-[680px]">
          <NewJobForm
            defaults={defaults}
            serviceTypes={serviceTypes}
            techs={techs.map((t) => ({
              id: t.id,
              name: t.name,
              clockedIn: t.clockedIn,
            }))}
            canAssign={canAssign}
            viewerId={user.id}
            windowLengths={settings.jobs.window_lengths_min}
            defaultWindow={settings.jobs.default_window_min}
            customFieldDefs={defs}
            disclosure={serviceFeeDisclosure(settings.jobs)}
            cancellationSummary={cancellationSummary}
          />
        </div>
      </Page>
    </PageTransition>
  );
}
