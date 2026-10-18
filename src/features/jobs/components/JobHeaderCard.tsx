import {
  CalendarClock,
  Clock,
  FileSearch,
  MapPin,
  Moon,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatDayShort, formatInTz, formatTimeRange } from "@/lib/time";
import { Avatar } from "@/ui/components/Avatar";
import { Pill, StatusPill } from "@/ui/components/StatusPill";
import type { JobDetail } from "../types";

/** Job header (BUILD_PLAN §5.3 "Header"): status, risk, readiness, deposit, payment, window, assignees. */
export function JobHeaderCard({
  job,
  tz,
  chips,
  readiness,
  assign,
  evidenceHref,
}: {
  job: JobDetail;
  tz: string;
  chips?: ReactNode;
  readiness?: ReactNode;
  assign?: ReactNode;
  evidenceHref?: string | null;
}) {
  const start = job.windowStart ?? job.scheduledStart;
  const end = job.windowEnd ?? job.scheduledEnd;
  const showPayment =
    job.paymentStatus !== "none" ||
    job.status === "completed" ||
    job.status === "closed";
  return (
    <section
      aria-label="Job summary"
      className="list-card flex flex-col gap-3 p-4"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-title2 font-bold leading-tight text-balance">
            {job.title}
          </h1>
          {/* A flex row so each part truncates on its own (no orphan "·", QA T2-25). */}
          <p className="mt-0.5 flex min-w-0 items-center gap-1 text-subhead text-label-2">
            <span className="min-w-0 shrink truncate">{job.customerName}</span>
            {job.addressShort && (
              <>
                <span aria-hidden className="shrink-0">
                  ·
                </span>
                <MapPin size={12} aria-hidden className="shrink-0" />
                <span className="min-w-0 shrink-[2] truncate">
                  {job.addressShort}
                </span>
              </>
            )}
          </p>
        </div>
        {readiness}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <StatusPill kind="job" status={job.status} />
        {showPayment && (
          <StatusPill kind="jobPayment" status={job.paymentStatus} />
        )}
        {job.priority !== "normal" && (
          <Pill tone={job.priority === "emergency" ? "red" : "orange"}>
            <TriangleAlert size={12} aria-hidden className="mr-0.5 inline" />
            {job.priority === "emergency" ? "Emergency" : "Urgent"}
          </Pill>
        )}
        {job.afterHours && (
          <Pill tone="indigo">
            <Moon size={12} aria-hidden className="mr-0.5 inline" />
            After hours
          </Pill>
        )}
        {job.isCallback && <Pill tone="purple">Callback</Pill>}
        {job.custom.no_charge === true && <Pill tone="gray">No charge</Pill>}
        {job.visitCount > 1 && <Pill tone="gray">Visit {job.visitCount}</Pill>}
        {chips}
      </div>

      <div className="flex flex-col gap-1.5 text-subhead">
        <span className="flex items-center gap-2">
          <CalendarClock
            size={16}
            className="shrink-0 text-label-2"
            aria-hidden
          />
          {start ? (
            <span className="num">
              {formatDayShort(start, tz)}
              {end
                ? ` · ${formatTimeRange(start, end, tz)}`
                : ` · ${formatInTz(start, tz, { hour: "numeric", minute: "2-digit" })}`}
              {job.confirmedAt && job.status === "confirmed" && (
                <span className="text-[var(--sys-green)]"> · confirmed</span>
              )}
            </span>
          ) : (
            <span className="text-label-2">Not scheduled yet</span>
          )}
        </span>
        {job.status === "en_route" && job.etaAt && (
          <span className="flex items-center gap-2 text-[var(--sys-teal)]">
            <Clock size={16} className="shrink-0" aria-hidden />
            ETA{" "}
            {formatInTz(job.etaAt, tz, { hour: "numeric", minute: "2-digit" })}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        {job.assignees.length ? (
          <ul
            className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5"
            aria-label="Assigned technicians"
          >
            {job.assignees.map((a) => (
              <li key={a.userId} className="flex items-center gap-1.5">
                <Avatar name={a.name} seed={a.userId} size={24} />
                <span className="text-subhead">{a.name.split(" ")[0]}</span>
                {job.assignees.length > 1 && (
                  <span className="num text-caption text-label-2">
                    {a.role === "primary" ? "Lead" : "Helper"} ·{" "}
                    {Math.round(a.splitBps / 100)}%
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <span className="flex-1 text-subhead text-[var(--sys-orange)]">
            No technician assigned
          </span>
        )}
        {assign}
      </div>

      {evidenceHref && (
        <Link
          href={evidenceHref}
          className="flex items-center gap-1.5 self-start text-subhead text-accent"
          transitionTypes={["nav-forward"]}
        >
          <FileSearch size={15} aria-hidden /> Evidence pack
        </Link>
      )}
    </section>
  );
}
