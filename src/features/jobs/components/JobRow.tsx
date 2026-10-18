import Link from "next/link";
import { formatInTz } from "@/lib/time";
import { Avatar } from "@/ui/components/Avatar";
import { Pill, StatusPill } from "@/ui/components/StatusPill";
import { cx } from "@/ui/cx";
import type { JobListItem } from "../types";

/** One job in a list (server- and client-renderable, presentational). */
export function JobRow({
  job,
  tz,
  showDate = true,
  href,
}: {
  job: JobListItem;
  tz: string;
  showDate?: boolean;
  href?: string;
}) {
  const start = job.windowStart;
  return (
    <Link
      href={href ?? `/jobs/${job.id}`}
      prefetch
      transitionTypes={["nav-forward"]}
      className="list-row row-press flex min-h-[68px] w-full items-center gap-3 pl-4 pr-3 text-left outline-offset-[-2px]"
    >
      <span className="flex w-14 shrink-0 flex-col items-start py-2.5">
        {start ? (
          <>
            <span className="num text-subhead font-semibold">
              {formatInTz(start, tz, { hour: "numeric", minute: "2-digit" })}
            </span>
            {showDate && (
              <span className="text-caption text-label-2">
                {formatInTz(start, tz, { month: "short", day: "numeric" })}
              </span>
            )}
          </>
        ) : (
          <span className="text-caption text-label-2">No time</span>
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col py-2.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="num shrink-0 text-footnote text-label-2">
            {job.number}
          </span>
          <span
            className={cx(
              "truncate text-body",
              job.status === "cancelled" && "text-label-2 line-through",
            )}
          >
            {job.title}
          </span>
        </span>
        <span className="truncate text-subhead text-label-2">
          {job.customerName} · {job.addressShort}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <StatusPill kind="job" status={job.status} size="sm" />
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
        className="flex shrink-0 -space-x-2"
        title={job.assignees.map((a) => a.name).join(", ") || "Unassigned"}
      >
        {job.assignees.slice(0, 3).map((a) => (
          <Avatar
            key={a.userId}
            name={a.name}
            seed={a.userId}
            size={28}
            className="ring-2 ring-[var(--card)]"
          />
        ))}
      </span>
    </Link>
  );
}
