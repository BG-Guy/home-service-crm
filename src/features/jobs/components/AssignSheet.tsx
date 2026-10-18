"use client";

import { CircleAlert, Star } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Avatar } from "@/ui/components/Avatar";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { DateField, Select, TimeField } from "@/ui/components/Field";
import { ListSection } from "@/ui/components/List";
import { Sheet } from "@/ui/components/Sheet";
import { Skeleton } from "@/ui/components/Skeleton";
import { Spinner } from "@/ui/components/Spinner";
import { Pill } from "@/ui/components/StatusPill";
import { Stepper } from "@/ui/components/Stepper";
import { toast } from "@/ui/components/Toast";
import { cx } from "@/ui/cx";
import { haptic } from "@/ui/motion/haptics";
import { scheduleJob } from "../actions";
import { loadAssignOptions } from "../dispatch-reads";
import type { AssignOptions } from "../types";
import { splitFor } from "./split";

// S9 assign sheet (lazy chunk): pick the day and arrival window, then techs with
// conflict hints (overlap, outside ZIPs, not clocked in, load that day) and the
// primary/helper split. Saves through the B2 `scheduleJob` action.

type Pick = { userId: string; role: "primary" | "helper" };

const fmtWindow = (m: number) =>
  m % 60 === 0 ? `${m / 60} h window` : `${m} min window`;

export default function AssignSheet({
  jobId,
  open,
  onOpenChange,
  initialDate,
  initialTechId,
}: {
  jobId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Prefill a day (schedule board drop on a day column). */
  initialDate?: string;
  /** Prefill a technician (board drop on a tech column). */
  initialTechId?: string;
}) {
  const [opts, setOpts] = useState<AssignOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [start, setStart] = useState("09:00");
  const [minutes, setMinutes] = useState(60);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [primaryPct, setPrimaryPct] = useState(50);
  const [dirty, setDirty] = useState(false);
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();

  // First load: the job's current window and assignees.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    startLoading(async () => {
      const r = await loadAssignOptions({ jobId });
      if (!alive) return;
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const d = r.data as AssignOptions;
      setOpts(d);
      setDate(d.date ?? "");
      setStart(d.start ?? "09:00");
      setMinutes(d.minutes);
      const current = d.assignees.map((a) => ({
        userId: a.userId,
        role: a.role,
      }));
      if (initialTechId && !current.some((a) => a.userId === initialTechId))
        current.unshift({
          userId: initialTechId,
          role: current.length ? "helper" : "primary",
        });
      setPicks(current);
      if (initialDate) setDate(initialDate);
      const p = d.assignees.find((a) => a.role === "primary");
      if (p && d.assignees.length > 1)
        setPrimaryPct(Math.round(p.splitBps / 100));
      setDirty(!!initialDate || !!initialTechId);
    });
    return () => {
      alive = false;
    };
  }, [open, jobId, initialDate, initialTechId]);

  // Re-check conflicts when the proposed window changes. Keyed on whether the
  // options have loaded, not on `opts` itself: the result updates `opts`, which
  // would re-run this effect and poll the server forever.
  const loaded = opts != null;
  useEffect(() => {
    if (!open || !loaded || !dirty || !date || !start) return;
    const t = setTimeout(() => {
      startLoading(async () => {
        const r = await loadAssignOptions({ jobId, date, start, minutes });
        if (r.ok && r.data)
          setOpts((o) => (o ? { ...o, techs: r.data?.techs ?? o.techs } : o));
      });
    }, 250);
    return () => clearTimeout(t);
  }, [open, jobId, date, start, minutes, dirty, loaded]);

  const windowLengths = useMemo(() => {
    const set = new Set([...(opts?.windowLengths ?? [60, 120, 240]), minutes]);
    return [...set].sort((a, b) => a - b);
  }, [opts?.windowLengths, minutes]);

  const toggle = (userId: string) => {
    haptic();
    setDirty(true);
    setPicks((cur) => {
      if (cur.some((p) => p.userId === userId)) {
        const next = cur.filter((p) => p.userId !== userId);
        if (next.length && !next.some((p) => p.role === "primary"))
          next[0] = { ...(next[0] as Pick), role: "primary" };
        return next;
      }
      return [
        ...cur,
        { userId, role: cur.length === 0 ? "primary" : "helper" },
      ];
    });
  };
  const makePrimary = (userId: string) => {
    haptic();
    setDirty(true);
    setPicks((cur) =>
      cur.map((p) => ({
        ...p,
        role: p.userId === userId ? "primary" : "helper",
      })),
    );
  };

  const assignees = splitFor(picks, primaryPct);
  const conflicts = (opts?.techs ?? []).filter(
    (t) => picks.some((p) => p.userId === t.userId) && t.conflicts.length > 0,
  );

  const save = (unschedule = false) =>
    startSaving(async () => {
      const r = await scheduleJob({
        jobId,
        ...(unschedule
          ? { unschedule: true }
          : date
            ? { date, start, minutes }
            : {}),
        assignees,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      haptic();
      toast.success(
        unschedule
          ? "Moved to unscheduled"
          : picks.length === 0
            ? "Saved — no technician assigned"
            : r.data?.status === "scheduled" || r.data?.status === "confirmed"
              ? "Scheduled"
              : "Saved",
      );
      onOpenChange(false);
    });

  const title = opts ? `Assign ${opts.number}` : "Assign";
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      dirty={dirty}
      desktop="panel"
      leading={
        <Button variant="plain" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
      }
      footer={
        <div className="flex flex-col gap-2">
          {conflicts.length > 0 && (
            <p className="flex items-center gap-1.5 text-footnote text-[var(--sys-orange)]">
              <CircleAlert size={14} aria-hidden />
              {conflicts
                .map(
                  (c) => `${c.name.split(" ")[0]}: ${c.conflicts.join(", ")}`,
                )
                .join(" · ")}
            </p>
          )}
          <Button
            size="lg"
            fullWidth
            loading={saving}
            disabled={!opts}
            onClick={() => save(false)}
          >
            {picks.length === 0
              ? "Save"
              : date
                ? "Assign & schedule"
                : "Assign"}
          </Button>
        </div>
      }
    >
      {error ? (
        <div className="px-4 pb-4">
          <Banner tone="error">{error}</Banner>
        </div>
      ) : !opts ? (
        <div className="flex flex-col gap-3 px-4 pb-6">
          <Skeleton height={44} rounded="control" />
          <Skeleton height={44} rounded="control" />
          <Skeleton height={180} rounded="card" />
        </div>
      ) : (
        <div className="flex flex-col gap-[var(--section-gap)] pb-6">
          <div className="px-4">
            <p className="truncate text-subhead text-label-2">{opts.title}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 px-4">
            <DateField
              label="Date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setDirty(true);
              }}
            />
            <TimeField
              label="Arrive from"
              value={start}
              step={900}
              onChange={(e) => {
                setStart(e.target.value);
                setDirty(true);
              }}
            />
            <Select
              label="Arrival window"
              className="col-span-2"
              value={String(minutes)}
              onChange={(e) => {
                setMinutes(Number(e.target.value));
                setDirty(true);
              }}
              options={windowLengths.map((m) => ({
                value: String(m),
                label: fmtWindow(m),
              }))}
            />
          </div>

          <ListSection
            header={
              <span className="flex items-center gap-2">
                Technicians {loading && <Spinner size={12} />}
              </span>
            }
            footer={
              picks.length === 0
                ? "Pick at least one technician to schedule the job."
                : "Tap a name to add or remove. The star marks the primary tech."
            }
          >
            {opts.techs.length === 0 && (
              <p className="px-4 py-3 text-subhead text-label-2">
                No active technicians yet.
              </p>
            )}
            {opts.techs.map((t) => {
              const pick = picks.find((p) => p.userId === t.userId);
              const hints = [
                ...t.conflicts,
                t.outsideZip ? "Outside service ZIPs" : null,
                !t.clockedIn ? "Not clocked in" : null,
                t.jobsThatDay
                  ? `${t.jobsThatDay} job${t.jobsThatDay === 1 ? "" : "s"} that day`
                  : "Free that day",
              ].filter(Boolean) as string[];
              return (
                <div
                  key={t.userId}
                  className="list-row flex min-h-[60px] items-center gap-3 pl-4 pr-2"
                >
                  <button
                    type="button"
                    aria-pressed={!!pick}
                    onClick={() => toggle(t.userId)}
                    className="row-press flex min-w-0 flex-1 items-center gap-3 py-2 text-left outline-offset-[-2px]"
                  >
                    <Avatar name={t.name} seed={t.userId} size={36} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-body">{t.name}</span>
                      <span
                        className={cx(
                          "truncate text-footnote",
                          t.conflicts.length
                            ? "text-[var(--sys-red)]"
                            : "text-label-2",
                        )}
                      >
                        {hints.join(" · ")}
                      </span>
                    </span>
                    <span
                      aria-hidden
                      className={cx(
                        "flex size-6 shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors duration-200",
                        pick
                          ? "border-transparent bg-accent text-on-accent"
                          : "border-label-3",
                      )}
                    >
                      {pick && (
                        <svg
                          viewBox="0 0 12 12"
                          className="size-3"
                          aria-hidden="true"
                        >
                          <path
                            d="M2.5 6.2 5 8.5l4.5-5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </span>
                  </button>
                  {pick && picks.length > 1 && (
                    <button
                      type="button"
                      onClick={() => makePrimary(t.userId)}
                      aria-label={
                        pick.role === "primary"
                          ? `${t.name} is primary`
                          : `Make ${t.name} primary`
                      }
                      aria-pressed={pick.role === "primary"}
                      className="flex size-11 shrink-0 items-center justify-center rounded-full text-label-2 active:bg-fill"
                    >
                      <Star
                        size={18}
                        className={
                          pick.role === "primary"
                            ? "fill-[var(--sys-yellow)] text-[var(--sys-yellow)]"
                            : ""
                        }
                      />
                    </button>
                  )}
                </div>
              );
            })}
          </ListSection>

          {picks.length > 1 && (
            <ListSection
              header="Commission split"
              footer="Helpers share the rest evenly."
            >
              <div className="list-row flex min-h-11 items-center justify-between gap-3 px-4 py-2">
                <span className="text-body">Primary share</span>
                <Stepper
                  label="Primary share"
                  value={primaryPct}
                  min={10}
                  max={90}
                  step={5}
                  format={(n) => `${n}%`}
                  onChange={(n) => {
                    setPrimaryPct(n);
                    setDirty(true);
                  }}
                />
              </div>
              <div className="flex flex-wrap gap-1.5 px-4 pb-3">
                {assignees.map((a) => {
                  const t = opts.techs.find((x) => x.userId === a.userId);
                  return (
                    <Pill
                      key={a.userId}
                      tone={a.role === "primary" ? "accent" : "gray"}
                      size="sm"
                    >
                      {t?.name.split(" ")[0] ?? "Tech"}{" "}
                      {Math.round(a.splitBps / 100)}%
                    </Pill>
                  );
                })}
              </div>
            </ListSection>
          )}

          {(opts.status === "scheduled" || opts.status === "confirmed") && (
            <div className="px-4">
              <Button
                variant="plain"
                size="sm"
                disabled={saving}
                onClick={() => save(true)}
              >
                Move back to unscheduled
              </Button>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
