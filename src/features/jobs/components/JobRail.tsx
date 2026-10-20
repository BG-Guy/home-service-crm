import Link from "next/link";
import { formatDayShort, formatInTz } from "@/lib/time";
import { MoneyText } from "@/ui/components/MoneyText";
import { TechCard } from "@/ui/components/TechCard";
import { type TripStep, TripTimeline } from "@/ui/components/Timeline";
import type { JobDetail } from "../types";

// Right-rail cards of the job screen on desktop (DESIGN.md §6 "Detail page"):
// a trip-style progress timeline, the money summary and the tech cards. Server
// components, no JS; DetailLayout hides them below 1200 px, where the hero and
// the bottom bar carry the same facts.

const ORDER = [
  "unscheduled",
  "scheduled",
  "confirmed",
  "en_route",
  "arrived",
  "in_progress",
  "on_hold",
  "completed",
  "closed",
] as const;

/** Uber-style progress: scheduled → on the way → arrived → working → done. */
export function JobProgressCard({ job, tz }: { job: JobDetail; tz: string }) {
  const t = (iso: string | null) =>
    iso
      ? formatInTz(iso, tz, { hour: "numeric", minute: "2-digit" })
      : undefined;
  const start = job.windowStart ?? job.scheduledStart;
  const at = ORDER.indexOf(job.status as (typeof ORDER)[number]);
  // Index of each step's own status; a step is done once the job moved past it.
  const step = (
    id: string,
    idx: number,
    title: string,
    time: string | undefined,
    body?: string,
  ): TripStep => ({
    id,
    title,
    time,
    body,
    state:
      job.status === "cancelled"
        ? time
          ? "done"
          : "upcoming"
        : at > idx || job.status === "closed"
          ? "done"
          : at === idx
            ? "current"
            : "upcoming",
  });
  const steps: TripStep[] = [
    step(
      "sched",
      job.status === "confirmed" ? 2 : 1,
      job.confirmedAt ? "Scheduled · confirmed" : "Scheduled",
      t(start),
      start ? formatDayShort(start, tz) : "No time set",
    ),
    step(
      "route",
      3,
      "On the way",
      t(job.enRouteAt),
      job.status === "en_route" && job.etaAt
        ? `ETA ${t(job.etaAt)}`
        : undefined,
    ),
    step("arrived", 4, "Arrived", t(job.arrivedAt)),
    step(
      "work",
      job.status === "on_hold" ? 6 : 5,
      job.status === "on_hold" ? "On hold" : "Work started",
      t(job.startedAt),
    ),
    step("done", 7, "Completed", t(job.completedAt)),
  ];
  if (job.status === "cancelled")
    steps.push({
      id: "cancel",
      state: "current",
      title: "Cancelled",
      time: t(job.cancelledAt),
    });
  if (job.status === "unscheduled" && steps[0]) steps[0].state = "current";
  const live = job.status === "en_route" || job.status === "in_progress";
  return (
    <section aria-labelledby="job-progress" className="card p-5">
      <h2 id="job-progress" className="mb-4 text-headline">
        Progress
      </h2>
      <TripTimeline steps={steps} label="Job progress" live={live} />
    </section>
  );
}

/** Invoice total, paid and balance, with a link to the Invoice tab. */
export function JobMoneyCard({
  jobId,
  invoice,
}: {
  jobId: string;
  invoice: { number: string; totalCents: number; balanceCents: number } | null;
}) {
  const paid = invoice ? invoice.totalCents - invoice.balanceCents : 0;
  return (
    <section aria-labelledby="job-money" className="card p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="job-money" className="text-headline">
          Money
        </h2>
        <Link
          href={`/jobs/${jobId}?tab=invoice`}
          replace
          scroll={false}
          className="hit-44 text-subhead font-semibold text-accent-text"
        >
          {invoice ? invoice.number : "Invoice"}
        </Link>
      </div>
      {invoice ? (
        <dl className="flex flex-col gap-2 text-subhead">
          <div className="flex justify-between gap-3">
            <dt className="text-label-2">Total</dt>
            <dd>
              <MoneyText cents={invoice.totalCents} />
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-label-2">Paid</dt>
            <dd>
              <MoneyText cents={paid} />
            </dd>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-hairline pt-3">
            <dt className="font-semibold">Balance</dt>
            <dd className="text-title3">
              <MoneyText cents={invoice.balanceCents} />
            </dd>
          </div>
        </dl>
      ) : (
        <p className="text-subhead text-label-2">No invoice yet.</p>
      )}
    </section>
  );
}

/** One Uber-style card per technician on the job. */
export function JobTechCards({ job }: { job: JobDetail }) {
  if (!job.assignees.length) return null;
  return (
    <section aria-label="Technicians" className="flex flex-col gap-3">
      {job.assignees.map((a) => (
        <TechCard
          key={a.userId}
          firstName={a.name}
          seed={a.userId}
          subtitle={
            job.assignees.length > 1
              ? `${a.role === "primary" ? "Lead technician" : "Helper"} · ${Math.round(a.splitBps / 100)}% split`
              : "Technician"
          }
          presence={job.status === "en_route" || job.status === "in_progress"}
        />
      ))}
    </section>
  );
}
