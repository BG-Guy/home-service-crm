"use client";

import {
  CalendarX2,
  Check,
  ChevronRight,
  TriangleAlert,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { formatDateKey, formatInTz, formatTimeRange } from "@/lib/time";
import { Button, buttonClass } from "@/ui/components/Button";
import { Chip, ChipRow } from "@/ui/components/Chip";
import { EmptyState } from "@/ui/components/EmptyState";
import { IconButton } from "@/ui/components/IconButton";
import { ListSection } from "@/ui/components/List";
import { Skeleton } from "@/ui/components/Skeleton";
import { Pill, StatusPill } from "@/ui/components/StatusPill";
import { cx } from "@/ui/cx";
import {
  isDoneStatus,
  isLocated,
  planRoutes,
  type RoutePlan,
  routeLayers,
  techColor,
  UNASSIGNED_COLOR,
  unlocatedStops,
} from "../../route-plan";
import type { BoardData, BoardJob } from "../../schedule-queries";
import { AssignJobButton } from "../../slots.client";
import { StopBadge } from "./StopBadge";

// /schedule?layout=map (lazy chunk): one day's routes on a map. Numbered pins per tech
// in visit order and a dashed line joining them; grey "?" pins for unassigned jobs.
// Side panel on desktop (list under the map on phones): tech legend (tap = only that
// tech), then the stops grouped by tech with the pin numbers, then the jobs whose
// address isn't located yet. The list is the accessible equivalent of the map.

const RouteMap = dynamic(() => import("./RouteMap"), {
  ssr: false,
  loading: () => <Skeleton className="size-full" rounded="card" />,
});

const UNASSIGNED = "unassigned";
const DESKTOP = "(min-width: 1024px)";

export interface ScheduleMapProps {
  data: Pick<BoardData, "date" | "days" | "tz" | "techs" | "jobs">;
  canAssign: boolean;
  tileUrl: string;
  attribution: string;
  /** Viewer may set up integrations (sees how to turn the street map on). */
  canSetup: boolean;
  /** `?tech=` from the page: the board is already filtered to one tech. */
  techFilter: string | null;
  /** Clears `?tech=` (shown while `techFilter` is set). */
  allTechsHref: string | null;
}

const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const windowLabel = (j: BoardJob, tz: string) =>
  j.start
    ? j.end
      ? formatTimeRange(j.start, j.end, tz)
      : formatInTz(j.start, tz, { hour: "numeric", minute: "2-digit" })
    : "No time";

const dayChip = (d: string) =>
  `${formatDateKey(d, "en-US", { weekday: "short" })} ${Number(d.slice(8))}`;

const firstName = (name: string) => name.split(" ")[0] ?? name;

export default function ScheduleMap({
  data,
  canAssign,
  tileUrl,
  attribution,
  canSetup,
  techFilter,
  allTechsHref,
}: ScheduleMapProps) {
  const { tz } = data;
  const multi = data.days.length > 1;
  const anchor = data.days.includes(data.date)
    ? data.date
    : (data.days[0] ?? data.date);
  const rangeKey = `${data.days.join(",")}|${data.date}`;
  const [range, setRange] = useState(rangeKey);
  const [filter, setFilter] = useState(techFilter);
  const [day, setDay] = useState(anchor);
  const [focus, setFocus] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Prev / next / Today moved the range: back to its anchor day.
  if (range !== rangeKey) {
    setRange(rangeKey);
    setDay(anchor);
    setSelected(null);
  }
  // Another tech picked in the header: the legend's solo no longer applies.
  if (filter !== techFilter) {
    setFilter(techFilter);
    setFocus(null);
    setSelected(null);
  }

  const techById = useMemo(
    () => new Map(data.techs.map((t) => [t.id, t])),
    [data.techs],
  );
  const look = useMemo(
    () => ({
      color: (id: string) => techColor(techById.get(id)?.color, id),
      name: (id: string) => techById.get(id)?.name ?? "Technician",
    }),
    [techById],
  );
  const { color: colorOf, name: nameOf } = look;

  const dayJobs = useMemo(
    () => data.jobs.filter((j) => j.dayKey === day),
    [data.jobs, day],
  );
  // Only the board's techs get a route: with `?tech=`, a helper on one of that tech's
  // jobs would otherwise show a partial (misnumbered) route of their own.
  const plan = useMemo(() => {
    const p = planRoutes(
      dayJobs,
      data.techs.map((t) => t.id),
    );
    return { ...p, routes: p.routes.filter((r) => techById.has(r.techId)) };
  }, [dayJobs, data.techs, techById]);
  const shown: RoutePlan<BoardJob> = useMemo(
    () => ({
      routes:
        focus === UNASSIGNED
          ? []
          : plan.routes.filter((r) => !focus || r.techId === focus),
      unassigned: !focus || focus === UNASSIGNED ? plan.unassigned : [],
    }),
    [plan, focus],
  );
  const layers = useMemo(() => routeLayers(shown, look), [shown, look]);
  const offMap = useMemo(() => unlocatedStops(shown), [shown]);
  const shownIds = new Set([
    ...shown.routes.flatMap((r) => r.stops.map((s) => s.job.id)),
    ...shown.unassigned.map((j) => j.id),
  ]);
  const selJob =
    selected && shownIds.has(selected)
      ? (dayJobs.find((j) => j.id === selected) ?? null)
      : null;

  // Pin tapped → bring its row into view (desktop panel); row tapped → bring the map
  // into view (phones, where the list sits under the map).
  const mapBox = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const reveal = useRef<"row" | "map" | null>(null);
  // The pin or row that opened the card, to hand focus back when the card closes.
  const opener = useRef<HTMLElement | null>(null);
  const select = (id: string | null, from?: "map" | "list") => {
    reveal.current = from === "map" ? "row" : from === "list" ? "map" : null;
    if (id && from) {
      const el = document.activeElement;
      const inside =
        el instanceof HTMLElement &&
        (mapBox.current?.contains(el) || panel.current?.contains(el));
      opener.current = inside ? el : null;
    }
    setSelected(id);
  };
  // Escape / Close remove the focused button with the card: focus goes back to the
  // pin or row it came from (the stop's row when that pin is gone).
  const closeCard = () => {
    const id = selected;
    const back = opener.current;
    select(null);
    if (!id) return;
    requestAnimationFrame(() => {
      const row = panel.current?.querySelector<HTMLElement>(
        `[data-job="${CSS.escape(id)}"] > button`,
      );
      (back?.isConnected ? back : row)?.focus({ preventScroll: true });
    });
  };
  useEffect(() => {
    const want = reveal.current;
    reveal.current = null;
    if (!want || !selected) return;
    const desktop = window.matchMedia(DESKTOP).matches;
    const behavior: ScrollBehavior = reducedMotion() ? "auto" : "smooth";
    if (want === "row" && desktop)
      panel.current
        ?.querySelector<HTMLElement>(`[data-job="${CSS.escape(selected)}"]`)
        ?.scrollIntoView({ block: "nearest", behavior });
    if (want === "map" && !desktop) {
      const box = mapBox.current;
      const r = box?.getBoundingClientRect();
      if (box && r && (r.top < 0 || r.bottom > window.innerHeight))
        box.scrollIntoView({ block: "nearest", behavior });
    }
  }, [selected]);

  // Keep the chosen day chip in view (a week overflows a phone's chip row).
  const chips = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-center whenever the day changes
  useEffect(() => {
    const row = chips.current?.querySelector<HTMLElement>('[role="group"]');
    const chip = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!row || !chip) return;
    const r = row.getBoundingClientRect();
    const c = chip.getBoundingClientRect();
    row.scrollBy({
      left: c.left - r.left - (r.width - c.width) / 2,
      behavior: reducedMotion() ? "auto" : "smooth",
    });
  }, [day, multi]);

  const dayLabel = formatDateKey(day, "en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  const filteredName = techFilter ? techById.get(techFilter)?.name : undefined;
  const stopCount = shownIds.size;
  const free = focus
    ? []
    : data.techs.filter((t) => !plan.routes.some((r) => r.techId === t.id));
  const badgesFor = (job: BoardJob): ReactNode[] => {
    const own = shown.routes.flatMap((r) =>
      r.stops
        .filter((s) => s.job.id === job.id)
        .map((s) => (
          <StopBadge
            key={r.techId}
            label={String(s.n)}
            color={colorOf(r.techId)}
            done={isDoneStatus(job.status)}
            offMap={!isLocated(job)}
          />
        )),
    );
    return own.length
      ? own
      : [
          <StopBadge
            key="unassigned"
            label="?"
            color={UNASSIGNED_COLOR}
            offMap={!isLocated(job)}
          />,
        ];
  };
  const techNames = (job: BoardJob) =>
    job.techIds
      .map((id) => techById.get(id)?.name)
      .filter(Boolean)
      .join(", ");
  const row = (job: BoardJob, badges: ReactNode, key: string, who?: string) => (
    <StopRow
      key={key}
      job={job}
      tz={tz}
      badges={badges}
      who={who}
      active={selJob?.id === job.id}
      canAssign={canAssign}
      onPick={() => select(selJob?.id === job.id ? null : job.id, "list")}
    />
  );

  return (
    <div className="flex flex-col gap-3">
      {multi && (
        <div ref={chips}>
          <ChipRow label="Day to show on the map">
            {data.days.map((d) => {
              const n = data.jobs.filter((j) => j.dayKey === d).length;
              return (
                <Chip
                  key={d}
                  selected={d === day}
                  onClick={() => {
                    setDay(d);
                    select(null);
                  }}
                >
                  {dayChip(d)}{" "}
                  <span
                    className={cx(
                      "num text-footnote",
                      d === day ? "opacity-70" : "text-label-2",
                    )}
                  >
                    {n}
                    <span className="sr-only"> {n === 1 ? "job" : "jobs"}</span>
                  </span>
                </Chip>
              );
            })}
          </ChipRow>
        </div>
      )}
      {dayJobs.length === 0 ? (
        <div className="list-card">
          <EmptyState
            icon={<CalendarX2 size={40} strokeWidth={1.5} />}
            title="Nothing scheduled"
            message={`No jobs${filteredName ? ` for ${firstName(filteredName)}` : ""} on ${dayLabel}.${multi ? " Pick another day above." : ""}`}
            action={
              allTechsHref ? (
                <Link
                  href={allTechsHref}
                  replace
                  className={buttonClass({ variant: "gray", size: "sm" })}
                >
                  Show all techs
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div
          className={cx(
            "flex flex-col gap-4 lg:grid lg:min-h-[460px] lg:grid-cols-[minmax(0,1fr)_360px]",
            multi ? "lg:h-[calc(100dvh-268px)]" : "lg:h-[calc(100dvh-224px)]",
          )}
        >
          <div
            ref={mapBox}
            className="relative h-[55dvh] min-h-[300px] scroll-mt-16 overflow-hidden rounded-card bg-fill-2 shadow-card lg:h-full lg:min-h-0"
          >
            <RouteMap
              pins={layers.pins}
              lines={layers.lines}
              selectedJobId={selJob?.id ?? null}
              onSelect={(id) => select(id, "map")}
              fitKey={`${day}|${focus ?? ""}|${techFilter ?? ""}`}
              tileUrl={tileUrl}
              attribution={attribution}
              canSetup={canSetup}
              label={`Route map for ${dayLabel}: ${stopCount} ${stopCount === 1 ? "stop" : "stops"}. The list of stops follows the map.`}
              className="size-full"
            />
            {selJob && (
              <SelectedStop
                job={selJob}
                tz={tz}
                badges={badgesFor(selJob)}
                techs={techNames(selJob)}
                canAssign={canAssign}
                onClose={closeCard}
              />
            )}
            <p className="sr-only" aria-live="polite">
              {selJob ? `${selJob.number} selected on the map` : ""}
            </p>
          </div>

          <aside
            ref={panel}
            aria-label="Stops"
            className="flex min-h-0 flex-col gap-6 lg:overflow-y-auto lg:overscroll-contain lg:pb-2"
          >
            <ListSection
              header="Technicians"
              trailing={
                focus ? (
                  <button
                    type="button"
                    className="text-accent-text"
                    onClick={() => {
                      setFocus(null);
                      select(null);
                    }}
                  >
                    Show all
                  </button>
                ) : allTechsHref ? (
                  <Link
                    href={allTechsHref}
                    replace
                    className="text-accent-text"
                  >
                    All techs
                  </Link>
                ) : undefined
              }
              footer={
                plan.routes.length + (plan.unassigned.length ? 1 : 0) > 1
                  ? "Tap a technician to show only their route."
                  : undefined
              }
            >
              {plan.routes.map((r) => (
                <LegendRow
                  key={r.techId}
                  color={colorOf(r.techId)}
                  name={nameOf(r.techId)}
                  count={r.stops.length}
                  pressed={focus === r.techId}
                  dim={!!focus && focus !== r.techId}
                  onClick={() => {
                    setFocus(focus === r.techId ? null : r.techId);
                    select(null);
                  }}
                />
              ))}
              {plan.unassigned.length > 0 && (
                <LegendRow
                  color={UNASSIGNED_COLOR}
                  name="Unassigned"
                  count={plan.unassigned.length}
                  pressed={focus === UNASSIGNED}
                  dim={!!focus && focus !== UNASSIGNED}
                  onClick={() => {
                    setFocus(focus === UNASSIGNED ? null : UNASSIGNED);
                    select(null);
                  }}
                />
              )}
            </ListSection>

            {shown.routes.map((r) => {
              const located = r.stops.filter((s) => isLocated(s.job));
              if (located.length === 0) return null;
              const color = colorOf(r.techId);
              return (
                <ListSection
                  key={r.techId}
                  header={
                    <span className="flex items-center gap-2 normal-case">
                      <span
                        aria-hidden
                        className="size-2.5 rounded-full"
                        style={{ background: color }}
                      />
                      {nameOf(r.techId)}
                    </span>
                  }
                  trailing={
                    <span className="num text-footnote text-label-2">
                      {r.stops.length} {r.stops.length === 1 ? "stop" : "stops"}
                    </span>
                  }
                >
                  {located.map((s) =>
                    row(
                      s.job,
                      <StopBadge
                        label={String(s.n)}
                        color={color}
                        done={isDoneStatus(s.job.status)}
                      />,
                      s.job.id,
                    ),
                  )}
                </ListSection>
              );
            })}

            {shown.unassigned.some((j) => isLocated(j)) && (
              <ListSection header="Unassigned">
                {shown.unassigned
                  .filter((j) => isLocated(j))
                  .map((j) =>
                    row(
                      j,
                      <StopBadge label="?" color={UNASSIGNED_COLOR} />,
                      j.id,
                    ),
                  )}
              </ListSection>
            )}

            {offMap.length > 0 && (
              <ListSection
                header="Not on the map yet"
                footer={
                  offMap.some((u) => u.job.addressMasked)
                    ? "No pin until the address is located, or while the exact address is hidden before the visit."
                    : "These addresses haven’t been located, so they have no pin. Check the address on the job."
                }
              >
                {offMap.map((u) =>
                  row(
                    u.job,
                    badgesFor(u.job),
                    u.job.id,
                    u.stops
                      .map((s) => firstName(nameOf(s.techId)))
                      .join(", ") || "Unassigned",
                  ),
                )}
              </ListSection>
            )}

            {focus && stopCount === 0 && (
              <p className="px-4 text-subhead text-label-2">
                No stops for{" "}
                {focus === UNASSIGNED ? "unassigned jobs" : nameOf(focus)} on{" "}
                {dayLabel}.
              </p>
            )}
            {free.length > 0 && (
              <p className="px-4 text-footnote text-label-2">
                Free: {free.map((t) => firstName(t.name)).join(", ")}
              </p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function LegendRow({
  color,
  name,
  count,
  pressed,
  dim,
  onClick,
}: {
  color: string;
  name: string;
  count: number;
  pressed: boolean;
  dim: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cx(
        "list-row row-press flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left outline-offset-[-2px]",
        pressed && "bg-fill-2",
      )}
    >
      <span
        aria-hidden
        className={cx("size-3 shrink-0 rounded-full", dim && "opacity-40")}
        style={{ background: color }}
      />
      <span
        className={cx(
          "min-w-0 flex-1 truncate text-body",
          dim && "text-label-2",
        )}
      >
        {name}
      </span>
      <span className="num shrink-0 text-footnote text-label-2">
        {count} {count === 1 ? "stop" : "stops"}
      </span>
      <Check
        aria-hidden
        size={18}
        strokeWidth={2.75}
        className={cx("shrink-0 text-accent-text", !pressed && "invisible")}
      />
    </button>
  );
}

function StopRow({
  job,
  tz,
  badges,
  who,
  active,
  canAssign,
  onPick,
}: {
  job: BoardJob;
  tz: string;
  badges: ReactNode;
  /** Leads the detail line (tech names in the "not on the map" group). */
  who?: string;
  active: boolean;
  canAssign: boolean;
  onPick: () => void;
}) {
  return (
    <div
      data-job={job.id}
      className={cx(
        "list-row flex items-center gap-0.5 pr-2",
        active && "bg-fill-2",
      )}
    >
      <button
        type="button"
        aria-pressed={active}
        onClick={onPick}
        className="row-press flex min-h-[60px] min-w-0 flex-1 items-center gap-3 py-2 pl-4 text-left outline-offset-[-2px]"
      >
        <span className="flex shrink-0 -space-x-1.5">{badges}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className="num text-subhead font-semibold">
              {windowLabel(job, tz)}
            </span>
            <StatusPill kind="job" status={job.status} size="sm" />
            {job.priority !== "normal" && (
              <Pill
                tone={job.priority === "emergency" ? "red" : "orange"}
                size="sm"
              >
                {job.priority === "emergency" ? "Emergency" : "Urgent"}
              </Pill>
            )}
          </span>
          <span className="truncate text-body">
            <span className="num text-footnote text-label-2">{job.number}</span>{" "}
            {job.title}
          </span>
          <span className="truncate text-footnote text-label-2">
            {[who, job.customerName, job.addressShort]
              .filter(Boolean)
              .join(" · ")}
          </span>
          {job.warnings.length > 0 && (
            <span className="flex items-center gap-1 text-footnote text-[var(--sys-orange)]">
              <TriangleAlert size={12} aria-hidden className="shrink-0" />
              <span className="truncate">{job.warnings.join(" · ")}</span>
            </span>
          )}
        </span>
      </button>
      {canAssign && !isDoneStatus(job.status) && (
        <AssignJobButton
          jobId={job.id}
          label={`${job.techIds.length ? "Reassign" : "Assign"} ${job.number}`}
          iconOnly
        />
      )}
      <Link
        href={`/jobs/${job.id}`}
        transitionTypes={["nav-forward"]}
        aria-label={`Open ${job.number}`}
        title={`Open ${job.number}`}
        className="hit-44 flex size-9 shrink-0 items-center justify-center rounded-full text-label-3 outline-offset-2 hover:bg-fill-2"
      >
        <ChevronRight size={18} strokeWidth={2.5} aria-hidden />
      </Link>
    </div>
  );
}

function SelectedStop({
  job,
  tz,
  badges,
  techs,
  canAssign,
  onClose,
}: {
  job: BoardJob;
  tz: string;
  badges: ReactNode;
  techs: string;
  canAssign: boolean;
  onClose: () => void;
}) {
  return (
    <section
      aria-label={`Selected stop: ${job.number}`}
      onKeyDown={(e) => {
        // The assign sheet is a <dialog> inside this card: its Escape is its own.
        if (e.key === "Escape" && !(e.target as Element).closest("dialog"))
          onClose();
      }}
      // Floats over the map: the elevated surface keeps it apart from a tile-less map in dark mode.
      className="absolute inset-x-2 bottom-6 z-10 mx-auto max-w-md rounded-card bg-card p-3 shadow-[var(--shadow-float),0_0_0_0.5px_var(--sep)] dark:bg-card-2"
    >
      <div className="flex items-start gap-3">
        <span className="flex shrink-0 -space-x-1.5 pt-0.5">{badges}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-footnote text-label-2">
            <span className="num">{windowLabel(job, tz)}</span> ·{" "}
            {techs || "Unassigned"}
          </p>
          <p className="truncate text-headline">
            <span className="num font-normal text-label-2">{job.number}</span>{" "}
            {job.title}
          </p>
          <p className="truncate text-footnote text-label-2">
            {job.customerName} · {job.addressShort}
          </p>
        </div>
        <IconButton label="Close" variant="gray" size={30} onClick={onClose}>
          <X size={16} aria-hidden />
        </IconButton>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <StatusPill kind="job" status={job.status} size="sm" />
        <span className="ml-auto flex flex-wrap justify-end gap-2">
          {canAssign && !isDoneStatus(job.status) && (
            <AssignJobButton
              jobId={job.id}
              label={job.techIds.length ? "Reassign" : "Assign"}
            />
          )}
          <Button
            href={`/jobs/${job.id}`}
            transition="push"
            size="sm"
            variant="gray"
          >
            Open job
          </Button>
        </span>
      </div>
    </section>
  );
}
