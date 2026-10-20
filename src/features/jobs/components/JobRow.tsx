import Link from "next/link";
import { formatInTz } from "@/lib/time";
import { Avatar } from "@/ui/components/Avatar";
import { Pill, StatusPill } from "@/ui/components/StatusPill";
import { cx } from "@/ui/cx";
import { Morph } from "@/ui/motion/Morph";
import type { JobListItem } from "../types";

/** One job in a list (server- and client-renderable, presentational). */
export function JobRow({
  job,
  tz,
  showDate = true,
  href,
  morph = true,
}: {
  job: JobListItem;
  tz: string;
  showDate?: boolean;
  href?: string;
  /**
   * Carry the `job-<id>-title` / `-status` morph names into the job hero (M3).
   * Pass `false` when the same job is on the page twice (e.g. a Today hero card
   * already carries them): names must be unique on a page.
   */
  morph?: boolean;
}) {
  const start = job.windowStart;
  const [clock, ampm] = start
    ? formatInTz(start, tz, { hour: "numeric", minute: "2-digit" }).split(" ")
    : [];
  const title = (
    <span
      className={cx(
        "inline-block max-w-full truncate align-top text-headline",
        job.status === "cancelled" && "text-label-2 line-through",
      )}
    >
      {job.title}
    </span>
  );
  const status = (
    <span className="inline-flex">
      <StatusPill kind="job" status={job.status} size="sm" />
    </span>
  );
  return (
    <Link
      href={href ?? `/jobs/${job.id}`}
      prefetch
      transitionTypes={["nav-forward"]}
      className="list-row row-press flex min-h-[76px] w-full items-center gap-3 py-3 pl-4 pr-3 text-left outline-offset-[-2px]"
    >
      <span className="flex w-12 shrink-0 flex-col items-start self-start pt-0.5">
        {start ? (
          <>
            <span className="num text-headline leading-tight">{clock}</span>
            <span className="text-caption font-medium text-label-2">
              {ampm}
              {showDate &&
                ` · ${formatInTz(start, tz, { month: "short", day: "numeric" })}`}
            </span>
          </>
        ) : (
          <span className="text-caption font-medium text-label-2">No time</span>
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {morph ? <Morph name={`job-${job.id}-title`}>{title}</Morph> : title}
        <span className="truncate text-subhead text-label-2">
          {job.customerName}
          {job.addressShort ? ` · ${job.addressShort}` : ""}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          {morph ? (
            <Morph name={`job-${job.id}-status`}>{status}</Morph>
          ) : (
            status
          )}
          <span className="num text-caption text-label-2">{job.number}</span>
          {job.priority !== "normal" && (
            <Pill
              tone={job.priority === "emergency" ? "red" : "orange"}
              size="sm"
            >
              {job.priority === "emergency" ? "Emergency" : "Urgent"}
            </Pill>
          )}
          {job.isCallback && (
            <Pill tone="purple" size="sm">
              Callback
            </Pill>
          )}
          {job.cancelledAfterArrival && (
            <Pill tone="red" size="sm">
              After arrival
            </Pill>
          )}
          {(job.status === "completed" || job.status === "closed") &&
            job.paymentStatus !== "paid" && (
              <StatusPill
                kind="jobPayment"
                status={job.paymentStatus}
                size="sm"
              />
            )}
        </span>
      </span>
      <span
        className="flex shrink-0 -space-x-2 self-center"
        title={job.assignees.map((a) => a.name).join(", ") || "Unassigned"}
      >
        {job.assignees.length === 0 && (
          <span className="text-caption font-medium text-[var(--sys-orange)]">
            Unassigned
          </span>
        )}
        {job.assignees.slice(0, 3).map((a) => (
          <Avatar
            key={a.userId}
            name={a.name}
            seed={a.userId}
            size={32}
            className="ring-2 ring-[var(--card)]"
          />
        ))}
      </span>
    </Link>
  );
}
