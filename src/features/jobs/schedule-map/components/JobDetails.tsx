"use client";

import { MapPin, MessageCircle, Navigation, UserRound, X } from "lucide-react";
import dynamic from "next/dynamic";
import { type CSSProperties, useState } from "react";
import { Avatar } from "@/ui/components/Avatar";
import { Button } from "@/ui/components/Button";
import { IconButton } from "@/ui/components/IconButton";
import { Pill, StatusPill } from "@/ui/components/StatusPill";
import { hubHrefForJob } from "../../dispatch/href";
import { type JobPhase, longWindow, type StopRef } from "../route";
import type { SmJob, SmTech } from "../types";

// A job's details on the schedule map (right column, tablet drawer, phone
// sheet): status, window, customer with call / text, address with directions,
// notes, the tech and stop number, and Open job / Reassign / Reschedule. Its own
// chunk, preloaded when the map view is idle, so the first click is instant.

const CallButton = dynamic(
  () =>
    import("@/features/customers/components/CallButton").then(
      (m) => m.CallButton,
    ),
  { ssr: false, loading: () => <span aria-hidden className="size-9" /> },
);
const AssignSheet = dynamic(() => import("../../components/AssignSheet"), {
  ssr: false,
});

const GRAY = "var(--sys-gray)";
const cvar = (c: string) => ({ ["--c" as string]: c }) as CSSProperties;

function RescheduleButton({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
        onPointerEnter={() => void import("../../components/AssignSheet")}
        block
      >
        Reschedule
      </Button>
      {mounted && (
        <AssignSheet jobId={jobId} open={open} onOpenChange={setOpen} />
      )}
    </>
  );
}

export function JobDetails({
  job,
  phase,
  stop,
  techs,
  date,
  dateLabel,
  canAssign,
  canReschedule,
  onClose,
  primaryAt = "end",
}: {
  job: SmJob;
  phase: JobPhase | undefined;
  stop: StopRef | undefined;
  techs: ReadonlyMap<string, SmTech>;
  date: string;
  /** "Thu, Oct 22" */
  dateLabel: string;
  canAssign: boolean;
  canReschedule: boolean;
  onClose?: () => void;
  /**
   * Where "Open job" goes: at the end (columns, drawer), or right under the
   * window ("top", the phone sheet: visible at its medium detent).
   */
  primaryAt?: "end" | "top";
}) {
  const lead = stop ? techs.get(stop.techId) : undefined;
  const others = job.techIds
    .filter((id) => id !== lead?.id)
    .map((id) => techs.get(id)?.name.split(" ")[0])
    .filter(Boolean);
  const done = job.status === "completed" || job.status === "closed";
  return (
    <article
      key={job.id}
      className="sm-card sm-in flex flex-col gap-4"
      aria-label={`Job ${job.number}`}
    >
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 pt-1">
          <StatusPill kind="job" status={job.status} live={false} />
          {phase?.late && (
            <Pill tone="red" size="sm">
              Late
            </Pill>
          )}
          {phase?.unassigned && (
            <Pill tone="gray" size="sm" dot={false}>
              Unassigned
            </Pill>
          )}
        </div>
        {onClose && (
          <IconButton
            label="Close details"
            variant="secondary"
            size={36}
            onClick={onClose}
          >
            <X size={18} aria-hidden />
          </IconButton>
        )}
      </div>
      <div>
        <p className="text-footnote font-semibold text-label-2">
          {job.serviceName ?? "Job"} · {job.number}
        </p>
        <h2 className="text-title3 font-bold">{job.title}</h2>
      </div>
      <div>
        <p className="num text-title2 font-bold tracking-tight">
          {longWindow(job.startMin, job.endMin)}
        </p>
        <p className="text-footnote text-label-2">
          Arrival window · {dateLabel}
        </p>
      </div>
      {primaryAt === "top" && (
        <Button href={`/jobs/${job.id}`} transition="push" size="lg" block>
          Open job
        </Button>
      )}

      <div className="flex flex-col gap-3 border-t border-[var(--sep)] pt-4">
        <div className="flex items-center gap-3">
          <Avatar name={job.customerName} seed={job.customerId} size={40} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-headline">{job.customerName}</p>
            {job.phoneLabel && (
              <p className="num truncate text-footnote text-label-2">
                {job.phoneLabel}
              </p>
            )}
          </div>
          {job.canCall && (
            <CallButton
              customerId={job.customerId}
              jobId={job.id}
              label={`Call ${job.customerName}`}
              variant="icon"
            />
          )}
          {job.canText && (
            <IconButton
              label={`Text ${job.customerName}`}
              variant="secondary"
              size={36}
              href={`/messages/${job.customerId}`}
              transition="push"
            >
              <MessageCircle size={18} aria-hidden />
            </IconButton>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-fill-2 text-label-2"
          >
            <MapPin size={18} />
          </span>
          <p className="min-w-0 flex-1 text-subhead">
            {job.address}
            {job.lat == null && (
              <span className="block text-footnote text-label-2">
                No map location
              </span>
            )}
          </p>
          {job.navHref && (
            <IconButton
              label="Directions"
              variant="secondary"
              size={36}
              href={job.navHref}
              external
            >
              <Navigation size={18} aria-hidden />
            </IconButton>
          )}
        </div>
        {job.notes && (
          <p className="whitespace-pre-line rounded-tile bg-fill-2 px-3 py-2.5 text-subhead">
            {job.notes}
          </p>
        )}
        <div className="flex items-center gap-3">
          {lead ? (
            <>
              <Avatar
                name={lead.name}
                seed={lead.id}
                src={lead.avatarUrl}
                color={lead.color}
                size={40}
              />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-headline">
                  <span
                    aria-hidden
                    className="sm-chipdot"
                    style={cvar(lead.color)}
                  />
                  {lead.name}
                </p>
                <p className="num truncate text-footnote text-label-2">
                  Stop {stop?.seq} of {stop?.of}
                  {others.length ? ` · with ${others.join(", ")}` : ""}
                </p>
              </div>
            </>
          ) : (
            <>
              <span
                aria-hidden
                className="flex size-10 shrink-0 items-center justify-center rounded-full text-label-2"
                style={{ boxShadow: `inset 0 0 0 1.5px ${GRAY}` }}
              >
                <UserRound size={18} />
              </span>
              <p className="min-w-0 flex-1 text-subhead text-label-2">
                No technician yet
              </p>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-[var(--sep)] pt-4 empty:hidden">
        {primaryAt === "end" && (
          <Button href={`/jobs/${job.id}`} transition="push" size="lg" block>
            Open job
          </Button>
        )}
        {!done && (canAssign || canReschedule) && (
          <div className="grid grid-cols-2 gap-2">
            {canAssign && (
              <Button
                variant="secondary"
                href={hubHrefForJob(job.id, date)}
                transition="push"
                block
                className={canReschedule ? undefined : "col-span-2"}
              >
                {job.techIds.length ? "Reassign" : "Assign"}
              </Button>
            )}
            {canReschedule && <RescheduleButton jobId={job.id} />}
          </div>
        )}
      </div>
    </article>
  );
}
