import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getAvailability } from "@/features/jobs/availability";
import { getScheduleLead } from "@/features/leads/booking-queries";
import { BookingSteps } from "@/features/leads/components/booking/BookingSteps";
import { ScheduleFlow } from "@/features/leads/components/booking/ScheduleFlow";
import { requireUser } from "@/lib/auth/current";
import { getCompanyTimezone, isEnabled } from "@/lib/settings";
import { addDaysToKey, dateKey } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { Button } from "@/ui/components/Button";
import { Card } from "@/ui/components/Card";
import { EmptyState } from "@/ui/components/EmptyState";
import { NavBar } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Schedule" };

/** Call-to-booking step 2, "Schedule": the availability calendar for the lead's address. */
export default async function ScheduleLeadPage({
  searchParams,
}: {
  searchParams: Promise<{ leadId?: string }>;
}) {
  await requireUser("leads.convert");
  await requireUser("jobs.create");
  if (!(await isEnabled("leads"))) notFound();
  const { leadId } = await searchParams;
  const lead = await getScheduleLead(leadId);
  if (!lead) notFound();
  if (lead.jobId) redirect(`/leads/new/done?jobId=${lead.jobId}`);
  const back = { href: `/leads/new?leadId=${lead.leadId}`, label: "Caller" };

  if (!lead.customerId || !lead.propertyId || lead.status === "spam") {
    return (
      <PageTransition>
        <NavBar title="Schedule" back={back} />
        <Page className="pt-2">
          <div className="mx-auto w-full max-w-[640px]">
            <BookingSteps current={2} className="mb-5" />
            <Card>
              <EmptyState
                title="Add a service address first"
                message="This lead has no customer address yet, so there is nothing to schedule against."
                action={
                  <Button href={back.href} variant="secondary">
                    Back to caller
                  </Button>
                }
              />
            </Card>
          </div>
        </Page>
      </PageTransition>
    );
  }

  const tz = await getCompanyTimezone();
  const today = dateKey(new Date(), tz);
  const to = addDaysToKey(today, 59);
  const days = await getAvailability({
    from: today,
    to,
    propertyId: lead.propertyId,
    serviceTypeId: lead.serviceTypeId,
  });

  return (
    <PageTransition>
      <NavBar title="Schedule" back={back} />
      <Page className="pt-2" wide>
        <div className="mx-auto w-full max-w-[1160px]">
          <BookingSteps current={2} className="mb-5 max-w-[640px]" />
        </div>
        <div className="mx-auto w-full max-w-[1160px]">
          <ScheduleFlow
            lead={{
              leadId: lead.leadId,
              name: lead.name,
              customerId: lead.customerId,
              propertyId: lead.propertyId,
              addressLine: lead.addressLine,
              serviceTypeId: lead.serviceTypeId,
              serviceName: lead.serviceName,
              notes: lead.notes,
            }}
            days={days}
            today={today}
            to={to}
          />
        </div>
      </Page>
    </PageTransition>
  );
}
