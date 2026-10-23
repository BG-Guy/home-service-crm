"use client";

import {
  CalendarClock,
  ClipboardCheck,
  MapPin,
  StickyNote,
  User,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/ui/components/Button";
import { IconButton } from "@/ui/components/IconButton";
import { Sheet } from "@/ui/components/Sheet";
import { Skeleton } from "@/ui/components/Skeleton";
import { Pill, StatusPill } from "@/ui/components/StatusPill";
import type { JobListItem } from "../types";
import { jobWindowLabel } from "./job-window";
import { fetchJobPeek, type JobPeek } from "./list-reads";

/**
 * The job card's peek (lazy chunk): the key facts at a glance in a bottom sheet
 * (centered on desktop), loaded on open; "Open job" goes to the full job page.
 * The card's own data shows at once while the rest loads.
 */
export default function JobPeekSheet({
  job,
  tz,
  onClose,
}: {
  job: JobListItem | null;
  tz: string;
  onClose(): void;
}) {
  const [peek, setPeek] = useState<JobPeek | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = job?.id ?? null;
  useEffect(() => {
    setPeek(null);
    setError(null);
    if (!id) return;
    let live = true;
    void fetchJobPeek(id).then((r) => {
      if (!live) return;
      if (r.ok) setPeek(r.data ?? null);
      else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [id]);

  const p = peek?.id === id ? peek : null;
  const title = p?.title ?? job?.title ?? "Job";
  const priority = p?.priority ?? job?.priority ?? "normal";
  const payment = p?.paymentStatus ?? job?.paymentStatus ?? "none";
  return (
    <Sheet
      open={!!job}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      label={`Job ${title}`}
      detents={["large"]}
      trailing={
        <IconButton
          label="Close"
          variant="secondary"
          size={30}
          onClick={onClose}
        >
          <X size={17} strokeWidth={2.5} />
        </IconButton>
      }
      bodyClassName="pt-1"
      footer={
        job ? (
          <Button href={`/jobs/${job.id}`} block size="lg">
            Open job
          </Button>
        ) : null
      }
    >
      {job && (
        <div className="flex flex-col gap-5 pb-2">
          <header className="flex flex-col gap-2">
            <h2 className="text-title2">{title}</h2>
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusPill
                kind="job"
                status={p?.status ?? job.status}
                live={false}
              />
              {payment !== "none" && (
                <StatusPill kind="jobPayment" status={payment} />
              )}
              {priority !== "normal" && (
                <Pill tone="red" dot={false}>
                  {priority === "emergency" ? "Emergency" : "Urgent"}
                </Pill>
              )}
              {p?.afterHours && (
                <Pill tone="gray" dot={false}>
                  After hours
                </Pill>
              )}
              {(p?.isCallback ?? job.isCallback) && (
                <Pill tone="orange" dot={false}>
                  Callback
                </Pill>
              )}
              <span className="num text-footnote text-label-3">
                {job.number}
              </span>
            </div>
          </header>

          <dl className="grid gap-3 sm:grid-cols-2">
            <Fact icon={<CalendarClock size={17} />} label="Arrives">
              {jobWindowLabel(
                p?.windowStart ?? job.windowStart,
                p?.windowEnd ?? job.windowEnd,
                tz,
                true,
              )}
              {p && !p.confirmed && (p.windowStart ?? job.windowStart) && (
                <span className="block text-footnote text-label-2">
                  Not confirmed yet
                </span>
              )}
              {p?.rescheduleRequested && (
                <span className="block text-footnote text-warning">
                  Asked to reschedule
                </span>
              )}
            </Fact>
            <Fact icon={<User size={17} />} label="Customer">
              {p?.customerName ?? job.customerName}
            </Fact>
            <Fact icon={<MapPin size={17} />} label="Address">
              {p?.address ??
                [job.addressShort, job.city].filter(Boolean).join(", ")}
            </Fact>
            <Fact icon={<Users size={17} />} label="Techs">
              {(p?.assignees ?? job.assignees.map((a) => a.name)).join(", ") ||
                "No tech yet"}
            </Fact>
            <Fact icon={<Wrench size={17} />} label="Job type">
              {p?.serviceTypeName ?? job.serviceTypeName ?? "—"}
            </Fact>
            {p && p.checklist.total > 0 && (
              <Fact icon={<ClipboardCheck size={17} />} label="Checklist">
                {p.checklist.done} of {p.checklist.total} done
              </Fact>
            )}
          </dl>

          {p?.holdReason && (
            <p className="rounded-tile bg-fill-2 px-3 py-2.5 text-subhead">
              On hold: {p.holdReason}
            </p>
          )}
          {p?.isCallback && p.callbackReason && (
            <p className="rounded-tile bg-fill-2 px-3 py-2.5 text-subhead">
              Callback: {p.callbackReason}
            </p>
          )}
          {(p?.customerNotes || p?.description) && (
            <section className="flex flex-col gap-2">
              <h3 className="flex items-center gap-1.5 text-footnote font-semibold text-label-2">
                <StickyNote size={15} aria-hidden /> Notes
              </h3>
              {p?.customerNotes && (
                <p className="whitespace-pre-line rounded-tile bg-fill-2 px-3 py-2.5 text-subhead">
                  {p.customerNotes}
                </p>
              )}
              {p?.description && (
                <p className="whitespace-pre-line text-subhead text-label-2">
                  {p.description}
                </p>
              )}
            </section>
          )}
          {!p && !error && <Skeleton className="h-16 rounded-tile" />}
          {error && <p className="text-subhead text-label-2">{error}</p>}
        </div>
      )}
    </Sheet>
  );
}

function Fact({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-tile bg-fill-2 px-3 py-2.5">
      <span aria-hidden className="mt-0.5 shrink-0 text-label-2">
        {icon}
      </span>
      <div className="min-w-0">
        <dt className="text-footnote text-label-2">{label}</dt>
        <dd className="text-subhead">{children}</dd>
      </div>
    </div>
  );
}
