import { MessageSquare } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { windowLabel } from "@/features/jobs/availability/windows";
import { confirmationLabel } from "@/features/leads/booking-labels";
import { getBookingDone } from "@/features/leads/booking-queries";
import { BookingSteps } from "@/features/leads/components/booking/BookingSteps";
import { ConfirmationPoll } from "@/features/leads/components/booking/ConfirmationStatus";
import { requireUser } from "@/lib/auth/current";
import { formatDateKey } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { Button } from "@/ui/components/Button";
import { NavBar } from "@/ui/components/NavBar";
import { Pill } from "@/ui/components/StatusPill";
import { SuccessCheck } from "@/ui/components/SuccessCheck";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Booked" };

/** Call-to-booking step 3, "Done". */
export default async function BookingDonePage({
  searchParams,
}: {
  searchParams: Promise<{ jobId?: string }>;
}) {
  const user = await requireUser("jobs.create");
  const { jobId } = await searchParams;
  let b = await getBookingDone(jobId);
  // The confirmation is enqueued by the automation engine in after() right after
  // the booking commits: give it a moment so the first paint shows the real state.
  for (
    let i = 0;
    b && !b.confirmation && b.techName && b.ageSec < 20 && i < 12;
    i++
  ) {
    await new Promise((r) => setTimeout(r, 250));
    b = await getBookingDone(jobId);
  }
  if (!b) notFound();
  const when =
    b.date && b.start && b.end
      ? `${formatDateKey(b.date, "en-US", { weekday: "short", month: "short", day: "numeric" })} · ${windowLabel(b.start, b.end)}`
      : null;
  const first = b.techName?.split(/\s+/)[0];
  const title = when
    ? `Booked for ${when}${first ? ` with ${first}` : ""}`
    : "Job created";
  const conf = confirmationLabel(b);

  return (
    <PageTransition>
      <NavBar
        title="Booked"
        back={
          user.perms.has("leads.view")
            ? { href: "/leads", label: "Leads" }
            : { href: "/today", label: "Today" }
        }
      />
      <Page className="pt-2">
        <div className="mx-auto w-full max-w-[560px]">
          <BookingSteps current={3} className="mb-8" />
          <section
            aria-labelledby="done-h"
            className="flex flex-col items-center gap-4 rounded-card bg-card px-5 py-8 text-center shadow-card"
          >
            <SuccessCheck size={64} label="Booked" />
            <div className="flex flex-col gap-1">
              <h2 id="done-h" className="text-title2 text-balance">
                {title}
              </h2>
              <p className="text-subhead text-label-2">
                {b.customerName} · Job {b.number}
              </p>
            </div>
            <output className="flex items-center gap-2 text-footnote text-label-2">
              <MessageSquare aria-hidden size={16} />
              <Pill tone={conf.tone} dot={false}>
                {conf.text}
              </Pill>
            </output>
            <ConfirmationPoll settled={conf.settled} />
            <div className="mt-2 flex w-full flex-col gap-3">
              <Button href={`/jobs/${b.jobId}`} size="lg" block>
                Open job
              </Button>
              <div className="grid gap-3 min-[420px]:grid-cols-2">
                <Button href="/leads/new" variant="secondary" size="lg" block>
                  New call
                </Button>
                <Button
                  href={`/customers/${b.customerId}`}
                  variant="secondary"
                  size="lg"
                  block
                >
                  View customer
                </Button>
              </div>
            </div>
          </section>
        </div>
      </Page>
    </PageTransition>
  );
}
