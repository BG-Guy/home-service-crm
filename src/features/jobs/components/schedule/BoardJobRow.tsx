import { CircleDollarSign, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatInTz } from "@/lib/time";
import { Avatar } from "@/ui/components/Avatar";
import { Pill, StatusPill } from "@/ui/components/StatusPill";
import type { BoardJob, BoardTech } from "../../schedule-queries";

/** One job on the mobile schedule list / queues (presentational; server or client). */
export function BoardJobRow({
  job,
  tz,
  techs,
  showTechs = false,
  showDay = false,
  trailing,
  edge,
}: {
  job: BoardJob;
  tz: string;
  techs?: BoardTech[];
  showTechs?: boolean;
  showDay?: boolean;
  trailing?: ReactNode;
  /** Lane color (the tech's): a soft block edge on the left. */
  edge?: string;
}) {
  const people =
    showTechs && techs
      ? job.techIds.map((id) => techs.find((t) => t.id === id)).filter(Boolean)
      : [];
  const depositDue = job.deposit?.required && !job.deposit.paid;
  return (
    <div className="list-row relative flex items-center gap-2 pr-3">
      {edge && (
        <span
          aria-hidden
          className="absolute top-2.5 bottom-2.5 left-2 w-1 rounded-full"
          style={{ background: edge }}
        />
      )}
      <Link
        href={`/jobs/${job.id}`}
        transitionTypes={["nav-forward"]}
        className="row-press flex min-h-[68px] min-w-0 flex-1 items-center gap-3 pl-5 text-left outline-offset-[-2px]"
      >
        <span className="flex w-[4.75rem] shrink-0 flex-col self-start whitespace-nowrap py-3">
          {job.start ? (
            <>
              <span className="num text-subhead font-semibold">
                {formatInTz(job.start, tz, {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
              {job.end && !showDay && (
                <span className="num text-caption text-label-2">
                  {formatInTz(job.end, tz, {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              )}
              {showDay && (
                <span className="text-caption text-label-2">
                  {formatInTz(job.start, tz, {
                    weekday: "short",
                    day: "numeric",
                  })}
                </span>
              )}
            </>
          ) : (
            <span className="text-caption text-label-2">No time</span>
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col py-3">
          <span className="line-clamp-2 min-w-0 text-headline">
            {job.title}
          </span>
          <span className="truncate text-subhead text-label-2">
            {job.customerName} · {job.addressShort}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            <StatusPill kind="job" status={job.status} size="sm" />
            <span className="num text-caption text-label-2">{job.number}</span>
            {job.priority !== "normal" && (
              <Pill
                tone={job.priority === "emergency" ? "red" : "orange"}
                size="sm"
              >
                {job.priority === "emergency" ? "Emergency" : "Urgent"}
              </Pill>
            )}
            {depositDue && (
              <Pill tone="orange" size="sm" dot={false}>
                <CircleDollarSign
                  size={11}
                  aria-hidden
                  className="mr-0.5 inline"
                />
                Deposit due
              </Pill>
            )}
            {job.rescheduleRequested && (
              <Pill tone="blue" size="sm">
                Wants new time
              </Pill>
            )}
            {people.map((t) => (
              <span
                key={t?.id}
                className="inline-flex items-center gap-1 text-footnote text-label-2"
              >
                <Avatar name={t?.name ?? ""} seed={t?.id} size={16} />
                {t?.name.split(" ")[0]}
              </span>
            ))}
          </span>
          {job.warnings.length > 0 && (
            <span className="mt-1 flex items-center gap-1 text-footnote text-[var(--sys-orange)]">
              <TriangleAlert size={12} aria-hidden className="shrink-0" />
              <span className="truncate">{job.warnings.join(" · ")}</span>
            </span>
          )}
          {job.warnings.length === 0 && job.travelHint && (
            <span className="mt-0.5 text-caption text-label-2">
              {job.travelHint}
            </span>
          )}
        </span>
      </Link>
      {trailing}
    </div>
  );
}
