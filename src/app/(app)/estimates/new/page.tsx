import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NewEstimateForm } from "@/features/estimates/components/NewEstimateForm";
import { getJobForUser } from "@/features/jobs/api";
import { getLeadPrefill } from "@/features/leads/api";
import { requireUser } from "@/lib/auth/current";
import { isUuid } from "@/lib/ids";
import { isEnabled } from "@/lib/settings";
import { Page } from "@/ui/components/AppShell";
import { NavBar } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "New estimate" };

// New estimate (Appendix A: customerId, propertyId, jobId, leadId). From a job the
// customer is fixed; from a lead the customer, property and title are prefilled.
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
      <NavBar
        title="New estimate"
        back={
          job
            ? { href: `/jobs/${job.id}?tab=estimate`, label: job.number }
            : { href: "/estimates", label: "Estimates" }
        }
      />
      <Page className="max-w-xl pt-4">
        <NewEstimateForm
          jobId={job?.id}
          leadId={
            lead && user.perms.has("leads.convert") ? sp.leadId : undefined
          }
          defaultCustomerId={customerId ?? undefined}
          defaultPropertyId={propertyId ?? undefined}
          defaultTitle={job?.title ?? lead?.serviceText ?? undefined}
          lockCustomer={!!job}
        />
      </Page>
    </PageTransition>
  );
}
