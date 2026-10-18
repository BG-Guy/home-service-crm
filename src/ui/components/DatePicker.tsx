"use client";

import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  type ChangeEventHandler,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { addDaysToKey, formatDateKey } from "@/lib/time";
import { cx } from "../cx";
import {
  createVelocityTracker,
  type SpringAnimation,
  springTo,
} from "../motion/spring-driver";
import {
  prefersReducedMotion,
  project,
  rubberBand,
  spring,
} from "../motion/springs";
import { AnchoredPopover } from "./AnchoredPopover";
import { Button } from "./Button";
import {
  type FieldChromeProps,
  FieldShell,
  inputResetClass,
} from "./field-chrome";
import {
  addMonths,
  addMonthsToKey,
  clampKey,
  firstOfMonth,
  formatFieldDate,
  type GridDay,
  inRange,
  isDateKey,
  localTodayKey,
  monthDiff,
  monthGrid,
  monthOf,
  weekEdge,
  type YearMonth,
} from "./picker-math";
import { Sheet } from "./Sheet";

/*
 * Date picking (SPEC §12.6): the "calendar window".
 * - `Calendar`: month grid whose pages slide left / right on a spring — arrows,
 *   keyboard (←↑→↓, Home/End, PgUp/PgDn, Shift+PgUp/PgDn = year) or a horizontal
 *   swipe that carries the finger's velocity. Tap the title for a month / year grid.
 * - `CalendarWindow`: the calendar on a bottom sheet that slides up (touch) or on
 *   a popover anchored to its field (mouse / trackpad).
 * - `DateField`: drop-in for the old native `<input type="date">`: same value
 *   format ('YYYY-MM-DD'), `name` for forms, and a real `onChange` event.
 */

export interface DatePreset {
  label: string;
  /** Days from today (0 = today). */
  days: number;
}

const DEFAULT_PRESETS: readonly DatePreset[] = [
  { label: "Today", days: 0 },
  { label: "Tomorrow", days: 1 },
  { label: "In a week", days: 7 },
];

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const monthTitle = (ym: YearMonth) =>
  formatDateKey(firstOfMonth(ym), "en-US", { month: "long", year: "numeric" });

const longLabel = (key: string) =>
  formatDateKey(key, "en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

const coarsePointer = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(pointer: coarse)").matches;

/** Sets an input's value so React's change tracking sees it, then fires `input`. */
function emitInput(el: HTMLInputElement | null, value: string) {
  if (!el) return;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/* ------------------------------------------------------------------ Calendar */

export interface CalendarProps {
  value?: string | null;
  onSelect: (key: string) => void;
  min?: string;
  max?: string;
  /** 0 = Sunday (default), 1 = Monday. */
  weekStartsOn?: 0 | 1;
  /** Focus the selected (or today's) day on mount. */
  autoFocus?: boolean;
  /** Quick picks under the grid; `false` hides them. */
  presets?: readonly DatePreset[] | false;
  /** Shows "Clear" next to the presets. */
  onClear?: () => void;
  /** Larger touch cells (sheet) vs. compact (popover). */
  size?: "touch" | "compact";
  className?: string;
}

/**
 * Month calendar with sliding pages. Three panes (previous, current, next) sit on a
 * track; navigating springs the track one pane over, then the months shift and the
 * track snaps back in the same frame, so the motion is seamless in both directions.
 */
export function Calendar({
  value,
  onSelect,
  min,
  max,
  weekStartsOn = 0,
  autoFocus,
  presets = DEFAULT_PRESETS,
  onClear,
  size = "compact",
  className,
}: CalendarProps) {
  const today = localTodayKey();
  const start = isDateKey(value) ? value : clampKey(today, min, max);
  const [ym, setYm] = useState<YearMonth>(() => monthOf(start));
  const [focusKey, setFocusKey] = useState(start);
  const [view, setView] = useState<"days" | "months">("days");
  // The month being slid to: the title changes as the slide starts, like iOS.
  const [heading, setHeading] = useState<YearMonth | null>(null);
  // Current month for callbacks (fresh even right after a flushSync commit).
  const ymRef = useRef(ym);
  ymRef.current = ym;
  const [yearView, setYearView] = useState(ym.y);
  const titleId = useId();

  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const offset = useRef(0);
  const anim = useRef<SpringAnimation | null>(null);
  const pending = useRef<{ dir: 1 | -1; focus?: string } | null>(null);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    mode: "pending" | "drag" | "scroll";
  } | null>(null);
  const tracker = useRef(createVelocityTracker());
  const suppressClick = useRef(false);
  const [focusTick, setFocusTick] = useState(autoFocus ? 1 : 0);

  // A neighbor month is reachable when part of it is inside [min, max].
  const prevAllowed = !(
    isDateKey(min) && addDaysToKey(firstOfMonth(ym), -1) < min
  );
  const nextAllowed = !(isDateKey(max) && firstOfMonth(addMonths(ym, 1)) > max);

  const apply = useCallback((x: number) => {
    offset.current = x;
    const t = trackRef.current;
    if (t) t.style.transform = `translate3d(calc(-100% / 3 + ${x}px), 0, 0)`;
  }, []);

  /** Shift the months and snap the track back to the middle pane (same frame). */
  const commit = useCallback(
    (dir: 1 | -1, focus?: string) => {
      flushSync(() => {
        setYm((m) => addMonths(m, dir));
        setHeading(null);
        if (focus) setFocusKey(focus);
      });
      apply(0);
      if (focus) setFocusTick((n) => n + 1);
    },
    [apply],
  );

  /** Finish an in-flight slide immediately (rapid clicks / key repeat). */
  const settle = useCallback(() => {
    if (!anim.current) return;
    anim.current.stop();
    anim.current = null;
    const p = pending.current;
    pending.current = null;
    if (p) commit(p.dir, p.focus);
    else apply(0);
  }, [apply, commit]);

  const slide = useCallback(
    (dir: 1 | -1, velocity = 0, focus?: string) => {
      settle();
      const w = viewportRef.current?.clientWidth ?? 300;
      if (prefersReducedMotion()) {
        commit(dir, focus);
        return;
      }
      pending.current = { dir, focus };
      setHeading(addMonths(ymRef.current, dir));
      const a = springTo({
        from: offset.current,
        to: -dir * w,
        velocity,
        spring: spring.snappy,
        onUpdate: apply,
      });
      anim.current = a;
      a.finished.then((done) => {
        if (!done || anim.current !== a) return;
        anim.current = null;
        pending.current = null;
        commit(dir, focus);
      });
    },
    [apply, commit, settle],
  );

  const springBack = (velocity = 0) => {
    settle();
    const a = springTo({
      from: offset.current,
      to: 0,
      velocity,
      spring: spring.snappy,
      onUpdate: apply,
    });
    anim.current = a;
    a.finished.then((done) => {
      if (done && anim.current === a) anim.current = null;
    });
  };

  useEffect(() => () => anim.current?.stop(), []);

  // Keep the track centered after mount / when the view returns to days.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-center when the grid remounts
  useLayoutEffect(() => {
    apply(0);
  }, [view, apply]);

  // Move DOM focus to the roving day after keyboard navigation or on open.
  // biome-ignore lint/correctness/useExhaustiveDependencies: focusTick is the trigger
  useEffect(() => {
    if (!focusTick || view !== "days") return;
    gridRef.current
      ?.querySelector<HTMLButtonElement>(
        `[data-active] button[data-key="${focusKey}"]`,
      )
      ?.focus({ preventScroll: true });
  }, [focusTick, view]);

  const moveFocus = (next: string) => {
    const target = monthOf(next);
    const d = monthDiff(ym, target);
    if (d === 0) {
      setFocusKey(next);
      setFocusTick((n) => n + 1);
    } else if (Math.abs(d) === 1) {
      slide(d as 1 | -1, 0, next);
    } else {
      settle();
      setYm(target);
      setFocusKey(next);
      setFocusTick((n) => n + 1);
    }
  };

  const onGridKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const k = e.key;
    let next: string | null = null;
    if (k === "ArrowLeft") next = addDaysToKey(focusKey, -1);
    else if (k === "ArrowRight") next = addDaysToKey(focusKey, 1);
    else if (k === "ArrowUp") next = addDaysToKey(focusKey, -7);
    else if (k === "ArrowDown") next = addDaysToKey(focusKey, 7);
    else if (k === "Home") next = weekEdge(focusKey, "start", weekStartsOn);
    else if (k === "End") next = weekEdge(focusKey, "end", weekStartsOn);
    else if (k === "PageUp")
      next = addMonthsToKey(focusKey, e.shiftKey ? -12 : -1);
    else if (k === "PageDown")
      next = addMonthsToKey(focusKey, e.shiftKey ? 12 : 1);
    if (!next) return;
    e.preventDefault();
    moveFocus(next);
  };

  /* ---------- swipe between months (touch / pen) ---------- */

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" || !e.isPrimary) return;
    drag.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      mode: "pending",
    };
    tracker.current.reset();
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (d.mode === "pending") {
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
        d.mode = "scroll";
        return;
      }
      if (Math.abs(dx) < 8) return;
      d.mode = "drag";
      settle();
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (d.mode !== "drag") return;
    const w = viewportRef.current?.clientWidth ?? 300;
    // Resist past a min/max month edge (iOS rubber band).
    const blocked = (dx > 0 && !prevAllowed) || (dx < 0 && !nextAllowed);
    const x = blocked ? rubberBand(dx, w) : dx;
    apply(x);
    tracker.current.add(x);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId || d.mode !== "drag") return;
    suppressClick.current = true;
    const w = viewportRef.current?.clientWidth ?? 300;
    const v = e.type === "pointercancel" ? 0 : tracker.current.velocity();
    const p = project(offset.current, v);
    if (p < -w / 2 && nextAllowed) slide(1, v);
    else if (p > w / 2 && prevAllowed) slide(-1, v);
    else springBack(v);
  };

  const pick = (key: string) => {
    if (!inRange(key, min, max)) return;
    setFocusKey(key);
    const target = monthOf(key);
    const d = monthDiff(ym, target);
    if (Math.abs(d) === 1) slide(d as 1 | -1);
    onSelect(key);
  };

  const cell = size === "touch" ? "h-11" : "h-10";
  const disc = size === "touch" ? "size-10 text-title3" : "size-9 text-body";
  const order = Array.from({ length: 7 }, (_, i) => (i + weekStartsOn) % 7);

  // One <table role="grid"> per month page; only the middle page is live (the
  // neighbors are inert copies that slide in). Column headers are for screen
  // readers — the visible weekday row stays put above the sliding pages.
  const pane = (m: YearMonth, active: boolean) => (
    <table
      key={`${m.y}-${m.m}`}
      role={active ? "grid" : undefined}
      aria-labelledby={active ? titleId : undefined}
      aria-hidden={active ? undefined : true}
      inert={!active}
      data-active={active || undefined}
      onKeyDown={active ? onGridKey : undefined}
      className="w-1/3 shrink-0 table-fixed border-collapse"
    >
      <thead className="sr-only">
        <tr>
          {order.map((wd) => (
            <th key={wd} scope="col" abbr={WEEKDAYS[wd]}>
              {WEEKDAYS[wd]?.slice(0, 3)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {chunk(monthGrid(m, weekStartsOn), 7).map((week) => (
          <tr key={week[0]?.key}>
            {week.map((d) => (
              <DayCell
                key={d.key}
                d={d}
                cell={cell}
                disc={disc}
                selected={d.key === value}
                today={d.key === today}
                disabled={!inRange(d.key, min, max)}
                focusable={active && d.key === focusKey}
                onPick={pick}
              />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );

  const presetsToShow = (presets || []).filter((p) =>
    inRange(addDaysToKey(today, p.days), min, max),
  );

  return (
    <div className={cx("select-none", className)}>
      <div className="flex items-center justify-between gap-2 pb-1 pl-1">
        <button
          type="button"
          aria-expanded={view === "months"}
          onClick={() => {
            setYearView(ym.y);
            setView((v) => (v === "days" ? "months" : "days"));
          }}
          className="pressable -ml-1 flex min-h-11 items-center gap-1 rounded-control px-1 text-headline outline-offset-0"
        >
          <span id={titleId} aria-live="polite">
            {monthTitle(heading ?? ym)}
          </span>
          <ChevronRight
            aria-hidden
            size={18}
            strokeWidth={2.6}
            className={cx(
              "text-accent-text transition-transform duration-300 ease-[var(--ease-spring-snappy)]",
              view === "months" && "rotate-90",
            )}
          />
        </button>
        {view === "days" ? (
          <div className="flex items-center">
            <NavArrow
              label="Previous month"
              disabled={!prevAllowed}
              onClick={() => {
                slide(-1);
                setFocusKey(
                  clampKey(firstOfMonth(addMonths(ym, -1)), min, max),
                );
              }}
            >
              <ChevronLeft size={22} strokeWidth={2.4} />
            </NavArrow>
            <NavArrow
              label="Next month"
              disabled={!nextAllowed}
              onClick={() => {
                slide(1);
                setFocusKey(clampKey(firstOfMonth(addMonths(ym, 1)), min, max));
              }}
            >
              <ChevronRight size={22} strokeWidth={2.4} />
            </NavArrow>
          </div>
        ) : (
          <div className="flex items-center">
            <NavArrow
              label="Previous year"
              onClick={() => setYearView((y) => y - 1)}
            >
              <ChevronLeft size={22} strokeWidth={2.4} />
            </NavArrow>
            <span className="num min-w-12 text-center text-headline">
              {yearView}
            </span>
            <NavArrow
              label="Next year"
              onClick={() => setYearView((y) => y + 1)}
            >
              <ChevronRight size={22} strokeWidth={2.4} />
            </NavArrow>
          </div>
        )}
      </div>

      {view === "days" ? (
        <div ref={gridRef} className="cal-enter">
          <div aria-hidden className="grid grid-cols-7 pb-1">
            {order.map((wd) => (
              <span
                key={wd}
                className="text-center text-caption font-semibold uppercase text-label-3"
              >
                {WEEKDAYS[wd]?.slice(0, 3)}
              </span>
            ))}
          </div>
          <div
            ref={viewportRef}
            className="overflow-hidden"
            style={{ touchAction: "pan-y" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onClickCapture={(e) => {
              if (suppressClick.current) {
                suppressClick.current = false;
                e.preventDefault();
                e.stopPropagation();
              }
            }}
          >
            <div
              ref={trackRef}
              className="flex w-[300%] will-change-transform"
              style={{ transform: "translate3d(calc(-100% / 3), 0, 0)" }}
            >
              {pane(addMonths(ym, -1), false)}
              {pane(ym, true)}
              {pane(addMonths(ym, 1), false)}
            </div>
          </div>
        </div>
      ) : (
        <div className="cal-enter grid grid-cols-3 gap-2 py-2">
          {MONTHS_SHORT.map((name, i) => {
            const m = { y: yearView, m: i + 1 };
            const lastDay = addDaysToKey(firstOfMonth(addMonths(m, 1)), -1);
            const ok =
              inRange(lastDay, min) && inRange(firstOfMonth(m), null, max);
            const on = m.y === ym.y && m.m === ym.m;
            return (
              <button
                key={name}
                type="button"
                disabled={!ok}
                aria-pressed={on}
                onClick={() => {
                  setYm(m);
                  setFocusKey(clampKey(firstOfMonth(m), min, max));
                  setView("days");
                  setFocusTick((n) => n + 1);
                }}
                className={cx(
                  "pressable min-h-11 rounded-control text-body outline-offset-0 disabled:opacity-30",
                  on
                    ? "bg-accent font-semibold text-on-accent"
                    : "bg-fill-2 hover:bg-fill",
                )}
              >
                {name}
              </button>
            );
          })}
        </div>
      )}

      {(presetsToShow.length > 0 || onClear) && view === "days" && (
        <div className="hairline-t mt-2 flex flex-wrap items-center gap-2 pt-3">
          {presetsToShow.map((p) => {
            const key = addDaysToKey(today, p.days);
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  const d = monthDiff(ym, monthOf(key));
                  if (Math.abs(d) === 1) slide(d as 1 | -1, 0, key);
                  else if (d !== 0) setYm(monthOf(key));
                  setFocusKey(key);
                  onSelect(key);
                }}
                className={cx(
                  "pressable min-h-8 rounded-pill px-3 text-subhead font-medium outline-offset-1",
                  key === value
                    ? "bg-accent text-on-accent"
                    : "bg-fill-2 text-accent-text hover:bg-fill",
                )}
              >
                {p.label}
              </button>
            );
          })}
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="pressable ml-auto min-h-8 rounded-pill px-3 text-subhead text-danger outline-offset-1 hover:bg-fill-2"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function chunk<T>(list: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

function NavArrow({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="pressable flex size-11 items-center justify-center rounded-full text-accent-text outline-offset-0 hover:bg-fill-2 disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function DayCell({
  d,
  cell,
  disc,
  selected,
  today,
  disabled,
  focusable,
  onPick,
}: {
  d: GridDay;
  cell: string;
  disc: string;
  selected: boolean;
  today: boolean;
  disabled: boolean;
  focusable: boolean;
  onPick: (key: string) => void;
}) {
  return (
    <td className={cx("p-0", cell)}>
      <button
        type="button"
        data-key={d.key}
        tabIndex={focusable ? 0 : -1}
        aria-label={`${today ? "Today, " : ""}${longLabel(d.key)}`}
        aria-current={today ? "date" : undefined}
        aria-pressed={selected}
        aria-disabled={disabled || undefined}
        onClick={() => !disabled && onPick(d.key)}
        className={cx(
          "cal-day relative mx-auto flex items-center justify-center rounded-full outline-offset-0 transition-[background-color,color,transform] duration-300 ease-[var(--ease-spring-snappy)]",
          disc,
          disabled
            ? "cursor-default text-label-3 opacity-50"
            : selected
              ? today
                ? "bg-accent font-semibold text-on-accent"
                : "bg-accent/15 font-semibold text-accent-text"
              : today
                ? "font-semibold text-accent-text hover:bg-fill-2"
                : d.inMonth
                  ? "text-label hover:bg-fill-2"
                  : "text-label-3 hover:bg-fill-2",
          selected && !disabled && "cal-day-picked",
        )}
      >
        <span className="num">{d.day}</span>
      </button>
    </td>
  );
}

/* ------------------------------------------------------------ CalendarWindow */

export interface CalendarWindowProps
  extends Omit<CalendarProps, "autoFocus" | "size" | "className"> {
  open: boolean;
  onClose: () => void;
  /** The field / button the popover hangs from (and gets focus back on close). */
  anchorRef: RefObject<HTMLElement | null>;
  /** Sheet title and the popover's accessible name. */
  title?: ReactNode;
}

/**
 * The calendar "window": a bottom sheet that slides up on touch screens, a popover
 * that springs out of its field with a mouse. Picking a day calls `onSelect`;
 * the caller closes it.
 */
export function CalendarWindow({
  open,
  onClose,
  anchorRef,
  title = "Date",
  ...cal
}: CalendarWindowProps) {
  const [mode, setMode] = useState<"sheet" | "popover">("popover");
  if (open && mode === "popover" && coarsePointer()) setMode("sheet");
  if (open && mode === "sheet" && !coarsePointer()) setMode("popover");

  if (mode === "sheet") {
    return (
      <Sheet
        open={open}
        onOpenChange={(o) => !o && onClose()}
        title={title}
        detents={["content"]}
        leading={
          <Button variant="plain" size="sm" onClick={onClose}>
            Cancel
          </Button>
        }
      >
        <div className="px-1 pb-2">
          <Calendar {...cal} size="touch" autoFocus />
        </div>
      </Sheet>
    );
  }
  return (
    <AnchoredPopover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      label={typeof title === "string" ? title : "Choose a date"}
    >
      <Calendar {...cal} size="compact" autoFocus />
    </AnchoredPopover>
  );
}

/* ----------------------------------------------------------------- DateField */

export interface DateFieldProps extends FieldChromeProps {
  id?: string;
  /** Form field name ('YYYY-MM-DD', or empty). */
  name?: string;
  /** Controlled value ('YYYY-MM-DD' or ""). */
  value?: string;
  defaultValue?: string;
  /** A real change event from the field's input (`e.target.value`). */
  onChange?: ChangeEventHandler<HTMLInputElement>;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Quick picks; `false` hides them. Default Today / Tomorrow / In a week. */
  presets?: readonly DatePreset[] | false;
  weekStartsOn?: 0 | 1;
  form?: string;
}

/**
 * Date field: a field-styled button that opens the calendar window. Keeps the
 * native date input's contract — 'YYYY-MM-DD' values, `name` posts with forms,
 * `required` validates, and `onChange` receives a real input change event.
 */
export function DateField({
  label,
  hideLabel,
  hint,
  error,
  layout,
  className,
  id,
  name,
  value,
  defaultValue,
  onChange,
  min,
  max,
  required,
  disabled,
  placeholder = "Choose a date",
  presets,
  weekStartsOn,
  form,
}: DateFieldProps) {
  const auto = useId();
  const fid = id ?? auto;
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue ?? "");
  const current = (controlled ? value : inner) ?? "";
  const [open, setOpen] = useState(false);
  const [missing, setMissing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const set = (key: string) => emitInput(inputRef.current, key);

  return (
    <FieldShell
      id={fid}
      label={label}
      hideLabel={hideLabel}
      hint={hint}
      error={error ?? (missing ? "Choose a date." : null)}
      layout={layout}
      className={className}
      trailing={
        current && !required && !disabled ? (
          <button
            type="button"
            aria-label={`Clear ${typeof label === "string" ? label.toLowerCase() : "date"}`}
            onClick={() => {
              set("");
              triggerRef.current?.focus();
            }}
            className="hit-44 -mr-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-label-3 text-card outline-offset-2"
          >
            <X aria-hidden size={12} strokeWidth={3} />
          </button>
        ) : undefined
      }
    >
      {(aria) => (
        <>
          <button
            ref={triggerRef}
            id={fid}
            type="button"
            disabled={disabled}
            aria-haspopup="dialog"
            aria-expanded={open}
            data-popover-anchor="parent"
            onClick={() => setOpen((o) => !o)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && e.altKey) {
                e.preventDefault();
                setOpen(true);
              }
            }}
            className={cx(
              inputResetClass,
              "flex cursor-pointer items-center gap-2 text-left disabled:cursor-default",
            )}
            {...aria}
          >
            <CalendarDays
              aria-hidden
              size={18}
              className={cx(
                "shrink-0",
                disabled ? "text-label-3" : "text-accent-text",
              )}
            />
            <span className={cx("truncate", !current && "text-label-3")}>
              {isDateKey(current) ? formatFieldDate(current) : placeholder}
            </span>
          </button>
          <input
            ref={inputRef}
            tabIndex={-1}
            aria-hidden
            name={name}
            form={form}
            required={required}
            disabled={disabled}
            autoComplete="off"
            value={current}
            onChange={(e) => {
              if (!controlled) setInner(e.target.value);
              setMissing(false);
              onChange?.(e);
            }}
            onInvalid={(e) => {
              e.preventDefault();
              setMissing(true);
              triggerRef.current?.focus();
            }}
            className="pointer-events-none absolute size-px opacity-0"
          />
          <CalendarWindow
            open={open}
            onClose={() => setOpen(false)}
            anchorRef={triggerRef}
            title={label ?? "Date"}
            value={current}
            min={min}
            max={max}
            presets={presets}
            weekStartsOn={weekStartsOn}
            onClear={
              current && !required
                ? () => {
                    set("");
                    setOpen(false);
                  }
                : undefined
            }
            onSelect={(key) => {
              set(key);
              // Let the pick land visibly before the window leaves.
              setTimeout(() => setOpen(false), coarsePointer() ? 180 : 60);
            }}
          />
        </>
      )}
    </FieldShell>
  );
}

/* ---------------------------------------------------------- DatePickerButton */

/**
 * Any trigger that opens the calendar window (e.g. the schedule's date title).
 * `children` is the button's content.
 */
export function DatePickerButton({
  value,
  onSelect,
  label,
  title,
  className,
  children,
  min,
  max,
  presets,
}: {
  value: string;
  onSelect: (key: string) => void;
  /** Accessible name, e.g. "Choose a day". */
  label: string;
  title?: string;
  className?: string;
  children: ReactNode;
  min?: string;
  max?: string;
  presets?: readonly DatePreset[] | false;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={className}
      >
        {children}
      </button>
      <CalendarWindow
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={ref}
        title={title ?? label}
        value={value}
        min={min}
        max={max}
        presets={presets}
        onSelect={(key) => {
          setTimeout(() => setOpen(false), coarsePointer() ? 180 : 60);
          onSelect(key);
        }}
      />
    </>
  );
}
