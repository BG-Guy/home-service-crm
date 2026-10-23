"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import type {
  DayAvailability,
  DayStatus,
} from "@/features/jobs/availability/types";
import { cx } from "@/ui/cx";
import { stripDay } from "../../booking-labels";

// The When step's day picker: a week strip from today that one thumb swipes
// (approved option "A week strip, one thumb"). Each day shows its status dot:
// best = accent dot, open = green dot, limited = amber ring (never orange
// brand-like), full = struck through. The selected day is the filled ink pill; the day
// the customer asked for carries a small "Asked" tag.

const DOT: Record<DayStatus, string> = {
  best: "bg-accent",
  open: "bg-[var(--sys-green)]",
  limited: "shadow-[inset_0_0_0_1.5px_var(--sys-orange)]",
  full: "",
};
const WORD: Record<DayStatus, string> = {
  best: "best day",
  open: "open",
  limited: "limited",
  full: "full",
};

export function WeekStrip({
  days,
  today,
  selected,
  requested,
  onSelect,
  onPreview,
  className,
}: {
  days: readonly DayAvailability[];
  today: string;
  selected: string | null;
  requested: string | null;
  onSelect: (date: string) => void;
  /** Hover / focus on a day (prefetch its windows). */
  onPreview?: (date: string) => void;
  className?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  // Which page arrows make sense (pointer devices): more days before / after.
  const [more, setMore] = useState({ before: false, after: false });
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const sync = () =>
      setMore({
        before: box.scrollLeft > 4,
        after: box.scrollLeft + box.clientWidth < box.scrollWidth - 4,
      });
    sync();
    box.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    return () => {
      box.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);

  // Keep the picked day in view (on load and when it changes).
  useEffect(() => {
    const box = scroller.current;
    if (!box || !selected) return;
    const el = box.querySelector<HTMLElement>(`[data-date="${selected}"]`);
    if (!el) return;
    const left = el.offsetLeft - box.clientWidth / 2 + el.offsetWidth / 2;
    box.scrollTo({ left: Math.max(0, left), behavior: "auto" });
  }, [selected]);

  const page = (dir: 1 | -1) => {
    const box = scroller.current;
    if (box)
      box.scrollBy({ left: dir * box.clientWidth * 0.86, behavior: "smooth" });
  };

  // Radio-group keys: arrows move and pick, Home/End jump.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = days.findIndex((d) => d.date === selected);
    let next = -1;
    if (e.key === "ArrowRight") next = Math.min(days.length - 1, i + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, i - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = days.length - 1;
    if (next < 0 || next === i) return;
    e.preventDefault();
    const d = days[next];
    if (!d) return;
    onSelect(d.date);
    scroller.current
      ?.querySelector<HTMLElement>(`[data-date="${d.date}"]`)
      ?.focus();
  };

  return (
    <div className={cx("relative", className)}>
      <div
        ref={scroller}
        role="radiogroup"
        aria-label="Pick a day"
        onKeyDown={onKey}
        className="chip-row -mx-[var(--gutter)] flex gap-2 px-[var(--gutter)] py-1"
      >
        {days.map((d) => {
          const on = d.date === selected;
          const full = d.status === "full";
          const asked = d.date === requested;
          const label = stripDay(d.date, today);
          return (
            // biome-ignore lint/a11y/useSemanticElements: day card radio
            <button
              key={d.date}
              type="button"
              role="radio"
              data-date={d.date}
              aria-checked={on}
              tabIndex={on || (!selected && d === days[0]) ? 0 : -1}
              aria-label={`${label.spoken}, ${WORD[d.status]}${asked ? ", the day they asked for" : ""}`}
              onClick={() => onSelect(d.date)}
              onPointerEnter={() => onPreview?.(d.date)}
              onFocus={() => onPreview?.(d.date)}
              className={cx(
                "pressable flex h-[76px] w-[54px] shrink-0 snap-start flex-col items-center justify-center gap-1 rounded-tile transition-[box-shadow,background-color] duration-[var(--dur-quick)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                on
                  ? "bg-label text-bg"
                  : "bg-card text-label shadow-[inset_0_0_0_1px_var(--sep)] hover:bg-fill-2",
              )}
            >
              <span
                className={cx(
                  "text-caption",
                  on ? "font-semibold" : "text-label-2",
                )}
              >
                {label.weekday}
              </span>
              <span
                className={cx(
                  "num text-title3 leading-none",
                  full && "line-through decoration-[1.5px]",
                  full && !on && "text-label-3",
                )}
              >
                {label.day}
              </span>
              <span aria-hidden className="flex h-2.5 items-center gap-1">
                {d.status !== "full" && (
                  <span
                    className={cx(
                      "size-1.5 rounded-full",
                      DOT[d.status],
                      on && d.status === "open" && "bg-[var(--sys-green)]",
                    )}
                  />
                )}
                {asked && (
                  <span
                    className={cx(
                      "text-[10px] font-bold leading-none",
                      on ? "text-bg" : "text-label-2",
                    )}
                  >
                    Asked
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {/* Pointer devices: page a week at a time. */}
      <div className="pointer-events-none absolute inset-y-0 -inset-x-4 hidden items-center justify-between [@media(hover:hover)]:flex">
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          onClick={() => page(-1)}
          className={cx(
            "flex size-8 items-center justify-center rounded-full bg-card text-label shadow-raised transition-opacity duration-[var(--dur-quick)] hover:bg-fill-2",
            more.before
              ? "pointer-events-auto"
              : "pointer-events-none opacity-0",
          )}
        >
          <ChevronLeft size={18} />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          onClick={() => page(1)}
          className={cx(
            "flex size-8 items-center justify-center rounded-full bg-card text-label shadow-raised transition-opacity duration-[var(--dur-quick)] hover:bg-fill-2",
            more.after
              ? "pointer-events-auto"
              : "pointer-events-none opacity-0",
          )}
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
