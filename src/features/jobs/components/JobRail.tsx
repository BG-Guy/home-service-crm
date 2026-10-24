import { formatDayShort, formatInTz } from "@/lib/time";
import { TechCard } from "@/ui/components/TechCard";
import { type TripStep, TripTimeline } from "@/ui/components/Timeline";
import type { JobDetail } from "../types";

// Right-rail cards of the job screen on desktop (DESIGN.md §6 "Detail page"):
// a trip-style progress timeline and the tech cards. Server components, no JS;
// DetailLayout hides them below 1200 px, where the hero and the bottom bar carry
// the same facts. The money is the main column's money card (MoneyCard.tsx).

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
