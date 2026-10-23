import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { confirmationLabel } from "@/features/leads/booking-labels";
import { getBookingDone } from "@/features/leads/booking-queries";
import { DoneCard } from "@/features/leads/components/booking/DoneCard";
import { requireUser } from "@/lib/auth/current";
import { Page } from "@/ui/components/AppShell";
import { NavBar } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Booked" };

/**
 * Booking flow, Done: one read and no waiting (the confirmation line fills in on
 * the client). Right after Book the flow shows this same card itself; this page is
 * what a reload or a shared link lands on.
 */
export default async function BookingDonePage({
  searchParams,
}: {
  searchParams: Promise<{ jobId?: string; from?: string }>;
}) {
  const user = await requireUser("jobs.create");
  const { jobId, from } = await searchParams;
  const b = await getBookingDone(jobId);
  if (!b) notFound();
  const canView = user.perms.has("leads.view");
  return (
    <PageTransition>
      <NavBar
        title="Booked"
        back={
          canView
            ? { href: "/leads", label: "Leads" }
            : { href: "/today", label: "Today" }
        }
      />
      <Page className="pt-2">
        <DoneCard
          done={{
            jobId: b.jobId,
            number: b.number,
            customerName: b.customerName,
            serviceName: b.serviceName,
            date: b.date,
            start: b.start,
            end: b.end,
            techName: b.techName,
            status: confirmationLabel(b),
          }}
          canAssign={user.perms.has("jobs.assign")}
          nextHref={from === "call" || !canView ? "/leads/new" : "/leads"}
        />
      </Page>
    </PageTransition>
  );
}
