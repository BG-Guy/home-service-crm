"use client";

import { Clock, MapPin, Navigation, Users } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AssignJobButton } from "@/features/jobs/components/AssignJobButton";
import { Avatar } from "@/ui/components/Avatar";
import { Button } from "@/ui/components/Button";
import { Chip, ChipRow } from "@/ui/components/Chip";
import { EmptyState } from "@/ui/components/EmptyState";
import { FullscreenHub } from "@/ui/components/FullscreenHub";
import { KeyValueList } from "@/ui/components/KeyValueList";
import { Sheet } from "@/ui/components/Sheet";
import { Skeleton } from "@/ui/components/Skeleton";
import { Pill, StatusPill } from "@/ui/components/StatusPill";
import { cx } from "@/ui/cx";
import type { LiveMapData } from "../contracts";
import { classifyStaleness, TECH_STATUS_LABEL } from "../rules";
import { ago, STATUS_ORDER, STATUS_TONE, time } from "./live-format";
import type { MapTech } from "./TechMap";
import { LiveClock, WallLegend } from "./WallMode";

const TechMap = dynamic(() => import("./TechMap"), {
  ssr: false,
  loading: () => <Skeleton className="size-full" rounded="card" />,
});

// Route-local CSS: the wall-mode layout (legend beside the map on a wide screen,
// a strip of cards under it on a tall one) and Leaflet's controls on the surface
// tokens (so they turn dark with the wall's dark theme). Marker CSS is TechMap's.
const MAP_CSS = `.lm-wall{position:absolute;inset:0;display:flex;flex-direction:column-reverse}
.lm-map{position:relative;flex:1 1 auto;min-width:0;min-height:0;isolation:isolate}
.lm-map .leaflet-bar{border:0;box-shadow:var(--shadow-raised)}
.lm-map .leaflet-bar a{background:var(--card);color:var(--label);border-bottom-color:var(--sep)}
.lm-map .leaflet-container .leaflet-control-attribution{background:color-mix(in srgb,var(--card) 82%,transparent);color:var(--label-2)}
.lm-map .leaflet-control-attribution a{color:var(--accent-text)}
.lm-legend{flex:none;display:flex;flex-direction:column;gap:8px;min-width:0;padding:10px 0 12px;background:var(--bar);-webkit-backdrop-filter:saturate(180%) blur(24px);backdrop-filter:saturate(180%) blur(24px);box-shadow:0 -.5px 0 var(--sep)}
.lm-legend-h{display:none;align-items:baseline;justify-content:space-between;gap:8px;padding:0 4px;font-size:20px;line-height:25px;font-weight:700}
.lm-cards{display:flex;gap:8px;overflow-x:auto;overscroll-behavior:contain;scroll-snap-type:x mandatory;scroll-padding:0 12px;padding:0 12px;scrollbar-width:none}
.lm-item{flex:none;width:min(288px,82vw);scroll-snap-align:start}
.lm-card{position:relative;display:flex;width:100%;height:100%;align-items:center;gap:12px;padding:10px 12px 10px 16px;overflow:hidden;border-radius:16px;background:var(--card);box-shadow:var(--shadow-card);text-align:left}
.lm-card[aria-pressed=true]{box-shadow:0 0 0 2px var(--c),var(--shadow-card)}
.lm-swatch{position:absolute;left:0;top:0;bottom:0;width:5px;background:var(--c)}
@media (min-aspect-ratio:1/1) and (min-width:640px){
.lm-wall{flex-direction:row}
.lm-legend{width:clamp(280px,27vw,380px);padding:16px 12px;overflow-y:auto;overscroll-behavior:contain;box-shadow:.5px 0 0 var(--sep)}
.lm-legend-h{display:flex}
.lm-cards{flex-direction:column;overflow:visible;scroll-snap-type:none;padding:0}
.lm-item{width:auto}
}`;

/** /map: live tech positions, today's job pins, side list (desktop) / list under
 * the map (mobile). The map has a wall mode for an office TV or a tablet (dark,
 * full screen, legend and clock): the header's "Wall mode" button or the map's
 * corner Expand. */
export function LiveMap({ data }: { data: LiveMapData }) {
  const router = useRouter();
  // The server's "now" until mount, so "Last seen 3 min ago" and the stale filter
  // hydrate identically (QA2 T2); the effect below re-stamps it on mount.
  const [now, setNow] = useState(() => Date.parse(data.generatedAt));
  const [showStale, setShowStale] = useState(false);
  const [selected, setSelected] = useState<{
    kind: "tech" | "job";
    id: string;
  } | null>(null);
  const [wall, setWall] = useState(false);
  // Re-frames the map at its new size on entering and after leaving wall mode.
  const [fitKey, setFitKey] = useState(0);

  // Refresh positions every 60 s while the tab is visible (server re-renders the
  // data). Wall mode keeps the same refresh: the map stays mounted.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      setNow(Date.now());
      router.refresh();
    };
    const t = setInterval(tick, 60_000);
    const vis = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", vis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [router]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-stamp "now" whenever the server sends fresh data
  useEffect(() => setNow(Date.now()), [data.generatedAt]);

  const techs: MapTech[] = useMemo(
    () =>
      data.techs.map((t) => {
        const s = t.location
          ? classifyStaleness(
              t.location.recordedAt,
              new Date(now),
              data.staleMinutes,
              data.hideAfterMinutes,
            )
          : "hidden";
        return {
          ...t,
          staleness: showStale && s === "hidden" && t.location ? "stale" : s,
        };
      }),
    [data, now, showStale],
  );
  const hiddenCount = data.techs.filter(
    (t) =>
      t.location &&
      classifyStaleness(
        t.location.recordedAt,
        new Date(now),
        data.staleMinutes,
        data.hideAfterMinutes,
      ) === "hidden",
  ).length;
  const sorted = [...techs].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      a.name.localeCompare(b.name),
  );
  const onShift = techs.filter((t) => t.clockedIn).length;
  const job =
    selected?.kind === "job"
      ? data.jobs.find((j) => j.id === selected.id)
      : undefined;
  const unassigned = data.jobs.filter(
    (j) =>
      j.techIds.length === 0 && !["completed", "closed"].includes(j.status),
  );
  const staleChip = (
    <Chip
      selected={showStale}
      onClick={() => setShowStale((v) => !v)}
      count={hiddenCount || undefined}
    >
      Show stale
    </Chip>
  );

  return (
    // Phone: the map is full-bleed and sticky; the list below is a bottom
    // sheet that slides up over it as the page scrolls (no JS, no drag code).
    // Desktop: map on the left, the list as a side panel.
    <div className="flex flex-col md:grid md:h-[calc(100dvh-140px)] md:grid-cols-[minmax(0,1fr)_360px] md:gap-4">
      <style href="b7-map" precedence="default">
        {MAP_CSS}
      </style>
      <div className="sticky top-[var(--sticky-top,calc(env(safe-area-inset-top)+44px))] -mx-[var(--gutter)] h-[56dvh] overflow-hidden md:relative md:top-0 md:mx-0 md:h-full md:rounded-card md:shadow-card">
        {/* Wall mode (DESIGN.md M19): every size, dark, browser full screen. */}
        <FullscreenHub
          historyKey="wall"
          title="Live map"
          subtitle={`${onShift} of ${techs.length} techs on shift · ${data.jobs.length} jobs today`}
          breakpoint="all"
          theme="dark"
          browserFullscreen
          expandLabel="Full screen map"
          closeLabel="Exit wall mode"
          className="size-full"
          onOpenChange={(o) => {
            setWall(o);
            if (o) setFitKey((k) => k + 1);
          }}
          onExit={() => setFitKey((k) => k + 1)}
          controls={
            <>
              {wall && <LiveClock tz={data.timeZone} />}
              {staleChip}
            </>
          }
        >
          <div className="lm-wall">
            {wall && (
              <WallLegend
                techs={sorted}
                now={now}
                selected={selected?.kind === "tech" ? selected.id : null}
                onPick={(id) => setSelected({ kind: "tech", id })}
              />
            )}
            <div className="lm-map">
              <TechMap
                techs={techs}
                jobs={data.jobs}
                selected={selected}
                onSelect={setSelected}
                tileUrl={data.tileUrl}
                attribution={data.attribution}
                canSetup={data.canSetup}
                wall={wall}
                fitKey={fitKey}
                className="size-full"
              />
            </div>
          </div>
          {/* In the hub's subtree: over wall mode it takes the dark surface. */}
          <Sheet
            open={!!job}
            onOpenChange={(o) => !o && setSelected(null)}
            title={job ? `${job.number}` : ""}
            detents={["medium", "large"]}
            desktop="panel"
          >
            {job && (
              <div className="flex flex-col gap-4 pb-4 pt-1">
                <div className="flex flex-col gap-1">
                  <p className="text-headline">{job.title}</p>
                  <p className="text-subhead text-label-2">
                    {job.customerName}
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <StatusPill kind="job" status={job.status} size="sm" />
                  </div>
                </div>
                <KeyValueList
                  card
                  items={[
                    { label: "Address", value: job.address },
                    {
                      label: "Window",
                      value:
                        [
                          time(job.windowStart, data.timeZone),
                          time(job.windowEnd, data.timeZone),
                        ]
                          .filter(Boolean)
                          .join(" – ") || "Not scheduled",
                    },
                    {
                      label: "Tech",
                      value: job.techNames.join(", ") || "Unassigned",
                    },
                    ...(job.etaAt
                      ? [
                          {
                            label: "ETA",
                            value: time(job.etaAt, data.timeZone) ?? "",
                          },
                        ]
                      : []),
                  ]}
                />
                <div className="flex flex-wrap gap-2">
                  {data.canAssign &&
                    !["completed", "closed"].includes(job.status) && (
                      <AssignJobButton
                        jobId={job.id}
                        label={job.techIds.length ? "Reassign" : "Assign"}
                      />
                    )}
                  <Button href={`/jobs/${job.id}`} variant="secondary">
                    Open job
                  </Button>
                  {job.lat != null && job.lng != null && (
                    <Button
                      href={`https://maps.apple.com/?daddr=${job.lat},${job.lng}`}
                      variant="plain"
                      icon={<Navigation size={16} aria-hidden />}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Directions
                    </Button>
                  )}
                </div>
              </div>
            )}
          </Sheet>
        </FullscreenHub>
      </div>
      <aside
        aria-label="Technicians and jobs"
        className="relative z-[1] -mx-[var(--gutter)] -mt-6 flex min-h-[55dvh] flex-col gap-3 rounded-t-[24px] bg-bg px-[var(--gutter)] pt-2 pb-4 shadow-[0_-10px_30px_rgb(0_0_0/0.14),0_-0.5px_0_var(--hairline)] md:mx-0 md:mt-0 md:min-h-0 md:overflow-y-auto md:rounded-none md:bg-transparent md:px-0 md:pt-0 md:shadow-none"
      >
        <span
          aria-hidden
          className="mx-auto mb-1 block h-[5px] w-9 shrink-0 rounded-full bg-fill md:hidden"
        />
        <div className="flex items-baseline justify-between gap-3 px-1">
          <h2 className="text-title3">Technicians</h2>
          <span className="num text-subhead text-label-2">
            {onShift} of {techs.length} on shift
          </span>
        </div>
        <ChipRow label="Map filters">
          {staleChip}
          <Chip href="/schedule" icon={<Clock size={14} aria-hidden />}>
            Schedule
          </Chip>
        </ChipRow>
        {sorted.length === 0 ? (
          <div className="list-card">
            <EmptyState
              compact
              icon={<Users size={32} strokeWidth={1.5} />}
              title="No technicians yet"
            />
          </div>
        ) : (
          <ul className="list-card">
            {sorted.map((t) => (
              <TechRow
                key={t.id}
                t={t}
                now={now}
                tz={data.timeZone}
                active={selected?.kind === "tech" && selected.id === t.id}
                onPick={() => setSelected({ kind: "tech", id: t.id })}
                onJob={(id) => setSelected({ kind: "job", id })}
              />
            ))}
          </ul>
        )}
        {unassigned.length > 0 && (
          <section
            aria-labelledby="unassigned-h"
            className="flex flex-col gap-1.5"
          >
            <h2 id="unassigned-h" className="px-1 pt-2 text-title3">
              Unassigned today
            </h2>
            <ul className="list-card">
              {unassigned.map((j) => (
                <li key={j.id} className="list-row">
                  <button
                    type="button"
                    onClick={() => setSelected({ kind: "job", id: j.id })}
                    className="row-press flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-fill-2"
                  >
                    <MapPin
                      aria-hidden
                      size={18}
                      className="shrink-0 text-label-2"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body">
                        {j.number} · {j.title}
                      </span>
                      <span className="block truncate text-footnote text-label-2">
                        {[time(j.windowStart, data.timeZone), j.address]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="px-1 text-footnote text-label-2">
          Positions come from the tech app while a tech is clocked in, plus
          status changes. Grey markers haven’t updated in {data.staleMinutes}{" "}
          min; older than {data.hideAfterMinutes} min are hidden.
        </p>
      </aside>
    </div>
  );
}

function TechRow({
  t,
  now,
  tz,
  active,
  onPick,
  onJob,
}: {
  t: MapTech;
  now: number;
  tz: string;
  active: boolean;
  onPick: () => void;
  onJob: (id: string) => void;
}) {
  const job = t.currentJob ?? t.nextJob;
  return (
    <li className={cx("list-row", active && "bg-fill-2")}>
      <div className="flex items-start gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onPick}
          className="shrink-0 rounded-full"
          aria-label={`Show ${t.name} on the map`}
          disabled={!t.location}
        >
          <Avatar
            name={t.name}
            seed={t.id}
            size={40}
            ring={STATUS_TONE[t.status]}
            className={cx(t.staleness !== "live" && "opacity-50 grayscale")}
          />
        </button>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onPick}
            className="block w-full text-left"
            disabled={!t.location}
          >
            <span className="flex items-center gap-1.5">
              <span className="truncate text-body font-medium">{t.name}</span>
              <Pill tone={STATUS_TONE[t.status]} size="sm">
                {TECH_STATUS_LABEL[t.status]}
              </Pill>
            </span>
            <span
              className={cx(
                "block text-footnote",
                t.staleness === "live" ? "text-label-2" : "text-label-2 italic",
              )}
            >
              {t.location
                ? `Last seen ${ago(t.location.recordedAt, now)}`
                : "No location yet"}
            </span>
          </button>
          {job && (
            <button
              type="button"
              onClick={() => onJob(job.id)}
              className="mt-1.5 flex w-full items-center gap-2 rounded-[10px] bg-fill-2 px-2.5 py-1.5 text-left"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-footnote font-medium">
                  {t.currentJob ? "Now" : "Next"}: {job.number} · {job.title}
                </span>
                <span className="block truncate text-caption text-label-2">
                  {[time(job.windowStart, tz), job.address]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              {t.etaMinutes != null && t.status !== "on_job" && (
                <Pill tone="teal" size="sm">
                  ~{t.etaMinutes} min
                </Pill>
              )}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
