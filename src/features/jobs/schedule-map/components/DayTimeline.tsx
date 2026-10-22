"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Avatar } from "@/ui/components/Avatar";
import {
  compactWindow,
  hourTick,
  type JobPhase,
  lanes,
  stTokens,
} from "../route";
import type { SmJob, SmTech } from "../types";
import { FIT_MAX, FIT_MIN } from "./map-css";

// Compact per-tech Gantt across the business-hours day (CSS grid, absolutely
// positioned bars, no chart library): one row per tech, each job a bar spanning
// its arrival window in the tech's color with the map's status styles, an
// "Unassigned" row, and a red now-line on today. Hover and click sync with the map.
// `size="lg"` is the full-screen scale: wider hours, taller bars; it scrolls to now.

const GRAY = "var(--sys-gray)";

/** Width bucket (px) the full label needs; map-css.ts has a container rule per bucket. */
const labelFit = (text: string, icon: boolean) =>
  Math.min(
    FIT_MAX,
    Math.max(FIT_MIN, Math.ceil((6.5 * text.length + (icon ? 16 : 0)) / 8) * 8),
  );

interface Row {
  key: string;
  label: string;
  tech: SmTech | null;
  jobs: SmJob[];
}

export function DayTimeline({
  techs,
  jobs,
  startMin,
  endMin,
  nowMin,
  seqOf,
  phases,
  selected,
  hovered,
  iso,
  onSelect,
  onHover,
  size = "md",
  zoom = "fit",
}: {
  techs: readonly SmTech[];
  jobs: ReadonlyMap<string, SmJob>;
  startMin: number;
  endMin: number;
  /** Minutes from local midnight on today; null on other days. */
  nowMin: number | null;
  seqOf: (jobId: string, techId: string) => number | null;
  phases: ReadonlyMap<string, JobPhase>;
  selected: string | null;
  hovered: string | null;
  iso: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  size?: "md" | "lg";
  /** Full screen: the whole day in view, or about 4½ hours (scrolls). */
  zoom?: "fit" | "zoom";
}) {
  const LANE = 24;
  const lg = size === "lg";
  const scroller = useRef<HTMLDivElement>(null);
  // Full-screen zoom: px per hour so ~4.5 h fit beside the name column.
  const [hourPx, setHourPx] = useState(72);
  useEffect(() => {
    const el = scroller.current;
    if (!lg || !el) return;
    const ro = new ResizeObserver(() => {
      const label =
        el.querySelector<HTMLElement>(".tl-label")?.offsetWidth ?? 96;
      setHourPx(Math.max(72, Math.round((el.clientWidth - label) / 4.5)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [lg]);
  const root = useRef<HTMLElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const span = Math.max(60, endMin - startMin);
  const hours = Math.round(span / 60);
  const pct = (m: number) =>
    `${(Math.min(Math.max(m - startMin, 0), span) / span) * 100}%`;
  const rows: Row[] = techs.map((t) => ({
    key: t.id,
    label: t.name,
    tech: t,
    jobs: t.jobIds.map((id) => jobs.get(id)).filter((j): j is SmJob => !!j),
  }));
  const unassigned = [...jobs.values()].filter((j) => j.techIds.length === 0);
  if (unassigned.length)
    rows.push({ key: "un", label: "Unassigned", tech: null, jobs: unassigned });
  const showNow = nowMin != null && nowMin >= startMin && nowMin <= endMin;
  // Full screen: bring now (or the first window) into view, 30% from the left,
  // so the morning's jobs show on the left of it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on a scale change only
  useEffect(() => {
    const el = scroller.current;
    if (!lg || !el) return;
    const firsts = rows.flatMap((r) => r.jobs.map((j) => j.startMin));
    const at =
      showNow && nowMin != null
        ? nowMin
        : firsts.length
          ? Math.min(...firsts)
          : startMin;
    const label = el.querySelector<HTMLElement>(".tl-label")?.offsetWidth ?? 0;
    const track = el.scrollWidth - label;
    el.scrollLeft = Math.max(
      0,
      ((at - startMin) / span) * track - (el.clientWidth - label) * 0.3,
    );
  }, [lg, zoom, hourPx]);

  // Full screen: while any part of a bar is visible, its card sits right beside
  // the name column, whole (it may run past the bar's end). Sticky can't do this
  // (it never leaves the bar), so pin on scroll: read every rect, then write.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-pin when the scale or the bars change
  useEffect(() => {
    const sc = scroller.current;
    if (!lg || !sc) return;
    let raf = 0;
    const pin = () => {
      raf = 0;
      // Layout coordinates (scroll content), so a transform on the way (the
      // full-screen grow) can't skew them.
      const label =
        sc.querySelector<HTMLElement>(".tl-label")?.offsetWidth ?? 0;
      const edge = sc.scrollLeft + label + 6;
      const bars = [...sc.querySelectorAll<HTMLElement>(".tl-bar")];
      const read = bars.map((b) => {
        const x = (b.parentElement?.offsetLeft ?? 0) + b.offsetLeft;
        const right = x + b.offsetWidth;
        const pinned = x < edge && right > edge;
        const card = b.firstElementChild as HTMLElement | null;
        return {
          card,
          dx: pinned ? Math.round(edge - x) : 0,
          // The bar clips the card (overflow: clip); fade where it's cut.
          room: pinned ? Math.round(right - edge) : 0,
          width: card?.offsetWidth ?? 0,
        };
      });
      for (const { card, dx, room, width } of read) {
        if (!card) continue;
        card.style.transform = dx ? `translateX(${dx}px)` : "";
        card.toggleAttribute("data-pinned", dx > 0);
        const cut = dx > 0 && width > room;
        card.toggleAttribute("data-clip", cut);
        if (cut) card.style.setProperty("--fade-at", `${room}px`);
      }
    };
    const later = () => {
      if (!raf) raf = requestAnimationFrame(pin);
    };
    pin();
    sc.addEventListener("scroll", later, { passive: true });
    const ro = new ResizeObserver(later);
    ro.observe(sc);
    return () => {
      cancelAnimationFrame(raf);
      sc.removeEventListener("scroll", later);
      ro.disconnect();
    };
  }, [lg, zoom, hourPx, jobs, startMin, endMin]);

  // One tooltip per strip for the hovered job (a bar, or its map marker), placed
  // over its bar and kept inside the visible part of the strip: shifted in from
  // either edge, flipped under the bar when there's no room above.
  const placeTip = () => {
    const t = tip.current;
    const box = root.current;
    const sc = scroller.current;
    if (!t || !box || !sc) return;
    const bar = hovered
      ? box.querySelector<HTMLElement>(`.tl-bar[data-id="${hovered}"]`)
      : null;
    const j = hovered ? jobs.get(hovered) : undefined;
    if (!bar || !j) {
      t.hidden = true;
      return;
    }
    t.textContent = `${bar.dataset.label} · ${j.customerShort}`;
    t.hidden = false;
    const R = box.getBoundingClientRect();
    const S = sc.getBoundingClientRect();
    const B = bar.getBoundingClientRect();
    const label = sc.querySelector<HTMLElement>(".tl-label")?.offsetWidth ?? 0;
    const lo = Math.max(S.left + label, 0) + 4;
    const hi = Math.min(S.right, innerWidth) - 4;
    if (B.right < lo || B.left > hi) {
      t.hidden = true;
      return;
    }
    const x = Math.max(lo, Math.min(B.left, hi - t.offsetWidth));
    const above = B.top - t.offsetHeight - 4;
    const y = above >= Math.max(S.top, 0) ? above : B.bottom + 4;
    t.style.left = `${x - R.left}px`;
    t.style.top = `${y - R.top}px`;
  };
  const placeRef = useRef(placeTip);
  placeRef.current = placeTip;
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-place on hover and layout changes
  useLayoutEffect(placeTip, [hovered, jobs, size, startMin, endMin]);
  useEffect(() => {
    const sc = scroller.current;
    const move = () => placeRef.current();
    sc?.addEventListener("scroll", move, { passive: true });
    addEventListener("resize", move);
    return () => {
      sc?.removeEventListener("scroll", move);
      removeEventListener("resize", move);
    };
  }, []);

  return (
    <section
      ref={root}
      className="tl"
      data-size={size}
      style={{
        ["--hours" as string]: hours,
        ...(lg
          ? { ["--tl-hour" as string]: zoom === "fit" ? "0px" : `${hourPx}px` }
          : null),
      }}
      aria-label="Timeline of the day by technician"
    >
      <div className="tl-scroll" ref={scroller}>
        <div className="tl-inner">
          <div className="tl-head" aria-hidden>
            <span className="tl-label" />
            <div className="tl-ticks">
              {Array.from({ length: hours }, (_, i) => (
                <span
                  key={startMin + i * 60}
                  className="tl-tick"
                  style={{ left: `${(i / hours) * 100}%` }}
                >
                  {hourTick(startMin + i * 60)}
                </span>
              ))}
            </div>
          </div>
          {rows.map((r) => {
            const { lane, count } = lanes(r.jobs);
            const color = r.tech?.color ?? GRAY;
            return (
              <div
                key={r.key}
                className="tl-row"
                data-fade={iso && r.tech?.id !== iso ? "" : undefined}
                // Full screen: a row hugs its cards (72–88 px a lane), top-aligned.
                style={
                  lg
                    ? { minHeight: 72 * count, maxHeight: 88 * count }
                    : undefined
                }
              >
                <div className="tl-label">
                  {r.tech ? (
                    <>
                      <span
                        aria-hidden
                        className="sm-chipdot"
                        style={{ ["--c" as string]: color }}
                      />
                      <Avatar
                        name={r.tech.name}
                        seed={r.tech.id}
                        src={r.tech.avatarUrl}
                        color={color}
                        size={lg ? 28 : 20}
                      />
                    </>
                  ) : (
                    <span
                      aria-hidden
                      className="sm-chipdot"
                      style={{
                        ["--c" as string]: "transparent",
                        boxShadow: `inset 0 0 0 1.5px ${GRAY}`,
                      }}
                    />
                  )}
                  <span className="tl-n1">
                    {r.tech ? r.label.split(" ")[0] : r.label}
                  </span>
                  {lg && <span className="tl-n2">{r.label}</span>}
                </div>
                <div
                  className="tl-track"
                  style={lg ? undefined : { height: 8 + count * LANE - 2 }}
                >
                  {r.jobs.map((j) => {
                    const ph = phases.get(j.id);
                    const seq = r.tech ? seqOf(j.id, r.tech.id) : null;
                    const win = compactWindow(j.startMin, j.endMin);
                    const full = `${seq != null ? `${seq} · ` : ""}${win}`;
                    const icon = !!(ph?.late || ph?.live || ph?.done);
                    return (
                      <button
                        key={j.id}
                        type="button"
                        className="tl-bar"
                        data-st={stTokens(ph)}
                        data-fit={labelFit(full, icon)}
                        data-id={j.id}
                        data-label={full}
                        data-hover={hovered === j.id ? "" : undefined}
                        aria-pressed={selected === j.id}
                        aria-label={`${r.tech ? `${r.tech.name}, stop ${seq}` : "Unassigned"}: ${j.customerShort}, ${j.title}, ${win}${ph?.late ? ", late" : ""}${ph?.done ? ", done" : ""}`}
                        onClick={() => onSelect(j.id)}
                        onPointerEnter={() => onHover(j.id)}
                        onPointerLeave={() => onHover(null)}
                        onFocus={() => onHover(j.id)}
                        onBlur={() => onHover(null)}
                        style={{
                          left: pct(j.startMin),
                          width: `calc(${pct(j.endMin)} - ${pct(j.startMin)})`,
                          // Full screen: the lanes share the row's height; a bar is
                          // at most 72 px tall, centered in its lane.
                          top: lg
                            ? `calc(${lane.get(j.id) ?? 0} * 100% / ${count} + max(6px, (100% / ${count} - 72px) / 2))`
                            : 4 + (lane.get(j.id) ?? 0) * LANE,
                          height: lg
                            ? `min(72px, calc(100% / ${count} - 12px))`
                            : undefined,
                          ["--c" as string]: color,
                        }}
                      >
                        {/* The full label only when it fits the bar (container
                            query on .tl-in), else the stop number; never a cut
                            window. Hover / focus shows the tooltip with it all. */}
                        {lg ? (
                          // Full screen: a two-line card that stays in view (sticky
                          // beside the name column) while the bar scrolls.
                          <span className="tl-card" aria-hidden>
                            <span className="tl-l1">
                              {ph?.late && <span className="tl-late">!</span>}
                              {ph?.live && (
                                <span
                                  className="tl-dot"
                                  style={{ background: color }}
                                />
                              )}
                              {ph?.done && "✓ "}
                              {full}
                            </span>
                            <span className="tl-l2">{j.customerShort}</span>
                          </span>
                        ) : (
                          <span className="tl-in" aria-hidden>
                            {ph?.late && <span className="tl-late">!</span>}
                            {/* Live: a steady dot (the map carries the M12 pulse). */}
                            {ph?.live && (
                              <span
                                className="tl-dot"
                                style={{ background: color }}
                              />
                            )}
                            {ph?.done && (
                              <svg
                                width="10"
                                height="10"
                                viewBox="0 0 12 12"
                                aria-hidden="true"
                                style={{ flex: "none" }}
                              >
                                <path
                                  d="M2.5 6.3 5 8.6l4.5-5"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            )}
                            {seq != null && (
                              <span className="tl-short">{seq}</span>
                            )}
                            <span className="tl-full">{full}</span>
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {showNow && (
            <div
              aria-hidden
              className="pointer-events-none absolute"
              style={{ top: 0, bottom: 0, left: "var(--tl-label)", right: 0 }}
            >
              <span className="tl-now" style={{ left: pct(nowMin) }} />
            </div>
          )}
        </div>
      </div>
      <div ref={tip} className="tl-pop" aria-hidden hidden />
    </section>
  );
}
