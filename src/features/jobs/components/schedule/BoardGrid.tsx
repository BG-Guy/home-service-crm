"use client";

import { CircleDollarSign, GripVertical, TriangleAlert } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  type DragEvent,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { formatDateKey, formatInTz, zonedParts } from "@/lib/time";
import { Avatar } from "@/ui/components/Avatar";
import { toast } from "@/ui/components/Toast";
import { cx } from "@/ui/cx";
import { haptic } from "@/ui/motion/haptics";
import { statusDef } from "@/ui/status";
import { TONE_VAR } from "@/ui/tone";
import { scheduleJob } from "../../actions";
import type { BoardData, BoardJob, BoardTech } from "../../schedule-queries";
import { techColor } from "./colors";

// Desktop schedule board (lazy chunk): day view = technician columns on a time
// grid; 3-day / week = day columns. Native HTML5 drag-and-drop (no library):
// drop on a tech column at a time to assign + schedule, on a day column to move
// the day. Unscheduled / on-hold cards in the rail drag onto the board too.
// `fill` (full screen, ScheduleBoard): the board takes the whole hub and scrolls
// both ways inside its card, under sticky tech / day headers and the time column;
// the queues rail shows from 1024 px.

const AssignSheet = dynamic(() => import("../AssignSheet"), { ssr: false });

const PX_PER_MIN = 1.1;
const SNAP = 15;
const UNASSIGNED = "__unassigned";

type ColorBy = "status" | "tech";

function jobColor(
  j: BoardJob,
  techs: Map<string, BoardTech>,
  by: ColorBy,
): string {
  if (by === "tech" && j.primaryTechId)
    return techColor(techs.get(j.primaryTechId), j.primaryTechId);
  return TONE_VAR[statusDef("job", j.status).tone];
}

function minutesOfDay(iso: string, tz: string): number {
  const p = zonedParts(new Date(iso), tz);
  return p.hour * 60 + p.minute;
}

const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Greedy lanes for overlapping blocks within one column. */
function lanes(
  items: { id: string; s: number; e: number }[],
): Map<string, { lane: number; of: number }> {
  const out = new Map<string, { lane: number; of: number }>();
  const sorted = [...items].sort((a, b) => a.s - b.s);
  let cluster: typeof sorted = [];
  let clusterEnd = -1;
  const flush = () => {
    const ends: number[] = [];
    const assigned: [string, number][] = [];
    for (const it of cluster) {
      let lane = ends.findIndex((e) => e <= it.s);
      if (lane === -1) {
        lane = ends.length;
        ends.push(it.e);
      } else ends[lane] = it.e;
      assigned.push([it.id, lane]);
    }
    for (const [id, lane] of assigned) out.set(id, { lane, of: ends.length });
    cluster = [];
  };
  for (const it of sorted) {
    if (cluster.length && it.s >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  if (cluster.length) flush();
  return out;
}

type Drag = { jobId: string; fromTech: string | null };

export default function BoardGrid({
  data,
  colorBy,
  fill = false,
}: {
  data: BoardData;
  colorBy: ColorBy;
  /** Full screen: fill the hub and scroll inside (sticky headers stick). */
  fill?: boolean;
}) {
  const [jobs, setJobs] = useState(data.jobs);
  const [queue, setQueue] = useState(data.unscheduled);
  useEffect(() => setJobs(data.jobs), [data.jobs]);
  useEffect(() => setQueue(data.unscheduled), [data.unscheduled]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<{
    col: string;
    min: number | null;
  } | null>(null);
  const [assign, setAssign] = useState<{
    jobId: string;
    date?: string;
    techId?: string;
  } | null>(null);
  const [, start] = useTransition();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const techMap = useMemo(
    () => new Map(data.techs.map((t) => [t.id, t])),
    [data.techs],
  );
  // The board and its rail; in full screen the hub's body is their box.
  const shell = cx("flex gap-4", fill && "h-full p-3 md:p-4");
  const scroller = cx(
    "card min-w-0 flex-1 overflow-x-auto p-0",
    fill && "h-full overflow-y-auto overscroll-contain",
  );
  const startMin = data.startHour * 60;
  const endMin = data.endHour * 60;
  const height = (endMin - startMin) * PX_PER_MIN;
  const hours = Array.from(
    { length: data.endHour - data.startHour },
    (_, i) => data.startHour + i,
  );
  const all = [...jobs, ...queue, ...data.onHold];
  const find = (id: string) => all.find((j) => j.id === id);

  const unassignedJobs = jobs.filter((j) => j.techIds.length === 0);
  const columns: { id: string; tech: BoardTech | null }[] = [
    ...data.techs.map((t) => ({ id: t.id, tech: t })),
    ...(unassignedJobs.length ? [{ id: UNASSIGNED, tech: null }] : []),
  ];

  // -------------------------------------------------------------- drop handling
  const commit = (
    job: BoardJob,
    patch: { date: string; start: string | null; techId: string | null },
  ) => {
    const minutes = job.minutes || 60;
    let assignees = job.assignees;
    if (patch.techId && patch.techId !== UNASSIGNED) {
      const from = drag?.fromTech;
      if (!assignees.length)
        assignees = [
          { userId: patch.techId, role: "primary", splitBps: 10000 },
        ];
      else if (!assignees.some((a) => a.userId === patch.techId))
        assignees = assignees.map((a) =>
          a.userId === (from ?? job.primaryTechId)
            ? { ...a, userId: patch.techId as string }
            : a,
        );
    }
    const changedTechs =
      JSON.stringify(assignees) !== JSON.stringify(job.assignees);
    const startHm =
      patch.start ??
      (job.start ? hhmm(minutesOfDay(job.start, data.tz)) : null);
    if (!startHm) {
      setAssign({
        jobId: job.id,
        date: patch.date,
        techId: patch.techId ?? undefined,
      });
      return;
    }
    // Optimistic move (server refresh replaces it).
    const prevJobs = jobs;
    const prevQueue = queue;
    const moved: BoardJob = {
      ...job,
      dayKey: patch.date,
      assignees,
      techIds: assignees.map((a) => a.userId),
      primaryTechId:
        assignees.find((a) => a.role === "primary")?.userId ?? null,
      warnings: [],
    };
    setQueue((q) => q.filter((j) => j.id !== job.id));
    setJobs((js) => [
      ...js.filter((j) => j.id !== job.id),
      { ...moved, start: null, end: null, __pendingStart: startHm } as BoardJob,
    ]);
    haptic();
    start(async () => {
      const r = await scheduleJob({
        jobId: job.id,
        date: patch.date,
        start: startHm,
        minutes,
        ...(changedTechs || job.techIds.length === 0 ? { assignees } : {}),
      });
      if (!r.ok) {
        setJobs(prevJobs);
        setQueue(prevQueue);
        toast.error(r.error);
        return;
      }
      toast.success(
        `${job.number} → ${formatDateKey(patch.date, "en-US", { weekday: "short", month: "short", day: "numeric" })} ${startHm}`,
      );
    });
  };

  const onDropTime = (
    e: DragEvent<HTMLElement>,
    colId: string,
    day: string,
  ) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain") || drag?.jobId;
    const job = id ? find(id) : undefined;
    setHover(null);
    setDrag(null);
    if (!job) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const raw = startMin + (e.clientY - rect.top) / PX_PER_MIN;
    const snapped = Math.max(
      startMin,
      Math.min(endMin - SNAP, Math.round(raw / SNAP) * SNAP),
    );
    if (colId === UNASSIGNED) {
      setAssign({ jobId: job.id, date: day });
      return;
    }
    commit(job, { date: day, start: hhmm(snapped), techId: colId });
  };

  const onDropDay = (e: DragEvent<HTMLElement>, day: string) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain") || drag?.jobId;
    const job = id ? find(id) : undefined;
    setHover(null);
    setDrag(null);
    if (!job) return;
    if (!job.start || job.techIds.length === 0) {
      setAssign({ jobId: job.id, date: day });
      return;
    }
    if (job.dayKey === day) return;
    commit(job, { date: day, start: null, techId: null });
  };

  const dragProps = (j: BoardJob, fromTech: string | null) => ({
    draggable: ![
      "completed",
      "closed",
      "cancelled",
      "en_route",
      "arrived",
      "in_progress",
    ].includes(j.status),
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData("text/plain", j.id);
      e.dataTransfer.effectAllowed = "move";
      setDrag({ jobId: j.id, fromTech });
    },
    onDragEnd: () => {
      setDrag(null);
      setHover(null);
    },
  });

  // -------------------------------------------------------------- pieces
  /** A job card. `withTechs`: who's on it, as avatar chips inside the card. */
  const card = (j: BoardJob, compact = false, withTechs = false) => {
    const color = jobColor(j, techMap, colorBy);
    // The left edge is always the lead tech's color (who's on it at a glance);
    // the soft fill follows "color by".
    const edge = j.primaryTechId
      ? techColor(techMap.get(j.primaryTechId), j.primaryTechId)
      : "var(--sys-orange)";
    const depositDue = j.deposit?.required && !j.deposit.paid;
    const pendingStart = (j as BoardJob & { __pendingStart?: string })
      .__pendingStart;
    return (
      <Link
        href={`/jobs/${j.id}`}
        title={[j.number, j.title, j.customerName, ...j.warnings].join(" · ")}
        className={cx(
          "group flex h-full min-h-0 flex-col overflow-hidden rounded-[12px] border-l-[4px] bg-[color-mix(in_srgb,var(--c)_13%,var(--card))] text-left transition-[transform,box-shadow] duration-200 ease-[var(--ease-spring)] hover:-translate-y-px hover:shadow-[var(--shadow-raised)]",
          fill ? "py-1 pr-1.5 pl-2" : "py-1.5 pr-2 pl-2.5",
          drag?.jobId === j.id && "opacity-40",
          pendingStart && "animate-pulse",
        )}
        style={{ "--c": color, borderLeftColor: edge } as React.CSSProperties}
      >
        <span className="flex items-center gap-1 text-caption font-semibold">
          <span className="num truncate">
            {pendingStart ??
              (j.start
                ? formatInTz(j.start, data.tz, {
                    hour: "numeric",
                    minute: "2-digit",
                  })
                : "")}
          </span>
          <span className="num truncate text-label-2">{j.number}</span>
          {j.warnings.length > 0 && (
            <TriangleAlert
              size={11}
              className="shrink-0 text-[var(--sys-orange)]"
              aria-label={j.warnings.join(", ")}
            />
          )}
          {depositDue && (
            <CircleDollarSign
              size={11}
              className="shrink-0 text-[var(--sys-orange)]"
              aria-label="Deposit due"
            />
          )}
        </span>
        {/* Full screen (narrow columns): the title takes two lines. */}
        <span
          className={cx(
            "text-footnote font-semibold",
            fill ? "line-clamp-2 break-words" : "truncate",
          )}
        >
          {j.title}
        </span>
        {!compact && (
          <span
            className={cx(
              "truncate text-label-2",
              fill ? "text-[11px] leading-[14px]" : "text-caption",
            )}
          >
            {j.customerName} · {j.addressShort}
          </span>
        )}
        {withTechs && j.techIds.length > 0 && (
          <span className="mt-1 flex min-w-0 flex-wrap gap-1">
            {j.techIds.slice(0, 2).map((t) => {
              const tech = techMap.get(t);
              const name = tech?.name ?? "";
              return (
                <span
                  key={t}
                  className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--card)_72%,transparent)] py-px pr-1.5 pl-px text-[11px] font-medium leading-4"
                >
                  <span aria-hidden className="flex">
                    <Avatar
                      name={name}
                      seed={t}
                      color={techColor(tech, t)}
                      size={16}
                    />
                  </span>
                  <span className="truncate">{name.split(" ")[0]}</span>
                </span>
              );
            })}
          </span>
        )}
      </Link>
    );
  };

  const nowMin = (() => {
    if (data.view !== "day" || data.date !== data.todayKey) return null;
    const m = minutesOfDay(new Date(now).toISOString(), data.tz);
    return m >= startMin && m <= endMin ? m : null;
  })();

  const rail = (
    <aside
      className={cx(
        "w-[260px] shrink-0 flex-col gap-4",
        // Full screen: the days get the width; the queues show from 1280 px.
        fill ? "hidden h-full overflow-y-auto xl:flex" : "flex",
      )}
      aria-label="Queues"
    >
      {[
        {
          key: "unscheduled",
          title: "Unscheduled",
          items: queue,
          hint: "Drag onto a technician",
        },
        {
          key: "hold",
          title: "On hold",
          items: data.onHold,
          hint: "Drag to book a return visit",
        },
        {
          key: "unconfirmed",
          title: "Unconfirmed tomorrow",
          items: data.unconfirmedTomorrow,
          hint: null,
        },
      ].map((g) => (
        <section key={g.key} className="flex flex-col gap-1.5">
          <h3 className="flex items-center justify-between px-1 text-headline">
            {g.title}
            <span className="num rounded-full bg-fill px-2 text-footnote font-semibold text-label-2">
              {g.items.length}
            </span>
          </h3>
          {g.items.length === 0 ? (
            <p className="px-1 text-footnote text-label-2">Nothing here.</p>
          ) : (
            <ul className="flex max-h-[40vh] flex-col gap-1.5 overflow-y-auto pr-1">
              {g.items.map((j) => (
                <li
                  key={j.id}
                  {...(g.key === "unconfirmed" ? {} : dragProps(j, null))}
                  className={cx(
                    "flex items-stretch gap-1",
                    g.key !== "unconfirmed" &&
                      "cursor-grab active:cursor-grabbing",
                  )}
                >
                  {g.key !== "unconfirmed" && (
                    <GripVertical
                      size={14}
                      className="mt-2 shrink-0 text-label-3"
                      aria-hidden
                    />
                  )}
                  <div className="min-w-0 flex-1">{card(j)}</div>
                </li>
              ))}
            </ul>
          )}
          {g.hint && g.items.length > 0 && (
            <p className="px-1 text-caption text-label-2">{g.hint}</p>
          )}
        </section>
      ))}
    </aside>
  );

  // -------------------------------------------------------------- day view
  if (data.view === "day") {
    return (
      <div className={shell}>
        <div className={scroller}>
          {/* Tech columns share the width (≥ 180 px each) instead of a fixed 180 px (QA T4-29). */}
          <div className="flex w-full min-w-max">
            <div className="sticky left-0 z-10 w-14 shrink-0 bg-card">
              <div className="sticky top-0 z-[1] h-12 border-b border-[var(--sep)] bg-card" />
              <div className="relative" style={{ height }}>
                {nowMin != null && (
                  <span
                    className="num absolute right-0.5 z-[4] -translate-y-1/2 rounded-pill bg-[var(--sys-red)] px-1.5 py-px text-[11px] font-bold text-white"
                    style={{ top: (nowMin - startMin) * PX_PER_MIN }}
                  >
                    {formatInTz(new Date(now).toISOString(), data.tz, {
                      hour: "numeric",
                      minute: "2-digit",
                    }).replace(/\s?[AP]M$/, "")}
                    <span className="sr-only"> now</span>
                  </span>
                )}
                {hours.map((h) => (
                  <span
                    key={h}
                    className={cx(
                      "num absolute right-1.5 text-caption text-label-2",
                      // The first label sits under its line so it isn't clipped.
                      h * 60 <= startMin
                        ? "translate-y-0.5"
                        : "-translate-y-1/2",
                    )}
                    style={{ top: (h * 60 - startMin) * PX_PER_MIN }}
                  >
                    {h === 0
                      ? "12 AM"
                      : h < 12
                        ? `${h} AM`
                        : h === 12
                          ? "12 PM"
                          : `${h - 12} PM`}
                  </span>
                ))}
              </div>
            </div>
            {columns.map(({ id, tech }) => {
              const colJobs = jobs.filter((j) =>
                id === UNASSIGNED
                  ? j.techIds.length === 0
                  : j.techIds.includes(id),
              );
              const blocks = colJobs
                .map((j) => {
                  const ps = (j as BoardJob & { __pendingStart?: string })
                    .__pendingStart;
                  const s = ps
                    ? Number(ps.slice(0, 2)) * 60 + Number(ps.slice(3))
                    : j.start
                      ? minutesOfDay(j.start, data.tz)
                      : null;
                  return s == null ? null : { j, s, e: s + (j.minutes || 60) };
                })
                .filter((b): b is { j: BoardJob; s: number; e: number } => !!b);
              const lane = lanes(
                blocks.map((b) => ({ id: b.j.id, s: b.s, e: b.e })),
              );
              const isHover = hover?.col === id;
              return (
                <div
                  key={id}
                  className="min-w-[180px] flex-1 basis-0 border-l border-[var(--sep)]"
                >
                  <div className="sticky top-0 z-[5] flex h-12 items-center gap-2 border-b border-[var(--sep)] bg-card px-2">
                    {tech ? (
                      <>
                        <Avatar
                          name={tech.name}
                          seed={tech.id}
                          size={26}
                          status={tech.clockedIn ? "online" : "offline"}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-subhead font-semibold">
                            {tech.name}
                          </span>
                          <span className="block text-caption text-label-2">
                            {colJobs.length} job
                            {colJobs.length === 1 ? "" : "s"}
                            {!tech.clockedIn && data.date === data.todayKey
                              ? " · off clock"
                              : ""}
                          </span>
                        </span>
                      </>
                    ) : (
                      <span className="text-subhead font-semibold text-[var(--sys-orange)]">
                        Unassigned
                      </span>
                    )}
                  </div>
                  <section
                    aria-label={tech ? `${tech.name}'s day` : "Unassigned"}
                    className={cx(
                      "relative transition-colors duration-150",
                      isHover &&
                        "bg-[color-mix(in_srgb,var(--accent)_6%,transparent)]",
                    )}
                    style={{
                      height,
                      backgroundImage: `repeating-linear-gradient(to bottom, var(--sep) 0, var(--sep) 0.5px, transparent 0.5px, transparent ${60 * PX_PER_MIN}px)`,
                    }}
                    onDragOver={(e) => {
                      if (!drag) return;
                      e.preventDefault();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const raw =
                        startMin + (e.clientY - rect.top) / PX_PER_MIN;
                      setHover({ col: id, min: Math.round(raw / SNAP) * SNAP });
                    }}
                    onDragLeave={() =>
                      setHover((h) => (h?.col === id ? null : h))
                    }
                    onDrop={(e) => onDropTime(e, id, data.date)}
                  >
                    {nowMin != null && (
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-x-0 z-[3] h-[2px] -translate-y-px bg-[var(--sys-red)]"
                        style={{ top: (nowMin - startMin) * PX_PER_MIN }}
                      />
                    )}
                    {isHover && hover?.min != null && (
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-x-1 z-[2] rounded-[6px] border border-dashed border-accent bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] px-1 text-caption text-accent"
                        style={{
                          top: (hover.min - startMin) * PX_PER_MIN,
                          height:
                            ((drag ? find(drag.jobId)?.minutes : 60) || 60) *
                            PX_PER_MIN,
                        }}
                      >
                        {hhmm(hover.min)}
                      </div>
                    )}
                    {blocks.map(({ j, s, e }) => {
                      const l = lane.get(j.id) ?? { lane: 0, of: 1 };
                      const top = Math.max(0, (s - startMin) * PX_PER_MIN);
                      const h = Math.max(
                        30,
                        (Math.min(e, endMin) - Math.max(s, startMin)) *
                          PX_PER_MIN -
                          2,
                      );
                      return (
                        <div
                          key={j.id}
                          {...dragProps(j, id === UNASSIGNED ? null : id)}
                          className="absolute cursor-grab p-[1px] active:cursor-grabbing"
                          style={{
                            top,
                            height: h,
                            left: `${(l.lane / l.of) * 100}%`,
                            width: `${100 / l.of}%`,
                          }}
                        >
                          {card(j, h < 52)}
                        </div>
                      );
                    })}
                  </section>
                </div>
              );
            })}
          </div>
        </div>
        {rail}
        {assign && (
          <AssignSheet
            jobId={assign.jobId}
            open
            initialDate={assign.date}
            initialTechId={assign.techId}
            onOpenChange={(o) => !o && setAssign(null)}
          />
        )}
      </div>
    );
  }

  // -------------------------------------------------------------- 3-day / week
  // Full screen: columns sized from the board's width (ScheduleBoard's
  // `.sb-grid`: about 7 days in view on a landscape tablet, 4 upright, 3.75 on a
  // landscape phone), days without jobs at half width, the rest scrolls sideways.
  const busy = new Set(jobs.map((j) => j.dayKey));
  const units = data.days.reduce((n, d) => n + (busy.has(d) ? 1 : 0.5), 0);
  return (
    <div className={shell}>
      <div className={cx(scroller, fill && "sb-cols")}>
        <div
          className={cx("grid", fill ? "sb-grid min-h-full" : "min-w-max")}
          style={
            fill
              ? {
                  gridTemplateColumns: data.days
                    .map((d) =>
                      busy.has(d)
                        ? "minmax(var(--col),1fr)"
                        : "minmax(calc(var(--col) * .5),.5fr)",
                    )
                    .join(" "),
                  minWidth: `calc(var(--col) * ${units})`,
                }
              : {
                  gridTemplateColumns: `repeat(${data.days.length}, minmax(150px, 1fr))`,
                }
          }
        >
          {data.days.map((day) => {
            const dayJobs = jobs
              .filter((j) => j.dayKey === day)
              .sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));
            const isToday = day === data.todayKey;
            return (
              <div
                key={day}
                className="flex min-h-[60vh] min-w-0 flex-col border-l border-[var(--sep)] first:border-l-0"
              >
                <div
                  className={cx(
                    "sticky top-0 z-[5] flex h-12 min-w-0 flex-col justify-center border-b border-[var(--sep)] bg-card px-2",
                    isToday && "text-accent",
                  )}
                >
                  <span className="truncate text-subhead font-semibold">
                    {/* Full screen: "Wed 21" (the month is in the top bar). */}
                    {fill
                      ? `${formatDateKey(day, "en-US", { weekday: "short" })} ${Number(day.slice(8))}`
                      : formatDateKey(day, "en-US", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        })}
                  </span>
                  <span className="text-caption text-label-2">
                    {dayJobs.length} job{dayJobs.length === 1 ? "" : "s"}
                  </span>
                </div>
                <section
                  aria-label={formatDateKey(day)}
                  className={cx(
                    "flex flex-1 flex-col gap-1.5 p-1.5 transition-colors duration-150",
                    hover?.col === day &&
                      "bg-[color-mix(in_srgb,var(--accent)_6%,transparent)]",
                  )}
                  onDragOver={(e) => {
                    if (!drag) return;
                    e.preventDefault();
                    setHover({ col: day, min: null });
                  }}
                  onDragLeave={() =>
                    setHover((h) => (h?.col === day ? null : h))
                  }
                  onDrop={(e) => onDropDay(e, day)}
                >
                  {dayJobs.map((j) => (
                    <div
                      key={j.id}
                      {...dragProps(j, j.primaryTechId)}
                      className="cursor-grab active:cursor-grabbing"
                    >
                      {card(j, false, true)}
                    </div>
                  ))}
                </section>
              </div>
            );
          })}
        </div>
      </div>
      {rail}
      {assign && (
        <AssignSheet
          jobId={assign.jobId}
          open
          initialDate={assign.date}
          initialTechId={assign.techId}
          onOpenChange={(o) => !o && setAssign(null)}
        />
      )}
    </div>
  );
}
