import { hubHrefForJob } from "@/features/jobs/dispatch/href";
import { Button } from "@/ui/components/Button";
import { SuccessCheck } from "@/ui/components/SuccessCheck";
import { bookedTitle, type ConfirmationLabel } from "../../booking-labels";
import { BookingSteps } from "./BookingSteps";
import { ConfirmationStatus } from "./ConfirmationStatus";

/** What the Done screen shows (from the server, or from the booking just made). */
export interface DoneView {
  jobId: string;
  number: string;
  customerName: string;
  serviceName: string | null;
  date: string | null;
  start: string | null;
  end: string | null;
  techName: string | null;
  status: ConfirmationLabel;
}

/**
 * Done: "Booked: arrives Fri, Oct 23 · 8–10 AM", the confirmation line, and the
 * hand-off: Assign a tech (the hub with this job picked), Next lead, Open job.
 * No hooks: the Done page (server) and the booking flow (client, right after
 * Book, before any round trip) render the same card.
 */
export function DoneCard({
  done,
  canAssign,
  nextHref,
}: {
  done: DoneView;
  /** jobs.assign: the Assign hub. */
  canAssign: boolean;
  /** "/leads/new" after a phone call, else the inbox. */
  nextHref: string;
}) {
  const title =
    done.date && done.start && done.end
      ? bookedTitle(done.date, done.start, done.end)
      : "Job created";
  const assign = canAssign && !done.techName;
  const first = done.techName?.split(/\s+/)[0];
  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-6">
      <BookingSteps current={4} />
      <section
        aria-labelledby="done-h"
        className="flex flex-col items-center gap-4 rounded-card bg-card px-5 py-8 text-center shadow-card"
      >
        <SuccessCheck size={64} label="Booked" />
        <div className="flex flex-col gap-1">
          <h2 id="done-h" className="text-title2 text-balance">
            {title}
          </h2>
          <p className="text-subhead text-label-2 text-balance">
            {[
              done.customerName,
              done.serviceName,
              `Job ${done.number}`,
              first ? `with ${first}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <ConfirmationStatus jobId={done.jobId} initial={done.status} />
        <div className="mt-2 flex w-full flex-col gap-3">
          {assign && (
            <Button
              href={hubHrefForJob(done.jobId, done.date)}
              transition="push"
              size="lg"
              block
            >
              Assign a tech
            </Button>
          )}
          <Button
            href={nextHref}
            transition="push"
            variant={assign ? "secondary" : "primary"}
            size="lg"
            block
          >
            Next lead
          </Button>
          <Button
            href={`/jobs/${done.jobId}`}
            transition="push"
            variant="plain"
            size="lg"
            block
          >
            Open job
          </Button>
        </div>
      </section>
    </div>
  );
}
