"use client";

import { type CSSProperties, useEffect, useState } from "react";
import { formatTime } from "@/lib/time";
import { Avatar } from "@/ui/components/Avatar";
import { Pill } from "@/ui/components/StatusPill";
import { cx } from "@/ui/cx";
import { TECH_STATUS_LABEL } from "../rules";
import { ago, STATUS_TONE } from "./live-format";
import type { MapTech } from "./TechMap";

// Wall mode of the live map (/map, FullscreenHub "wall"): the legend of techs and
// the clock. Everything is on screen (no hover): an office TV is read from across
// the room. Layout CSS is LiveMap's (`.lm-*`): a column beside the map when the
// screen is wide, a strip of cards under it when it is tall.

/** The company-zone time to the minute, for the top bar. Client-only. */
export function LiveClock({ tz }: { tz: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    let t = 0;
    const tick = () => {
      setNow(Date.now());
      t = window.setTimeout(tick, 60_050 - (Date.now() % 60_000));
    };
    tick();
    return () => clearTimeout(t);
  }, []);
  return (
    <time
      className="num flex-none whitespace-nowrap px-1 text-title3 md:text-title2"
      dateTime={now ? new Date(now).toISOString() : undefined}
    >
      {now ? formatTime(now, tz) : ""}
    </time>
  );
}

/** Every tech: color, avatar with the status ring, status, last ping, the job. */
export function WallLegend({
  techs,
  now,
  selected,
  onPick,
}: {
  /** In list order (on the way, working, idle, off). */
  techs: readonly MapTech[];
  now: number;
  selected: string | null;
  onPick: (id: string) => void;
}) {
  const onShift = techs.filter((t) => t.clockedIn).length;
  return (
    <section aria-labelledby="lm-legend-h" className="lm-legend">
      <h2 id="lm-legend-h" className="lm-legend-h">
        Technicians
        <span className="num text-subhead font-normal text-label-2">
          {onShift} of {techs.length} on shift
        </span>
      </h2>
      {techs.length === 0 ? (
        <p className="px-1 text-subhead text-label-2">No technicians yet.</p>
      ) : (
        <ul className="lm-cards">
          {techs.map((t) => (
            <WallCard
              key={t.id}
              t={t}
              now={now}
              on={selected === t.id}
              onPick={() => onPick(t.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function WallCard({
  t,
  now,
  on,
  onPick,
}: {
  t: MapTech;
  now: number;
  on: boolean;
  onPick: () => void;
}) {
  const job = t.currentJob ?? t.nextJob;
  const stale = t.staleness !== "live";
  const eta = t.etaMinutes != null && t.status !== "on_job";
  return (
    <li className="lm-item">
      <button
        type="button"
        className="lm-card"
        aria-pressed={on}
        disabled={!t.location}
        onClick={onPick}
        style={{ "--c": t.color ?? "var(--accent)" } as CSSProperties}
      >
        <span aria-hidden className="lm-swatch" />
        <Avatar
          name={t.name}
          seed={t.id}
          color={t.color ?? undefined}
          size={40}
          ring={STATUS_TONE[t.status]}
          className={cx(stale && "opacity-50 grayscale")}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-headline">{t.name}</span>
            <Pill tone={STATUS_TONE[t.status]} size="sm">
              {TECH_STATUS_LABEL[t.status]}
            </Pill>
          </span>
          <span
            className={cx(
              "truncate text-subhead text-label-2",
              stale && "italic",
            )}
          >
            {t.location
              ? `Last ping ${ago(t.location.recordedAt, now)}${stale ? " · stale" : ""}`
              : "No location yet"}
          </span>
          <span
            className={cx(
              "truncate text-subhead",
              job ? "text-label" : "text-label-3",
            )}
          >
            {job
              ? `${t.currentJob ? "Now" : "Next"}: ${job.number} · ${job.title}${eta ? ` · ~${t.etaMinutes} min` : ""}`
              : "Nothing next"}
          </span>
        </span>
      </button>
    </li>
  );
}
