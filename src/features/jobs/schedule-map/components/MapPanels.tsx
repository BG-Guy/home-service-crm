"use client";

import { ChevronLeft, ChevronRight, PanelLeft } from "lucide-react";
import type { CSSProperties } from "react";
import { Avatar } from "@/ui/components/Avatar";
import { Button } from "@/ui/components/Button";
import { IconButton } from "@/ui/components/IconButton";
import { compactWindow, plural, techLine } from "../route";
import type { SmDayLabels, SmJob, SmTech } from "../types";

// Panels of the schedule map view (client, no fetching): the day stepper, the
// tech list and job groups (left), the day summary (right, nothing selected),
// and the phone chips and stop list. The job details are JobDetails.tsx.

const cvar = (c: string) => ({ ["--c" as string]: c }) as CSSProperties;

/* ------------------------------------------------------------------ day bar */

export function DateBar({
  date,
  todayKey,
  labels,
  hrefFor,
  onPick,
  panel,
  onPanel,
}: {
  date: string;
  todayKey: string;
  labels: SmDayLabels;
  hrefFor: (date: string) => string;
  onPick: (date: string) => void;
  panel: boolean;
  onPanel: () => void;
}) {
  return (
    <div className="smap-bar flex items-center gap-2">
      <IconButton
        label={panel ? "Hide technicians" : "Show technicians"}
        variant="secondary"
        size={44}
        className="smap-panel-btn"
        aria-pressed={panel}
        onClick={onPanel}
      >
        <PanelLeft size={20} aria-hidden />
      </IconButton>
      <div className="card flex min-w-0 flex-1 items-center gap-1 p-1.5">
        <IconButton
          label="Previous day"
          variant="plain"
          size={40}
          href={hrefFor(labels.prev)}
        >
          <ChevronLeft size={20} aria-hidden />
        </IconButton>
        <label className="sm-date relative flex min-w-0 flex-1 flex-col items-center rounded-control px-2 py-1 text-center">
          <span className="truncate text-headline">{labels.day}</span>
          <span className="num text-footnote text-label-2">{labels.date}</span>
          <input
            type="date"
            aria-label="Pick a day"
            value={date}
            onChange={(e) => e.target.value && onPick(e.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
        <IconButton
          label="Next day"
          variant="plain"
          size={40}
          href={hrefFor(labels.next)}
        >
          <ChevronRight size={20} aria-hidden />
        </IconButton>
      </div>
      {date !== todayKey && (
        <Button href={hrefFor(todayKey)} variant="secondary" size="md">
          Today
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ left */

export function TechList({
  techs,
  iso,
  onTech,
}: {
  techs: readonly SmTech[];
  iso: string | null;
  onTech: (id: string) => void;
}) {
  return (
    <section aria-labelledby="sm-techs-h" className="flex flex-col gap-2">
      <h2 id="sm-techs-h" className="px-1 text-headline">
        Technicians
      </h2>
      {techs.length === 0 ? (
        <p className="card px-4 py-3 text-subhead text-label-2">
          No technicians yet.
        </p>
      ) : (
        <ul className="list-card">
          {techs.map((t) => (
            <li key={t.id} className="list-row" data-icon="">
              <button
                type="button"
                className="sm-row row-press flex min-h-[60px] w-full items-center gap-3 py-2 pl-2.5 pr-3 text-left outline-offset-[-2px]"
                aria-pressed={iso === t.id}
                title={
                  iso === t.id ? "Show every route" : `Show ${t.name}'s route`
                }
                onClick={() => onTech(t.id)}
                style={cvar(t.color)}
              >
                <span aria-hidden className="sm-swatch my-1" />
                <Avatar
                  name={t.name}
                  seed={t.id}
                  src={t.avatarUrl}
                  color={t.color}
                  size={34}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-subhead font-semibold">
                    {t.name}
                  </span>
                  <span className="num truncate text-footnote text-label-2">
                    {techLine(t)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function JobRowButton({
  j,
  color,
  seq,
  active,
  onSelect,
  meta,
}: {
  j: SmJob;
  color: string | null;
  seq: number | null;
  active: boolean;
  onSelect: (id: string) => void;
  meta?: string;
}) {
  return (
    <li className="list-row">
      <button
        type="button"
        className="sm-row row-press flex min-h-[52px] w-full items-center gap-2.5 px-3 py-2 text-left outline-offset-[-2px]"
        aria-current={active || undefined}
        onClick={() => onSelect(j.id)}
      >
        <span
          className="sm-when"
          data-un={color ? undefined : ""}
          style={color ? cvar(color) : undefined}
        >
          {seq != null ? `${seq} · ` : ""}
          {compactWindow(j.startMin, j.endMin)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-subhead font-semibold">
            {j.customerShort}
          </span>
          <span className="truncate text-footnote text-label-2">
            {meta ?? j.title}
          </span>
        </span>
      </button>
    </li>
  );
}

export function JobGroup({
  title,
  jobs,
  colorOf,
  seqOf,
  selected,
  onSelect,
  empty,
}: {
  title: string;
  jobs: readonly SmJob[];
  colorOf: (j: SmJob) => string | null;
  seqOf: (j: SmJob) => number | null;
  selected: string | null;
  onSelect: (id: string) => void;
  empty?: string;
}) {
  if (!jobs.length && !empty) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="px-1 text-subhead font-semibold text-label-2">
        {title} ({jobs.length})
      </h3>
      {jobs.length === 0 ? (
        <p className="px-1 text-footnote text-label-2">{empty}</p>
      ) : (
        <ul className="list-card">
          {jobs.map((j) => (
            <JobRowButton
              key={j.id}
              j={j}
              color={colorOf(j)}
              seq={seqOf(j)}
              active={selected === j.id}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ right */

export function DaySummary({
  labels,
  techs,
  jobCount,
  unassigned,
  selected,
  onSelect,
  onTech,
}: {
  labels: SmDayLabels;
  techs: readonly SmTech[];
  jobCount: number;
  unassigned: readonly SmJob[];
  selected: string | null;
  onSelect: (id: string) => void;
  onTech: (id: string) => void;
}) {
  const working = techs.filter((t) => t.jobIds.length > 0);
  const miles = Math.round(working.reduce((n, t) => n + t.miles, 0) * 10) / 10;
  const stats = [
    { label: "Jobs", value: String(jobCount) },
    { label: "Techs out", value: String(working.length) },
    { label: "Route miles", value: String(miles) },
  ];
  return (
    <section className="sm-card flex flex-col gap-4" aria-label="Day summary">
      <div>
        <h2 className="text-title3 font-bold">Day summary</h2>
        <p className="text-footnote text-label-2">
          {labels.day} · {labels.date}
        </p>
      </div>
      <dl className="grid grid-cols-3 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="rounded-tile bg-fill-2 px-3 py-2.5">
            <dt className="text-caption text-label-2">{s.label}</dt>
            <dd className="num text-title3 font-bold">{s.value}</dd>
          </div>
        ))}
      </dl>
      {jobCount === 0 ? (
        <p className="text-subhead text-label-2">
          Nothing booked this day. Jobs show up here with their routes once they
          have a time.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <h3 className="text-subhead font-semibold text-label-2">
              Jobs per tech
            </h3>
            {working.length === 0 ? (
              <p className="text-footnote text-label-2">
                Nobody has a job this day.
              </p>
            ) : (
              <ul className="flex flex-col">
                {working.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => onTech(t.id)}
                      className="sm-sumrow row-press flex items-center gap-2.5 rounded-control px-2 py-1.5 text-left"
                      style={cvar(t.color)}
                    >
                      <span aria-hidden className="sm-chipdot" />
                      <span className="min-w-0 flex-1 truncate text-subhead">
                        {t.name}
                      </span>
                      <span className="num shrink-0 text-footnote text-label-2">
                        {plural(t.jobIds.length, "job")}
                        {t.miles > 0 ? ` · ${t.miles} mi` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <h3 className="text-subhead font-semibold text-label-2">
              Unassigned ({unassigned.length})
            </h3>
            {unassigned.length === 0 ? (
              <p className="text-footnote text-label-2">
                Every job this day has a technician.
              </p>
            ) : (
              <ul className="list-card">
                {unassigned.map((j) => (
                  <JobRowButton
                    key={j.id}
                    j={j}
                    color={null}
                    seq={null}
                    active={selected === j.id}
                    onSelect={onSelect}
                  />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
      {jobCount > 0 && (
        <p className="text-footnote text-label-2">
          Pick a job on the map or the timeline for its details. ← and → step
          through a route; Esc closes.
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ phone */

// The tech chips (page row and full-screen bar) are the shared
// `jobs/components/TechChips`; the full-screen day arrows are the kit PeriodStepper.

export function StopsList({
  techs,
  jobs,
  iso,
  unassigned,
  noLocation,
  selected,
  onSelect,
  colorOf,
  seqOf,
}: {
  techs: readonly SmTech[];
  jobs: ReadonlyMap<string, SmJob>;
  iso: string | null;
  unassigned: readonly SmJob[];
  noLocation: readonly SmJob[];
  selected: string | null;
  onSelect: (id: string) => void;
  colorOf: (j: SmJob) => string | null;
  seqOf: (j: SmJob) => number | null;
}) {
  const shown = techs.filter(
    (t) => t.jobIds.length > 0 && (!iso || t.id === iso),
  );
  return (
    <div className="smap-list">
      {shown.length === 0 && unassigned.length === 0 && (
        <p className="card px-4 py-4 text-subhead text-label-2">
          Nothing booked this day.
        </p>
      )}
      {shown.map((t) => (
        <section
          key={t.id}
          aria-labelledby={`sm-t-${t.id}`}
          className="flex flex-col gap-2"
        >
          <div className="flex items-center gap-2.5 px-1" style={cvar(t.color)}>
            <span aria-hidden className="sm-chipdot" />
            <h2
              id={`sm-t-${t.id}`}
              className="min-w-0 flex-1 truncate text-headline"
            >
              {t.name}
            </h2>
            <span className="num shrink-0 text-footnote text-label-2">
              {techLine(t, false)}
            </span>
          </div>
          <ul className="list-card">
            {t.jobIds.map((id, i) => {
              const j = jobs.get(id);
              return j ? (
                <JobRowButton
                  key={id}
                  j={j}
                  color={t.color}
                  seq={i + 1}
                  active={selected === id}
                  onSelect={onSelect}
                  meta={`${j.title}${j.lat == null ? " · no location" : ""}`}
                />
              ) : null;
            })}
          </ul>
        </section>
      ))}
      {!iso && (
        <JobGroup
          title="Unassigned"
          jobs={unassigned}
          colorOf={colorOf}
          seqOf={seqOf}
          selected={selected}
          onSelect={onSelect}
        />
      )}
      {!iso && noLocation.length > 0 && (
        <p className="px-1 text-footnote text-label-2">
          {plural(noLocation.length, "job")} without a map location{" "}
          {noLocation.length === 1 ? "is" : "are"} marked “no location”.
        </p>
      )}
    </div>
  );
}
