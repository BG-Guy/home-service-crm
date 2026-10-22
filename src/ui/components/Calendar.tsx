"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cx } from "../cx";

/**
 * Availability calendar, Airbnb style (docs/DESIGN.md §5 Calendar). Dates are
 * 'YYYY-MM-DD' keys (no time zones inside).
 *
 * - Phone (< 768 px): every month in the range scrolls vertically under a sticky
 *   weekday header.
 * - ≥ 768 px: two months side by side with previous / next buttons.
 *
 * Each day shows its availability: `best` (accent dot + "Best"), `open` (green
 * dot), `limited` (amber dot), `full` (gray, struck through, not selectable).
 * Past days and days outside `from`–`to` are disabled; today is ringed; the
 * selected day is a filled circle. A proper grid: roving focus with arrow keys,
 * Home/End (week), PageUp/PageDown (month), `aria-selected` and `aria-disabled`.
 *
 * ```tsx
 * <Calendar from={today} to={addDays(today, 59)} today={today}
 *   selected={day} onSelect={setDay}
 *   getDay={(k) => ({ status: byDate.get(k)?.status })} />
 * ```
 */

export type CalendarStatus = "best" | "open" | "limited" | "full";

export interface CalendarDayInfo {
  status?: CalendarStatus;
  /** Extra words for screen readers ("4 windows open"). */
  hint?: string;
  disabled?: boolean;
}

export interface CalendarProps {
  from: string;
  to: string;
  today: string;
  selected: string | null;
  onSelect: (key: string) => void;
  getDay?: (key: string) => CalendarDayInfo | undefined;
  /** Pointer hover / keyboard focus on a selectable day (e.g. prefetch). */
  onPreview?: (key: string) => void;
  /** Accessible name of the calendar. */
  label?: string;
  className?: string;
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const STATUS_WORD: Record<CalendarStatus, string> = {
  best: "Best day",
  open: "Open",
  limited: "Limited",
  full: "Full",
};

const parts = (k: string) => {
  const [y, m, d] = k.split("-").map(Number);
  return { y: y as number, m: (m as number) - 1, d: d as number };
};
const keyOf = (y: number, m: number, d: number) =>
  new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
const addDays = (k: string, n: number) => {
  const p = parts(k);
  return keyOf(p.y, p.m, p.d + n);
};
const addMonths = (k: string, n: number) => {
  const p = parts(k);
  const last = new Date(Date.UTC(p.y, p.m + n + 1, 0)).getUTCDate();
  return keyOf(p.y, p.m + n, Math.min(p.d, last));
};
const weekday = (k: string) => {
  const p = parts(k);
  return new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay();
};
const monthName = (y: number, m: number) =>
  new Date(Date.UTC(y, m, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

interface Month {
  y: number;
  m: number;
  id: string;
}

function monthsBetween(from: string, to: string): Month[] {
  const a = parts(from);
  const b = parts(to);
  const out: Month[] = [];
  const n = Math.min(24, (b.y - a.y) * 12 + (b.m - a.m) + 1);
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(a.y, a.m + i, 1));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    out.push({ y, m, id: `${y}-${String(m + 1).padStart(2, "0")}` });
  }
  return out;
}

export function Calendar({
  from,
  to,
  today,
  selected,
  onSelect,
  getDay,
  onPreview,
  label = "Choose a day",
  className,
}: CalendarProps) {
  const months = useMemo(() => monthsBetween(from, to), [from, to]);
  const info = useCallback(
    (k: string): CalendarDayInfo & { off: boolean } => {
      const i = getDay?.(k) ?? {};
      const off =
        k < from || k > to || k < today || !!i.disabled || i.status === "full";
      return { ...i, off };
    },
    [getDay, from, to, today],
  );
  const firstOpen = useMemo(() => {
    for (let k = from < today ? today : from; k <= to; k = addDays(k, 1))
      if (!info(k).off) return k;
    return from < today ? today : from;
  }, [from, to, today, info]);
  const [focusKey, setFocusKey] = useState(selected ?? firstOpen);
  useEffect(() => {
    if (selected) setFocusKey(selected);
  }, [selected]);

  // Desktop: index of the left month.
  const monthIdx = (k: string) =>
    Math.max(
      0,
      months.findIndex((mm) => mm.id === k.slice(0, 7)),
    );
  const [page, setPage] = useState(() =>
    Math.min(monthIdx(selected ?? firstOpen), Math.max(0, months.length - 2)),
  );
  const maxPage = Math.max(0, months.length - 2);

  const phoneRef = useRef<HTMLDivElement>(null);
  const deskRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<{ key: string; root: "phone" | "desk" } | null>(
    null,
  );

  useEffect(() => {
    const p = pendingFocus.current;
    if (!p) return;
    const root = p.root === "phone" ? phoneRef.current : deskRef.current;
    const el = root?.querySelector<HTMLElement>(`[data-date="${p.key}"]`);
    if (el) {
      el.focus({ preventScroll: p.root === "desk" });
      if (p.root === "phone") el.scrollIntoView({ block: "nearest" });
      pendingFocus.current = null;
    }
  });

  const move = (e: KeyboardEvent<HTMLElement>, root: "phone" | "desk") => {
    const k = (e.target as HTMLElement).dataset.date;
    if (!k) return;
    let next: string | null = null;
    switch (e.key) {
      case "ArrowLeft":
        next = addDays(k, -1);
        break;
      case "ArrowRight":
        next = addDays(k, 1);
        break;
      case "ArrowUp":
        next = addDays(k, -7);
        break;
      case "ArrowDown":
        next = addDays(k, 7);
        break;
      case "Home":
        next = addDays(k, -weekday(k));
        break;
      case "End":
        next = addDays(k, 6 - weekday(k));
        break;
      case "PageUp":
        next = addMonths(k, -1);
        break;
      case "PageDown":
        next = addMonths(k, 1);
        break;
      default:
        return;
    }
    e.preventDefault();
    const lo = `${months[0]?.id}-01`;
    const hi = to;
    if (next < lo) next = lo;
    if (next > hi) next = hi;
    setFocusKey(next);
    if (root === "desk") {
      const mi = monthIdx(next);
      if (mi < page) setPage(Math.max(0, mi));
      else if (mi > page + 1) setPage(Math.min(maxPage, mi - 1));
    }
    pendingFocus.current = { key: next, root };
    if (!info(next).off) onPreview?.(next);
  };

  const grid = (mm: Month, root: "phone" | "desk") => {
    const first = keyOf(mm.y, mm.m, 1);
    const lead = weekday(first);
    const days = new Date(Date.UTC(mm.y, mm.m + 1, 0)).getUTCDate();
    const cells: (string | null)[] = [
      ...Array.from({ length: lead }, () => null),
      ...Array.from({ length: days }, (_, i) => keyOf(mm.y, mm.m, i + 1)),
    ];
    while (cells.length % 7) cells.push(null);
    const rows: (string | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return (
      // biome-ignore lint/a11y/useSemanticElements: a CSS-grid date grid (APG date picker); a <table> can't lay out the sticky header and cells
      <div
        role="grid"
        aria-label={monthName(mm.y, mm.m)}
        onKeyDown={(e) => move(e, root)}
        className="flex flex-col gap-1"
      >
        {rows.map((r) => (
          // biome-ignore lint/a11y/useSemanticElements: grid row of the date grid
          // biome-ignore lint/a11y/useFocusableInteractive: focus lives on the day buttons (roving tabindex)
          <div
            role="row"
            key={r.find(Boolean) ?? "x"}
            className="grid grid-cols-7"
          >
            {r.map((k, ci) =>
              k ? (
                <DayCell
                  key={k}
                  k={k}
                  info={info(k)}
                  isToday={k === today}
                  isSelected={k === selected}
                  focusable={k === focusKey}
                  onSelect={onSelect}
                  onPreview={onPreview}
                  onFocusKey={setFocusKey}
                />
              ) : (
                // biome-ignore lint/a11y/useSemanticElements: an empty grid cell
                // biome-ignore lint/a11y/useFocusableInteractive: an empty grid cell
                <div role="gridcell" key={`e${mm.id}${ci}`} />
              ),
            )}
          </div>
        ))}
      </div>
    );
  };

  const weekdayRow = (
    <div
      aria-hidden
      className="grid grid-cols-7 text-center text-caption text-label-2"
    >
      {WEEKDAYS.map((d, i) => (
        <span key={WEEKDAY_NAMES[i]} className="py-2">
          {d}
        </span>
      ))}
    </div>
  );

  const shown = months.slice(page, page + 2);
  return (
    <section aria-label={label} className={cx("cal", className)}>
      {/* Phone: vertical months */}
      <div ref={phoneRef} className="md:hidden">
        <div className="cal-weekdays sticky z-[var(--z-sticky)] -mx-[var(--gutter)] border-b border-sep bg-bg px-[var(--gutter)]">
          {weekdayRow}
        </div>
        <div className="flex flex-col gap-7 pt-4">
          {months.map((mm) => (
            <div key={mm.id} className="flex flex-col gap-2">
              <h3 className="px-1 text-headline">{monthName(mm.y, mm.m)}</h3>
              {grid(mm, "phone")}
            </div>
          ))}
        </div>
      </div>

      {/* ≥ 768: two months with prev / next */}
      <div ref={deskRef} className="hidden md:block">
        <div className="relative grid grid-cols-2 gap-8">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            aria-label="Previous month"
            className="hit-44 pressable absolute left-0 top-0 flex size-9 items-center justify-center rounded-full text-label hover:bg-fill-2 disabled:text-label-3 disabled:hover:bg-transparent"
          >
            <ChevronLeft aria-hidden size={20} />
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
            disabled={page >= maxPage}
            aria-label="Next month"
            className="hit-44 pressable absolute right-0 top-0 flex size-9 items-center justify-center rounded-full text-label hover:bg-fill-2 disabled:text-label-3 disabled:hover:bg-transparent"
          >
            <ChevronRight aria-hidden size={20} />
          </button>
          {shown.map((mm) => (
            <div key={mm.id} className="flex min-w-0 flex-col gap-1">
              <h3
                aria-live="polite"
                className="flex h-9 items-center justify-center text-headline"
              >
                {monthName(mm.y, mm.m)}
              </h3>
              {weekdayRow}
              {grid(mm, "desk")}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const DOT: Record<CalendarStatus, string> = {
  best: "bg-accent",
  open: "bg-[var(--sys-green)]",
  // A ring, not a dot: tells it apart from an orange brand accent (best).
  limited: "shadow-[inset_0_0_0_1.5px_var(--sys-orange)]",
  full: "",
};

function DayCell({
  k,
  info,
  isToday,
  isSelected,
  focusable,
  onSelect,
  onPreview,
  onFocusKey,
}: {
  k: string;
  info: CalendarDayInfo & { off: boolean };
  isToday: boolean;
  isSelected: boolean;
  focusable: boolean;
  onSelect: (k: string) => void;
  onPreview?: (k: string) => void;
  onFocusKey: (k: string) => void;
}) {
  const p = parts(k);
  const st = info.status;
  const past = info.off && st !== "full";
  const full = st === "full";
  const date = new Date(Date.UTC(p.y, p.m, p.d));
  const name = `${WEEKDAY_NAMES[date.getUTCDay()]}, ${date.toLocaleDateString(
    "en-US",
    { month: "long", day: "numeric", timeZone: "UTC" },
  )}`;
  const extra = [
    isToday ? "Today" : null,
    st ? STATUS_WORD[st] : null,
    !info.off ? info.hint : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    // biome-ignore lint/a11y/useSemanticElements: the day button is the grid cell (APG date picker)
    <button
      type="button"
      role="gridcell"
      data-date={k}
      tabIndex={focusable ? 0 : -1}
      aria-selected={isSelected}
      aria-disabled={info.off || undefined}
      aria-label={extra ? `${name}, ${extra}` : name}
      onClick={() => {
        onFocusKey(k);
        if (!info.off) onSelect(k);
      }}
      onPointerEnter={info.off ? undefined : () => onPreview?.(k)}
      className={cx(
        "cal-day group relative flex h-[58px] flex-col items-center justify-start pt-0.5 outline-none md:h-[54px]",
        info.off ? "cursor-default" : "cursor-pointer",
      )}
    >
      <span
        className={cx(
          "num flex size-11 items-center justify-center rounded-full text-callout font-semibold transition-[background-color,color,scale] duration-[var(--dur-quick)] group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-accent md:size-10",
          !info.off && "group-active:scale-[.92]",
          isSelected
            ? "bg-label text-bg"
            : info.off
              ? "text-label-3"
              : "text-label group-hover:bg-fill-2",
          full && !isSelected && "line-through decoration-[1.5px]",
          past && "font-normal",
          isToday && !isSelected && "shadow-[inset_0_0_0_1.5px_var(--label)]",
        )}
      >
        {p.d}
      </span>
      <span aria-hidden className="mt-1 flex h-2.5 items-center gap-1">
        {st && st !== "full" && !past && (
          <span className={cx("size-1.5 rounded-full", DOT[st])} />
        )}
        {st === "best" && !past && (
          <span className="text-[10px] font-bold leading-none text-accent-text">
            Best
          </span>
        )}
      </span>
    </button>
  );
}

/** Dot legend under the calendar. */
export function CalendarLegend({ className }: { className?: string }) {
  const item = (dot: string, text: string) => (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={cx("size-2 rounded-full", dot)} />
      {text}
    </span>
  );
  return (
    <p
      className={cx(
        "flex flex-wrap items-center gap-x-4 gap-y-1 text-footnote text-label-2",
        className,
      )}
    >
      {item(DOT.best, "Best")}
      {item(DOT.open, "Open")}
      {item(DOT.limited, "Limited")}
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="text-label-3 line-through">
          18
        </span>
        Full
      </span>
    </p>
  );
}
