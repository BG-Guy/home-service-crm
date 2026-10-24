import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  NewEstimateForm,
  StartEstimateFromJob,
} from "@/features/estimates/components/NewEstimateForm";
import { getJobForUser } from "@/features/jobs/api";
import { getLeadPrefill } from "@/features/leads/api";
import { requireUser } from "@/lib/auth/current";
import { isUuid } from "@/lib/ids";
import { isEnabled } from "@/lib/settings";
import { stageStyle } from "@/lib/stage-colors";
import { Page } from "@/ui/components/AppShell";
import { NavBar } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "New estimate" };

// New estimate (Appendix A: customerId, propertyId, jobId, leadId). From a job the
// draft starts at once (the job's customer, address and title; Quote to Paid E2);
// from a lead the customer, property and title are prefilled.
export default async function EstimatesNewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const user = await requireUser("estimates.create");
  if (!(await isEnabled("estimates"))) notFound();
  const job = isUuid(sp.jobId) ? await getJobForUser(sp.jobId, user) : null;
  const lead =
    !job && isUuid(sp.leadId) ? await getLeadPrefill(sp.leadId, user) : null;
  const customerId =
    job?.customerId ??
    lead?.customerId ??
    (isUuid(sp.customerId) ? sp.customerId : undefined);
  const propertyId =
    job?.propertyId ??
    lead?.propertyId ??
    (isUuid(sp.propertyId) ? sp.propertyId : undefined);
  return (
    <PageTransition>
      <div className="contents" style={stageStyle("estimate")}>
        <NavBar
          title="New estimate"
          back={
            job
              ? { href: `/jobs/${job.id}?tab=estimate`, label: job.number }
              : { href: "/estimates", label: "Estimates" }
          }
        />
        <Page className="max-w-xl pt-4">
          {job ? (
            // From a job there's nothing to ask: the draft starts at once (E2).
            <StartEstimateFromJob
              jobId={job.id}
              customerId={job.customerId}
              propertyId={job.propertyId ?? undefined}
              title={job.title ?? undefined}
            />
          ) : (
            <NewEstimateForm
              leadId={
                lead && user.perms.has("leads.convert") ? sp.leadId : undefined
              }
              defaultCustomerId={customerId ?? undefined}
              defaultPropertyId={propertyId ?? undefined}
              defaultTitle={lead?.serviceText ?? undefined}
            />
          )}
        </Page>
      </div>
    </PageTransition>
  );
}
