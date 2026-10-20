import {
  CalendarClock,
  Clock,
  FileSearch,
  MapPin,
  Moon,
  Navigation,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatDayShort, formatInTz, formatTimeRange } from "@/lib/time";
import { Avatar } from "@/ui/components/Avatar";
import { IconButton } from "@/ui/components/IconButton";
import { Pill, StatusPill } from "@/ui/components/StatusPill";
import { Morph } from "@/ui/motion/Morph";
import type { JobDetail } from "../types";

/** One fact line of the hero: a soft icon tile, a main line and a quiet line. */
function Fact({
  icon,
  children,
  sub,
  trailing,
}: {
  icon: ReactNode;
  children: ReactNode;
  sub?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex min-h-11 items-center gap-3">
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-[12px] bg-fill-2 text-label-2"
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-callout">{children}</div>
        {sub != null && (
          <div className="truncate text-footnote text-label-2">{sub}</div>
        )}
      </div>
      {trailing}
    </div>
  );
}

/**
 * Job hero (DESIGN.md §7.3, BUILD_PLAN §5.3 "Header"): live status, the title
 * (shared-element morph from the list row), customer and address, window, the
 * technicians. Risk, readiness, deposit and payment ride along as chips.
 */
export function JobHeaderCard({
  job,
  tz,
  chips,
  readiness,
  assign,
  evidenceHref,
  navHref,
}: {
  job: JobDetail;
  tz: string;
  chips?: ReactNode;
  readiness?: ReactNode;
  assign?: ReactNode;
  evidenceHref?: string | null;
  /** Directions link (apple / google maps); omitted when the address is masked. */
  navHref?: string | null;
}) {
  const start = job.windowStart ?? job.scheduledStart;
  const end = job.windowEnd ?? job.scheduledEnd;
  const showPayment =
    job.paymentStatus !== "none" ||
    job.status === "completed" ||
    job.status === "closed";
  const time = (iso: string) =>
    formatInTz(iso, tz, { hour: "numeric", minute: "2-digit" });
  return (
    <section
      aria-label="Job summary"
      className="card flex flex-col gap-4 p-4 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Morph name={`job-${job.id}-status`}>
              <span className="inline-flex">
                <StatusPill kind="job" status={job.status} />
              </span>
            </Morph>
            {showPayment && (
              <StatusPill kind="jobPayment" status={job.paymentStatus} />
            )}
            {job.priority !== "normal" && (
              <Pill tone={job.priority === "emergency" ? "red" : "orange"}>
                <TriangleAlert
                  size={12}
                  aria-hidden
                  className="mr-0.5 inline"
                />
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
            {job.custom.no_charge === true && (
              <Pill tone="gray">No charge</Pill>
            )}
            {job.visitCount > 1 && (
              <Pill tone="gray">Visit {job.visitCount}</Pill>
            )}
            {chips}
          </div>
          <div>
            <Morph name={`job-${job.id}-title`}>
              <h1 className="inline-block text-title2 text-balance sm:text-title1">
                {job.title}
              </h1>
            </Morph>
            <p className="num mt-0.5 text-subhead text-label-2">
              {job.number}
              {job.serviceTypeName ? ` · ${job.serviceTypeName}` : ""}
            </p>
          </div>
        </div>
        {readiness}
      </div>

      <div className="flex flex-col gap-1">
        <Fact
          icon={<MapPin size={18} />}
          sub={job.addressShort || undefined}
          trailing={
            navHref ? (
              <IconButton
                href={navHref}
                external
                label="Directions"
                variant="secondary"
                size={40}
              >
                <Navigation size={18} aria-hidden />
              </IconButton>
            ) : undefined
          }
        >
          <span className="font-semibold">{job.customerName}</span>
        </Fact>
        <Fact
          icon={<CalendarClock size={18} />}
          sub={
            job.status === "en_route" && job.etaAt ? (
              <span className="inline-flex items-center gap-1 text-[var(--sys-teal)]">
                <Clock size={13} aria-hidden /> ETA {time(job.etaAt)}
              </span>
            ) : job.confirmedAt && job.status === "confirmed" ? (
              <span className="text-[var(--sys-green)]">
                Confirmed by customer
              </span>
            ) : undefined
          }
        >
          {start ? (
            <span className="num">
              {formatDayShort(start, tz)}
              {end
                ? ` · ${formatTimeRange(start, end, tz)}`
                : ` · ${time(start)}`}
            </span>
          ) : (
            <span className="text-label-2">Not scheduled yet</span>
          )}
        </Fact>
      </div>

      <div className="flex items-center gap-3 border-t border-hairline pt-3">
        {job.assignees.length ? (
          <ul
            className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2"
            aria-label="Assigned technicians"
          >
            {job.assignees.map((a) => (
              <li key={a.userId} className="flex items-center gap-2">
                <Avatar name={a.name} seed={a.userId} size={32} />
                <span className="flex flex-col leading-tight">
                  <span className="text-subhead font-semibold">
                    {a.name.split(" ")[0]}
                  </span>
                  <span className="num text-caption text-label-2">
                    {job.assignees.length > 1
                      ? `${a.role === "primary" ? "Lead" : "Helper"} · ${Math.round(a.splitBps / 100)}%`
                      : "Technician"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="flex-1 text-subhead font-medium text-[var(--sys-orange)]">
            No technician assigned
          </span>
        )}
        {assign}
      </div>

      {evidenceHref && (
        <Link
          href={evidenceHref}
          className="-mt-1 flex items-center gap-1.5 self-start text-subhead font-medium text-accent-text"
          transitionTypes={["nav-forward"]}
        >
          <FileSearch size={15} aria-hidden /> Evidence pack
        </Link>
      )}
    </section>
  );
}
