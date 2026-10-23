"use client";

import { Maximize2, MessageCircle, Navigation, Phone } from "lucide-react";
import { CallButton } from "@/features/customers/components/CallButton";
import { Avatar } from "@/ui/components/Avatar";
import { RoundAction } from "@/ui/components/RoundAction";
import { Pill, StatusPill } from "@/ui/components/StatusPill";
import { cx } from "@/ui/cx";
import type { JobListItem } from "../types";
import { jobWindowLabel } from "./job-window";

/**
 * One job as a card in the /jobs grid (like the lead boxes): the arrival window
 * and status on top, the job, the customer and the street, the techs, then four
 * actions: Call (through the app), Text, Directions and Open (the peek). Tapping
 * the card also opens the peek; the peek's button goes to the full job page.
 */
export function JobBox({
  job,
  tz,
  showDate,
  onPeek,
}: {
  job: JobListItem;
  tz: string;
  /** Add the day to the time (the "No date" group never has one). */
  showDate?: boolean;
  onPeek(id: string): void;
}) {
  const when = jobWindowLabel(job.windowStart, job.windowEnd, tz, showDate);
  const cancelled = job.status === "cancelled";
  const people = job.assignees;
  return (
    <article
      className={cx(
        "relative flex h-full flex-col gap-3 rounded-card bg-card p-4 shadow-card",
        "hover-lift transition-shadow",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={cx(
            "num min-w-0 truncate text-subhead font-semibold",
            job.windowStart ? "text-label" : "text-label-2",
          )}
        >
          {when}
        </span>
        <StatusPill kind="job" status={job.status} size="sm" live={false} />
      </div>
      <div className="min-w-0">
        <h3 className="flex min-w-0 items-baseline gap-1.5">
          <button
            type="button"
            onClick={() => onPeek(job.id)}
            className={cx(
              "box-hit min-w-0 truncate text-left text-headline outline-none",
              cancelled && "text-label-2 line-through",
            )}
          >
            {job.title}
          </button>
          <span className="num shrink-0 text-footnote text-label-3">
            {job.number}
          </span>
        </h3>
        <p className="truncate text-subhead text-label-2">
          {job.customerName}
          {job.serviceTypeName ? ` · ${job.serviceTypeName}` : ""}
        </p>
        <p className="truncate text-subhead text-label-2">
          {[job.addressShort, job.city].filter(Boolean).join(", ")}
        </p>
      </div>
      <div className="flex min-h-6 flex-wrap items-center gap-1.5">
        {people.length ? (
          <span className="flex items-center gap-1.5">
            <span className="flex -space-x-1.5">
              {people.slice(0, 3).map((a) => (
                <Avatar
                  key={a.userId}
                  name={a.name}
                  seed={a.userId}
                  color={a.color ?? undefined}
                  size={22}
                  className="ring-2 ring-card"
                />
              ))}
            </span>
            <span className="max-w-[9rem] truncate text-footnote text-label-2">
              {people.length === 1
                ? people[0]?.name.split(" ")[0]
                : `${people.length} techs`}
            </span>
          </span>
        ) : (
          <span className="text-footnote text-label-2">No tech yet</span>
        )}
        {job.priority !== "normal" && (
          <Pill tone="red" size="sm" dot={false}>
            {job.priority === "emergency" ? "Emergency" : "Urgent"}
          </Pill>
        )}
        {job.isCallback && (
          <Pill tone="orange" size="sm" dot={false}>
            Callback
          </Pill>
        )}
        {job.paymentStatus !== "none" && job.paymentStatus !== "paid" && (
          <StatusPill kind="jobPayment" status={job.paymentStatus} size="sm" />
        )}
      </div>
      <div className="relative z-[1] mt-auto flex justify-between gap-1 border-hairline border-t pt-3">
        {job.canCall ? (
          <CallButton
            customerId={job.customerId}
            jobId={job.id}
            label="Call"
            variant="round"
          />
        ) : (
          <RoundAction
            icon={<Phone />}
            label="Call"
            size={52}
            disabled
            tone="tinted"
          />
        )}
        <RoundAction
          icon={<MessageCircle />}
          label="Text"
          size={52}
          tone="tinted"
          href={job.canText ? `/messages/${job.customerId}` : null}
          disabled={!job.canText}
        />
        <RoundAction
          icon={<Navigation />}
          label="Directions"
          size={52}
          tone="tinted"
          href={job.navHref ?? null}
          external
          newTab
          disabled={!job.navHref}
        />
        <RoundAction
          icon={<Maximize2 />}
          label="Open"
          size={52}
          tone="tinted"
          ariaLabel={`Open the card for ${job.title}`}
          onClick={() => onPeek(job.id)}
        />
      </div>
    </article>
  );
}
