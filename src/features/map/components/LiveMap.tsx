"use client";

import { Clock, MapPin, Navigation, Users } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AssignJobButton } from "@/features/jobs/slots.client";
import { formatTime } from "@/lib/time";
import { Avatar } from "@/ui/components/Avatar";
import { Button } from "@/ui/components/Button";
import { Chip, ChipRow } from "@/ui/components/Chip";
import { EmptyState } from "@/ui/components/EmptyState";
import { KeyValueList } from "@/ui/components/KeyValueList";
import { Sheet } from "@/ui/components/Sheet";
import { Skeleton } from "@/ui/components/Skeleton";
import { Pill, StatusPill } from "@/ui/components/StatusPill";
import { cx } from "@/ui/cx";
import type { LiveMapData, LiveTech } from "../contracts";
import {
  classifyStaleness,
  TECH_STATUS_LABEL,
  type TechMapStatus,
} from "../rules";
import type { MapTech } from "./TechMap";

const TechMap = dynamic(() => import("./TechMap"), {
  ssr: false,
  loading: () => <Skeleton className="size-full" rounded="card" />,
});

const STATUS_TONE: Record<TechMapStatus, "green" | "teal" | "orange" | "gray"> =
  {
    on_job: "green",
    en_route: "teal",
    idle: "orange",
    off: "gray",
  };

const PULSE_CSS = `@keyframes b7-pulse{0%{transform:scale(.9);opacity:.9}70%{transform:scale(1.35);opacity:0}100%{opacity:0}}
.tech-pulse{animation:b7-pulse 2.2s var(--ease-spring,ease-out) infinite}
@media (prefers-reduced-motion:reduce){.tech-pulse{animation:none;opacity:.5}}`;

function ago(iso: string, now: number): string {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

const time = (iso: string | null, tz: string) =>
  iso ? formatTime(iso, tz) : null;

/** /map: live tech positions, today's job pins, side list (desktop) / list under the map (mobile). */
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

  // Refresh positions every 60 s while the tab is visible (server re-renders the data).
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
  const order: Record<TechMapStatus, number> = {
    en_route: 0,
    on_job: 1,
    idle: 2,
    off: 3,
  };
  const sorted = [...techs].sort(
    (a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name),
  );
  const job =
    selected?.kind === "job"
      ? data.jobs.find((j) => j.id === selected.id)
      : undefined;
  const unassigned = data.jobs.filter(
    (j) =>
      j.techIds.length === 0 && !["completed", "closed"].includes(j.status),
  );

  return (
    <div className="flex flex-col gap-3 md:grid md:h-[calc(100dvh-140px)] md:grid-cols-[minmax(0,1fr)_340px] md:gap-4">
      <style href="b7-map-pulse" precedence="default">
        {PULSE_CSS}
      </style>
      <div className="relative h-[52dvh] overflow-hidden rounded-card shadow-card md:h-full">
        <TechMap
          techs={techs}
          jobs={data.jobs}
          selected={selected}
          onSelect={setSelected}
          tileUrl={data.tileUrl}
          attribution={data.attribution}
          canSetup={data.canSetup}
          className="size-full"
        />
      </div>
      <aside
        aria-label="Technicians"
        className="flex min-h-0 flex-col gap-3 md:overflow-y-auto"
      >
        <ChipRow label="Map filters">
          <Chip
            selected={showStale}
            onClick={() => setShowStale((v) => !v)}
            count={hiddenCount || undefined}
          >
            Show stale
          </Chip>
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
            <h2
              id="unassigned-h"
              className="px-4 text-footnote uppercase text-label-2"
            >
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
        <p className="px-4 text-footnote text-label-2">
          Positions come from the tech app while a tech is clocked in, plus
          status changes. Grey markers haven’t updated in {data.staleMinutes}{" "}
          min; older than {data.hideAfterMinutes} min are hidden.
        </p>
      </aside>

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
              <p className="text-subhead text-label-2">{job.customerName}</p>
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
              <Button href={`/jobs/${job.id}`} variant="gray">
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
  t: MapTech & LiveTech;
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
                t.staleness === "live" ? "text-label-2" : "text-label-3",
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
