"use client";

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { FullscreenHub } from "@/ui/components/FullscreenHub";
import { PeriodStepper } from "@/ui/components/PeriodStepper";
import { SegmentedControl } from "@/ui/components/SegmentedControl";
import { TechChips } from "../../components/TechChips";
import {
  compactWindow,
  type DayRel,
  jobPhase,
  neighborStop,
  routePoints,
  stopIndex,
  stTokens,
} from "../route";
import type { ScheduleMapData, SmJob, SmSelection } from "../types";
import { DayTimeline } from "./DayTimeline";
import type { CanvasRoute, CanvasStop } from "./MapCanvas";
import {
  DateBar,
  DaySummary,
  JobGroup,
  StopsList,
  TechList,
} from "./MapPanels";
import { SMAP_CSS } from "./map-css";

// Schedule map view (/schedule?view=map, client). The server sends the whole day
// (techs, routes, jobs); this component owns the selection: a job (`?job=`) and an
// isolated tech (`?tech=`), mirrored to the URL with history.pushState, so a click
// is instant, back / forward work and nothing round-trips to the server. Layout by
// the view's own width (map-css.ts): desktop = techs | map + timeline | details;
// tablet = collapsible techs | map + timeline, details in a drawer; phone = map,
// tech chips, timeline and the stops, details in a bottom sheet. Leaflet loads in
// a lazy chunk (MapCanvas), only in this view. Below 1200 px the map and the
// timeline each open full screen (FullscreenHub, ?fs=map / ?fs=timeline); there
// the details use the kit Sheet and a selection replaces the history entry, so
// back leaves full screen in one step.

const MapCanvas = dynamic(() => import("./MapCanvas"), {
  ssr: false,
  loading: () => <div aria-hidden className="sm-canvas shimmer" />,
});
const JobSheet = dynamic(() => import("./JobSheet"), { ssr: false });
// Details: their own chunk, preloaded once the view is idle (instant first click).
const loadDetails = () => import("./JobDetails");
const JobDetails = dynamic(() => loadDetails().then((m) => m.JobDetails), {
  loading: () => (
    <div aria-hidden className="sm-card skeleton" style={{ height: 384 }} />
  ),
});

type Layout = "phone" | "tablet" | "desktop";
const GRAY = "var(--sys-gray)";

export function ScheduleMapView({ data }: { data: ScheduleMapData }) {
  const router = useRouter();
  const sp = useSearchParams();
  const root = useRef<HTMLDivElement>(null);

  const jobs = useMemo(
    () => new Map(data.jobs.map((j) => [j.id, j])),
    [data.jobs],
  );
  const techs = useMemo(
    () => new Map(data.techs.map((t) => [t.id, t])),
    [data.techs],
  );
  const idx = useMemo(
    () => stopIndex(data.techs, data.jobs),
    [data.techs, data.jobs],
  );

  // Selection: local state for instant clicks; the URL is the source of truth
  // for back / forward and a new day (pushState syncs useSearchParams).
  const urlJob = sp.get("job");
  const urlTech = sp.get("tech");
  const validSel = (job: string | null, tech: string | null): SmSelection => ({
    job: job && jobs.has(job) ? job : null,
    tech: tech && techs.has(tech) ? tech : null,
  });
  const [sel, setSel] = useState<SmSelection>(() => validSel(urlJob, urlTech));
  // biome-ignore lint/correctness/useExhaustiveDependencies: validSel reads the same maps
  useEffect(() => {
    const v = validSel(urlJob, urlTech);
    setSel((cur) => (cur.job === v.job && cur.tech === v.tech ? cur : v));
  }, [urlJob, urlTech, jobs, techs]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [panel, setPanel] = useState(true);
  const [fsMap, setFsMap] = useState(false);
  const [fsTl, setFsTl] = useState(false);
  const [fsStrip, setFsStrip] = useState(false);
  const [tlZoom, setTlZoom] = useState<"fit" | "zoom">("fit");
  const fs = fsMap || fsTl;
  // Sheets present as a right drawer here (the kit's desktop presentation).
  const [wide, setWide] = useState(false);

  const [layout, setLayout] = useState<Layout | null>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const idle = window.requestIdleCallback ?? ((cb) => setTimeout(cb, 300));
    idle(() => void loadDetails());
    const ro = new ResizeObserver(([e]) => {
      const w = e?.contentRect.width ?? 0;
      if (w) setLayout(w < 640 ? "phone" : w < 1060 ? "tablet" : "desktop");
      setWide(matchMedia("(min-width: 768px), (pointer: fine)").matches);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The clock (today only): the server's minute first, so hydration matches.
  const isToday = data.date === data.todayKey;
  const [now, setNow] = useState(data.nowMin);
  useEffect(() => {
    setNow(data.nowMin);
    if (!isToday) return;
    const tick = () =>
      setNow(data.nowMin + Math.floor((Date.now() - data.renderedAt) / 60_000));
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, [data.nowMin, data.renderedAt, isToday]);
  const rel: DayRel =
    data.date < data.todayKey ? "past" : isToday ? "today" : "future";
  const phases = useMemo(
    () => new Map(data.jobs.map((j) => [j.id, jobPhase(j, now, rel)])),
    [data.jobs, now, rel],
  );
  // M12: at most two live pulses on screen (the earliest live stops).
  const pulse = useMemo(
    () =>
      new Set(
        data.jobs
          .filter((j) => phases.get(j.id)?.live)
          .slice(0, 2)
          .map((j) => j.id),
      ),
    [data.jobs, phases],
  );

  const colorOf = (j: SmJob) => {
    const r = idx.get(j.id);
    return r ? (techs.get(r.techId)?.color ?? null) : null;
  };
  const seqOf = (j: SmJob) => idx.get(j.id)?.seq ?? null;
  const seqFor = (jobId: string, techId: string) => {
    const i = techs.get(techId)?.jobIds.indexOf(jobId) ?? -1;
    return i >= 0 ? i + 1 : null;
  };

  const stops = useMemo<CanvasStop[]>(
    () =>
      data.jobs.flatMap((j) => {
        if (j.lat == null || j.lng == null) return [];
        const r = idx.get(j.id);
        const t = r ? techs.get(r.techId) : undefined;
        const ph = phases.get(j.id);
        const win = compactWindow(j.startMin, j.endMin);
        return [
          {
            id: j.id,
            lat: j.lat,
            lng: j.lng,
            color: t?.color ?? GRAY,
            seq: r?.seq ?? null,
            win,
            name: j.customerShort,
            techId: r?.techId ?? null,
            st: stTokens(ph),
            label: `${t && r ? `${t.name}, stop ${r.seq} of ${r.of}` : "Unassigned"}: ${win}, ${j.customerShort}, ${j.title}${ph?.late ? ", late" : ""}${ph?.done ? ", done" : ""}`,
            startMin: j.startMin,
          },
        ];
      }),
    [data.jobs, idx, techs, phases],
  );
  const routes = useMemo<CanvasRoute[]>(
    () =>
      data.techs.flatMap((t) => {
        if (!t.jobIds.length) return [];
        const pts = routePoints(
          t.start,
          t.jobIds.map((id) => jobs.get(id) ?? { lat: null, lng: null }),
        );
        if (pts.length === 0) return [];
        return [
          {
            techId: t.id,
            name: t.name,
            color: t.color,
            start: t.start,
            points: pts.map((p) => [p.lat, p.lng] as [number, number]),
          },
        ];
      }),
    [data.techs, jobs],
  );
  const homes = useMemo(
    () =>
      data.techs.flatMap((t) =>
        t.start ? [[t.start.lat, t.start.lng] as [number, number]] : [],
      ),
    [data.techs],
  );
  const unassigned = useMemo(
    () => data.jobs.filter((j) => j.techIds.length === 0),
    [data.jobs],
  );
  // Chips for the techs who work that day (isolate one route; "All" shows every one).
  const chips = useMemo(
    () =>
      data.techs
        .filter((t) => t.jobIds.length > 0)
        .map((t) => ({
          id: t.id,
          name: t.name,
          color: t.color,
          count: t.jobIds.length,
        })),
    [data.techs],
  );
  const noLocation = useMemo(
    () => data.jobs.filter((j) => j.lat == null || j.lng == null),
    [data.jobs],
  );

  const job = sel.job ? (jobs.get(sel.job) ?? null) : null;
  const lastJob = useRef<SmJob | null>(null);
  if (job) lastJob.current = job;
  const stop = job ? idx.get(job.id) : undefined;
  const focusTech = job ? (stop?.techId ?? null) : sel.tech;

  const hrefFor = (s: SmSelection, date = data.date) => {
    const q = new URLSearchParams({ view: "map", date });
    if (s.tech) q.set("tech", s.tech);
    if (s.job) q.set("job", s.job);
    return `/schedule?${q.toString()}`;
  };
  const select = (next: SmSelection) => {
    if (next.job === sel.job && next.tech === sel.tech) return;
    setSel(next);
    if (!fs) {
      history.pushState(null, "", hrefFor(next));
      return;
    }
    // Full screen: replace (keeping ?fs=), so back exits full screen at once.
    const url = new URL(hrefFor(next), location.origin);
    const key = new URLSearchParams(location.search).get("fs");
    if (key) url.searchParams.set("fs", key);
    history.replaceState(null, "", url.pathname + url.search);
  };
  const selectJob = (id: string | null) => select({ job: id, tech: sel.tech });
  // Full screen: another day replaces the entry and drops ?fs= on purpose, so
  // closing then pops nothing (DESIGN.md M19 rules).
  const fsDay = (d: string) =>
    router.replace(hrefFor({ job: null, tech: sel.tech }, d), {
      scroll: false,
    });
  const toggleTech = (id: string | null) => {
    const tech = id && sel.tech !== id ? id : null;
    const keep =
      sel.job && (!tech || techs.get(tech)?.jobIds.includes(sel.job))
        ? sel.job
        : null;
    select({ job: keep, tech });
  };

  // ← / → step through the route of the selected job (or the isolated tech, or
  // the whole day in time order); Esc closes the details, then the isolation.
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  onKey.current = (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest("input, textarea, select, [contenteditable='true']")) return;
    if (document.querySelector("dialog[open]")) return;
    if (e.key === "Escape") {
      if (sel.job) selectJob(null);
      else if (sel.tech) toggleTech(null);
      else return;
      e.preventDefault();
      return;
    }
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const techId =
      sel.job && sel.tech && techs.get(sel.tech)?.jobIds.includes(sel.job)
        ? sel.tech
        : sel.job
          ? (idx.get(sel.job)?.techId ?? null)
          : sel.tech;
    const order = techId
      ? (techs.get(techId)?.jobIds ?? [])
      : data.jobs.map((j) => j.id);
    const next = neighborStop(order, sel.job, e.key === "ArrowRight" ? 1 : -1);
    e.preventDefault();
    if (next && next !== sel.job) select({ job: next, tech: sel.tech });
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => onKey.current(e);
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, []);

  // Tablet: an open job folds the tech panel away so the drawer leaves room for
  // the map; closing the job brings the panel back (unless the user moved it).
  const prevJob = useRef<string | null>(sel.job);
  const autoFolded = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only on a job change
  useEffect(() => {
    const was = prevJob.current;
    prevJob.current = sel.job;
    if (layout !== "tablet" || fs) return;
    if (sel.job && !was && panel) {
      autoFolded.current = true;
      setPanel(false);
    } else if (!sel.job && was && autoFolded.current) {
      autoFolded.current = false;
      setPanel(true);
    }
  }, [sel.job, layout]);

  // Phone and full screen: the details open in the kit Sheet (lazy; it stays
  // mounted to animate out): a bottom sheet on phones, a right drawer elsewhere.
  const sheetMode = layout === "phone" || fs;
  const drawer = sheetMode && wide;
  const [sheetOn, setSheetOn] = useState(false);
  useEffect(() => {
    if (sheetMode && job) setSheetOn(true);
  }, [sheetMode, job]);

  const details = (
    j: SmJob,
    onClose?: () => void,
    primaryAt: "end" | "top" = "end",
  ) => (
    <JobDetails
      job={j}
      phase={phases.get(j.id)}
      stop={idx.get(j.id)}
      techs={techs}
      date={data.date}
      dateLabel={data.labels.short}
      canAssign={data.canAssign}
      canReschedule={data.canReschedule}
      onClose={onClose}
      primaryAt={primaryAt}
    />
  );
  const timeline = (size: "md" | "lg") => (
    <DayTimeline
      zoom={tlZoom}
      techs={data.techs}
      jobs={jobs}
      startMin={data.dayStartMin}
      endMin={data.dayEndMin}
      nowMin={isToday ? now : null}
      seqOf={seqFor}
      phases={phases}
      selected={sel.job}
      hovered={hovered}
      iso={sel.tech}
      onSelect={(id) => selectJob(id)}
      onHover={setHovered}
      size={size}
    />
  );
  const drawerJob = layout === "tablet" ? (job ?? lastJob.current) : job;
  const sheetJob = job ?? lastJob.current;

  return (
    <div
      ref={root}
      className="smap"
      data-panel={panel ? "" : undefined}
      data-sel={job ? "" : undefined}
    >
      <style href="schedule-map" precedence="default">
        {SMAP_CSS}
      </style>
      <div className="smap-grid">
        <DateBar
          date={data.date}
          todayKey={data.todayKey}
          labels={data.labels}
          hrefFor={(d) => hrefFor({ job: null, tech: sel.tech }, d)}
          onPick={(d) =>
            router.push(hrefFor({ job: null, tech: sel.tech }, d), {
              scroll: false,
            })
          }
          panel={panel}
          onPanel={() => {
            autoFolded.current = false;
            setPanel((v) => !v);
          }}
        />
        <aside className="smap-left" aria-label="Technicians and jobs">
          <div className="sm-scroll">
            <TechList techs={data.techs} iso={sel.tech} onTech={toggleTech} />
            <JobGroup
              title="Unassigned"
              jobs={unassigned}
              colorOf={colorOf}
              seqOf={seqOf}
              selected={sel.job}
              onSelect={selectJob}
            />
            <JobGroup
              title="No location"
              jobs={noLocation}
              colorOf={colorOf}
              seqOf={seqOf}
              selected={sel.job}
              onSelect={selectJob}
            />
          </div>
        </aside>
        <FullscreenHub
          className="smap-map"
          bodyClassName="smap-fsbody"
          historyKey="map"
          title={`${data.labels.short} · Map`}
          expandLabel="Full screen map"
          onOpenChange={setFsMap}
          controls={
            <>
              {/* Day arrows replace the entry without ?fs= (a new day). */}
              <PeriodStepper
                prevLabel="Previous day"
                nextLabel="Next day"
                onPrev={() => fsDay(data.labels.prev)}
                onNext={() => fsDay(data.labels.next)}
              >
                {data.labels.day === "Today"
                  ? `Today · ${data.labels.date}`
                  : data.labels.short}
              </PeriodStepper>
              <TechChips
                bare
                all
                items={chips}
                value={sel.tech}
                onChange={toggleTech}
                label="Show one technician's route"
              />
            </>
          }
        >
          <div className="smap-mapwrap">
            {data.jobs.length === 0 && (
              <p className="sm-empty">
                <span className="rounded-full bg-card px-3 py-1 text-footnote text-label-2 shadow-card">
                  Nothing booked{" "}
                  {data.labels.day === "Today" ? "today" : "this day"}
                </span>
              </p>
            )}
            <MapCanvas
              stops={stops}
              routes={routes}
              selected={sel.job}
              hovered={hovered}
              iso={sel.tech}
              focusTech={focusTech}
              pulse={pulse}
              fitKey={`${data.date}|${sel.tech ?? ""}`}
              homes={homes}
              padRight={
                job
                  ? drawer
                    ? 464
                    : !sheetMode && layout === "tablet"
                      ? 368
                      : 0
                  : 0
              }
              coverBottom={job && sheetMode && !wide ? 0.5 : 0}
              tileUrl={data.tileUrl}
              attribution={data.attribution}
              setupHref={data.setupHref}
              onSelect={selectJob}
              onIso={(id) => toggleTech(id)}
              onHover={setHovered}
            />
          </div>
          {fsMap && (
            <div className="smap-fstl">
              <button
                type="button"
                className="smap-fshandle"
                aria-expanded={fsStrip}
                onClick={() => setFsStrip((v) => !v)}
              >
                <span aria-hidden className="smap-grip" />
                {fsStrip ? "Hide timeline" : "Timeline"}
              </button>
              {fsStrip && (
                <div className="smap-fstl-body">{timeline("md")}</div>
              )}
            </div>
          )}
        </FullscreenHub>
        <TechChips
          all
          items={chips}
          value={sel.tech}
          onChange={toggleTech}
          label="Show one technician's route"
          className="smap-chips"
        />
        <FullscreenHub
          className="smap-tl"
          historyKey="timeline"
          title={`${data.labels.short} · Timeline`}
          expandLabel="Full screen timeline"
          corner="top-left"
          orientationHint="landscape"
          onOpenChange={(o) => {
            setFsTl(o);
            // Zoom in where the whole day would be cramped (a phone held upright).
            if (o) {
              const label =
                innerWidth > innerHeight && innerWidth >= 600 ? 176 : 100;
              const hours = (data.dayEndMin - data.dayStartMin) / 60;
              setTlZoom((innerWidth - label) / hours >= 48 ? "fit" : "zoom");
            }
          }}
          controls={
            <SegmentedControl
              label="Timeline scale"
              value={tlZoom}
              onChange={setTlZoom}
              className="w-44"
              segments={[
                { value: "fit", label: "Fit day" },
                { value: "zoom", label: "Zoom" },
              ]}
            />
          }
        >
          {timeline(fsTl ? "lg" : "md")}
        </FullscreenHub>
        <StopsList
          techs={data.techs}
          jobs={jobs}
          iso={sel.tech}
          unassigned={unassigned}
          noLocation={noLocation}
          selected={sel.job}
          onSelect={selectJob}
          colorOf={colorOf}
          seqOf={seqOf}
        />
        <aside className="smap-right" aria-label="Details">
          <div className="sm-scroll">
            {sheetMode ? null : drawerJob ? (
              details(drawerJob, () => selectJob(null))
            ) : (
              <DaySummary
                labels={data.labels}
                techs={data.techs}
                jobCount={data.jobs.length}
                unassigned={unassigned}
                selected={sel.job}
                onSelect={selectJob}
                onTech={toggleTech}
              />
            )}
          </div>
        </aside>
      </div>
      {sheetOn && sheetJob && (
        <JobSheet
          open={sheetMode && !!job}
          title={sheetJob.number}
          drawer
          onClose={() => selectJob(null)}
        >
          {details(sheetJob, undefined, "top")}
        </JobSheet>
      )}
    </div>
  );
}
