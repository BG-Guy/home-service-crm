"use client";

import { Clock } from "lucide-react";
import {
  type ChangeEventHandler,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cx } from "../cx";
import { haptic } from "../motion/haptics";
import { prefersReducedMotion } from "../motion/springs";
import { Button } from "./Button";
import {
  type FieldChromeProps,
  FieldShell,
  inputResetClass,
} from "./field-chrome";
import {
  formatHm,
  formatTime12,
  type Hm,
  minuteOptions,
  nearestMinute,
  parseHm,
  to12,
  to24,
} from "./picker-math";
import { Sheet } from "./Sheet";

/*
 * Time field (SPEC §12.6) — no typing on touch screens, real keyboard entry with a mouse.
 * - Touch (`pointer: coarse`): the field opens a sheet with iOS Clock-style wheels
 *   (hour · minute · AM/PM) that scroll, snap and loop; Done commits, Cancel doesn't.
 * - Mouse / trackpad (`pointer: fine`): hour and minute segments you type into
 *   (digits auto-advance), ↑/↓ step (minutes by `step`), ←/→ move, Backspace clears,
 *   A / P set the half of the day, plus AM / PM toggle buttons.
 * Both variants render; CSS shows the one for the device (`.tp-fine` / `.tp-coarse`
 * in globals.css), so there's no hydration flash. Values stay 'HH:MM' (24 h).
 */

export interface TimeFieldProps extends FieldChromeProps {
  id?: string;
  name?: string;
  /** Controlled value ('HH:MM', 24 h, or ""). */
  value?: string;
  defaultValue?: string;
  /** A real change event from the field's input (`e.target.value`). */
  onChange?: ChangeEventHandler<HTMLInputElement>;
  /** Seconds, like the native input: 900 = 15-minute steps. */
  step?: number | string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  form?: string;
}

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

export function TimeField({
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
  step,
  required,
  disabled,
  placeholder = "Choose a time",
  form,
}: TimeFieldProps) {
  const auto = useId();
  const fid = id ?? auto;
  const labelId = `${fid}-label`;
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue ?? "");
  const current = (controlled ? value : inner) ?? "";
  const [open, setOpen] = useState(false);
  const [missing, setMissing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const segRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const minutes = minuteOptions(step);

  const set = (v: string) => {
    if (v !== current) emitInput(inputRef.current, v);
  };

  return (
    <FieldShell
      id={fid}
      labelId={labelId}
      label={label}
      hideLabel={hideLabel}
      hint={hint}
      error={error ?? (missing ? "Choose a time." : null)}
      layout={layout}
      className={className}
    >
      {(aria) => (
        <>
          <TimeSegments
            className="tp-fine"
            value={current}
            onCommit={set}
            minutes={minutes}
            disabled={disabled}
            labelledBy={label ? labelId : undefined}
            describedBy={aria["aria-describedby"]}
            invalid={aria["aria-invalid"]}
            groupRef={segRef}
          />
          <button
            ref={buttonRef}
            id={fid}
            type="button"
            disabled={disabled}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen(true)}
            className={cx(
              inputResetClass,
              "tp-coarse cursor-pointer items-center gap-2 text-left disabled:cursor-default",
            )}
            {...aria}
          >
            <Clock
              aria-hidden
              size={18}
              className={cx(
                "shrink-0",
                disabled ? "text-label-3" : "text-accent-text",
              )}
            />
            <span className={cx("num truncate", !current && "text-label-3")}>
              {formatTime12(current) || placeholder}
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
              const fine =
                segRef.current?.querySelector<HTMLElement>("[role=spinbutton]");
              if (fine?.offsetParent) fine.focus();
              else buttonRef.current?.focus();
            }}
            className="pointer-events-none absolute size-px opacity-0"
          />
          <WheelSheet
            open={open}
            onClose={() => setOpen(false)}
            title={label ?? "Time"}
            value={current}
            minutes={minutes}
            onDone={(v) => {
              set(v);
              setOpen(false);
            }}
          />
        </>
      )}
    </FieldShell>
  );
}

/* ------------------------------------------------------- typed (fine pointer) */

type Seg = "h" | "m";

function nowRounded(minutes: readonly number[]): Hm {
  const d = new Date();
  return { h: d.getHours(), m: nearestMinute(d.getMinutes(), minutes) };
}

/**
 * Hour / minute spinbutton segments + AM/PM toggle. Typing "9" → 9 and jumps to the
 * minutes; "1" waits briefly for 0–2 (10–12). Minutes take two digits, or one ≥ 6.
 */
function TimeSegments({
  value,
  onCommit,
  minutes,
  disabled,
  labelledBy,
  describedBy,
  invalid,
  className,
  groupRef,
}: {
  value: string;
  onCommit: (v: string) => void;
  minutes: readonly number[];
  disabled?: boolean;
  labelledBy?: string;
  describedBy?: string;
  invalid?: true;
  className?: string;
  groupRef: RefObject<HTMLDivElement | null>;
}) {
  const parsed = parseHm(value);
  const [h12, setH12] = useState<number | null>(
    parsed ? to12(parsed.h).h12 : null,
  );
  const [min, setMin] = useState<number | null>(parsed?.m ?? null);
  const [pm, setPm] = useState<boolean | null>(
    parsed ? to12(parsed.h).pm : null,
  );
  const [typing, setTyping] = useState<{ seg: Seg; text: string } | null>(null);
  const buffer = useRef<{ seg: Seg; digits: string; at: number } | null>(null);
  const hRef = useRef<HTMLSpanElement>(null);
  const mRef = useRef<HTMLSpanElement>(null);
  const amRef = useRef<HTMLButtonElement>(null);
  const pmRef = useRef<HTMLButtonElement>(null);

  // Follow outside changes (another control, a reset) unless they echo our own edit.
  const last = useRef(value);
  useEffect(() => {
    if (value === last.current) return;
    last.current = value;
    const p = parseHm(value);
    setH12(p ? to12(p.h).h12 : null);
    setMin(p ? p.m : null);
    setPm(p ? to12(p.h).pm : null);
  }, [value]);

  const push = (nh: number | null, nm: number | null, npm: boolean | null) => {
    setH12(nh);
    setMin(nm);
    setPm(npm);
    const next =
      nh != null && nm != null && npm != null
        ? formatHm({ h: to24(nh, npm), m: nm })
        : "";
    // Partial entries don't clear a value until a segment is actually emptied.
    if (next || nh == null || nm == null) {
      last.current = next;
      onCommit(next);
    }
  };

  /** Fill the blanks so a first keystroke yields a whole time. */
  const seed = () => {
    if (h12 != null && min != null && pm != null) return { h12, min, pm };
    const n = to12(nowRounded(minutes).h);
    return {
      h12: h12 ?? n.h12,
      min: min ?? 0,
      pm: pm ?? n.pm,
    };
  };

  const stepMin = (minutes[1] ?? 1) - (minutes[0] ?? 0) || 1;

  const onKey = (seg: Seg, e: ReactKeyboardEvent<HTMLSpanElement>) => {
    const k = e.key;
    if (k === "Tab" || e.metaKey || e.ctrlKey || e.altKey) return;
    const s = seed();
    if (/^\d$/.test(k)) {
      e.preventDefault();
      const d = Number(k);
      const now = Date.now();
      const prev =
        buffer.current?.seg === seg && now - buffer.current.at < 1500
          ? buffer.current.digits
          : "";
      if (seg === "h") {
        const both = Number(prev + k);
        if (prev && both >= 1 && both <= 12) {
          buffer.current = null;
          setTyping(null);
          push(both, s.min, s.pm);
          mRef.current?.focus();
        } else if (d >= 2) {
          buffer.current = null;
          setTyping(null);
          push(d, s.min, s.pm);
          mRef.current?.focus();
        } else {
          // 0 or 1: wait for a second digit (01–09, 10–12).
          buffer.current = { seg, digits: k, at: now };
          setTyping({ seg, text: k });
          if (d === 1) push(1, s.min, s.pm);
        }
      } else {
        if (prev) {
          buffer.current = null;
          setTyping(null);
          push(s.h12, Number(prev + k), s.pm);
          (pm ? pmRef : amRef).current?.focus();
        } else if (d >= 6) {
          push(s.h12, d, s.pm);
          (pm ? pmRef : amRef).current?.focus();
        } else {
          buffer.current = { seg, digits: k, at: now };
          setTyping(null);
          push(s.h12, d, s.pm);
        }
      }
      return;
    }
    buffer.current = null;
    setTyping(null);
    if (k === "ArrowUp" || k === "ArrowDown") {
      e.preventDefault();
      const up = k === "ArrowUp" ? 1 : -1;
      if ((seg === "h" ? h12 : min) == null) {
        // First arrow on an empty segment shows the current time.
        push(s.h12, s.min, s.pm);
      } else if (seg === "h") {
        push((((h12 ?? 12) - 1 + up + 12) % 12) + 1, s.min, s.pm);
      } else {
        const m = min ?? 0;
        const next =
          up > 0
            ? (Math.floor(m / stepMin) + 1) * stepMin
            : (Math.ceil(m / stepMin) - 1) * stepMin;
        push(s.h12, ((next % 60) + 60) % 60, s.pm);
      }
    } else if (k === "ArrowRight") {
      e.preventDefault();
      if (seg === "h") mRef.current?.focus();
      else (pm ? pmRef : amRef).current?.focus();
    } else if (k === "ArrowLeft") {
      e.preventDefault();
      if (seg === "m") hRef.current?.focus();
    } else if (k === "Backspace" || k === "Delete") {
      e.preventDefault();
      if (seg === "h") push(null, min, pm);
      else push(h12, null, pm);
    } else if (k === "a" || k === "A" || k === "p" || k === "P") {
      e.preventDefault();
      push(s.h12, s.min, k.toLowerCase() === "p");
    } else if (k === ":" || k === " ") {
      e.preventDefault();
      if (seg === "h") mRef.current?.focus();
    }
  };

  const onMeridiemKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const k = e.key;
    const s = seed();
    if (k === "ArrowLeft" && document.activeElement === amRef.current) {
      e.preventDefault();
      mRef.current?.focus();
    } else if (
      k === "ArrowLeft" ||
      k === "ArrowRight" ||
      k === "ArrowUp" ||
      k === "ArrowDown"
    ) {
      e.preventDefault();
      const next = k === "ArrowLeft" ? false : k === "ArrowRight" ? true : !pm;
      push(s.h12, s.min, next);
      (next ? pmRef : amRef).current?.focus();
    } else if (/^[aApP]$/.test(k)) {
      e.preventDefault();
      const next = k.toLowerCase() === "p";
      push(s.h12, s.min, next);
      (next ? pmRef : amRef).current?.focus();
    }
  };

  const seg = (
    which: Seg,
    ref: RefObject<HTMLSpanElement | null>,
    v: number | null,
  ) => {
    const text =
      typing?.seg === which
        ? typing.text
        : v == null
          ? "––"
          : which === "h"
            ? String(v)
            : String(v).padStart(2, "0");
    return (
      <span
        ref={ref}
        role="spinbutton"
        tabIndex={disabled ? -1 : 0}
        aria-label={which === "h" ? "Hours" : "Minutes"}
        aria-valuemin={which === "h" ? 1 : 0}
        aria-valuemax={which === "h" ? 12 : 59}
        aria-valuenow={v ?? undefined}
        aria-valuetext={
          v == null ? "Empty" : which === "h" ? String(v) : `${v} minutes`
        }
        aria-disabled={disabled || undefined}
        onKeyDown={(e) => !disabled && onKey(which, e)}
        onBlur={() => {
          if (buffer.current?.seg === which) {
            buffer.current = null;
            setTyping(null);
          }
        }}
        className={cx(
          "num inline-flex min-w-[2ch] justify-center rounded-[6px] px-1 py-0.5 outline-none tabular-nums focus:bg-accent focus:text-on-accent",
          v == null && "text-label-3",
          which === "h" && "text-right",
        )}
      >
        {text}
      </span>
    );
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset can't sit inside the field box's flex row
    <div
      ref={groupRef}
      role="group"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-invalid={invalid}
      className={cx(
        "min-w-0 flex-1 items-center gap-1.5 py-[7px] text-body",
        disabled && "text-label-3",
        className,
      )}
    >
      <Clock
        aria-hidden
        size={18}
        className={cx(
          "shrink-0",
          disabled ? "text-label-3" : "text-accent-text",
        )}
      />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: clicking the blank area focuses the hours */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the segments carry the keyboard handling */}
      <span
        className="flex items-center"
        onClick={(e) => {
          if (e.target === e.currentTarget) hRef.current?.focus();
        }}
      >
        {seg("h", hRef, h12)}
        <span aria-hidden className="px-0.5 text-label-2">
          :
        </span>
        {seg("m", mRef, min)}
      </span>
      {/* biome-ignore lint/a11y/useSemanticElements: two toggle buttons acting as one radio-like pair */}
      <div
        role="group"
        aria-label="AM or PM"
        className="ml-auto flex shrink-0 rounded-[8px] bg-fill-2 p-0.5"
      >
        {(["AM", "PM"] as const).map((x) => {
          const on = pm === (x === "PM");
          return (
            <button
              key={x}
              ref={x === "AM" ? amRef : pmRef}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              tabIndex={on || (pm == null && x === "AM") ? 0 : -1}
              onClick={() => {
                const s = seed();
                push(s.h12, s.min, x === "PM");
              }}
              onKeyDown={onMeridiemKey}
              className={cx(
                "min-h-7 min-w-[30px] rounded-[6px] px-1 text-caption font-semibold outline-offset-1 transition-[background-color,color,box-shadow] duration-200",
                on
                  ? "bg-[var(--seg-thumb)] text-label shadow-[0_2px_6px_rgb(0_0_0/0.12)]"
                  : "text-label-2 hover:text-label",
              )}
            >
              {x}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- wheels (touch) */

const ITEM_H = 40;
const VISIBLE = 5;

function WheelSheet({
  open,
  onClose,
  title,
  value,
  minutes,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  value: string;
  minutes: readonly number[];
  onDone: (v: string) => void;
}) {
  const [draft, setDraft] = useState<{ h12: number; m: number; pm: boolean }>(
    () => draftFrom(value, minutes),
  );
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDraft(draftFrom(value, minutes));
  }
  const minuteList = minutes.includes(draft.m)
    ? minutes
    : [...minutes, draft.m].sort((a, b) => a - b);

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
      trailing={
        <Button
          variant="plain"
          size="sm"
          className="font-semibold"
          onClick={() =>
            onDone(formatHm({ h: to24(draft.h12, draft.pm), m: draft.m }))
          }
        >
          Done
        </Button>
      }
    >
      <div className="pb-4 pt-1">
        <div className="wheels relative mx-auto flex max-w-[300px] justify-center">
          <div aria-hidden className="wheel-band" />
          <Wheel
            label="Hour"
            items={HOURS}
            value={draft.h12}
            loop
            onChange={(h12) => setDraft((d) => ({ ...d, h12 }))}
            align="end"
          />
          <Wheel
            label="Minute"
            items={minuteList}
            value={draft.m}
            loop={minuteList.length > 2}
            format={(m) => String(m).padStart(2, "0")}
            onChange={(m) => setDraft((d) => ({ ...d, m }))}
          />
          <Wheel
            label="AM or PM"
            items={MERIDIEM}
            value={draft.pm ? 1 : 0}
            format={(i) => (i ? "PM" : "AM")}
            onChange={(i) => setDraft((d) => ({ ...d, pm: i === 1 }))}
            align="start"
          />
        </div>
      </div>
    </Sheet>
  );
}

const HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const MERIDIEM = [0, 1];

function draftFrom(value: string, minutes: readonly number[]) {
  const t = parseHm(value) ?? nowRounded(minutes);
  const { h12, pm } = to12(t.h);
  return { h12, m: t.m, pm };
}

/**
 * One scroll-snapping wheel. Looping wheels repeat their items and quietly jump
 * back to the middle copy after each fling, so they spin forever like iOS's.
 * A listbox for assistive tech: ↑/↓ step, tapping an item centers it.
 */
function Wheel({
  label,
  items,
  value,
  onChange,
  loop,
  format = String,
  align = "center",
}: {
  label: string;
  items: readonly number[];
  value: number;
  onChange: (v: number) => void;
  loop?: boolean;
  format?: (v: number) => string;
  align?: "start" | "center" | "end";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const n = items.length;
  const reps = loop ? 9 : 1;
  const mid = loop ? Math.floor(reps / 2) * n : 0;
  const [centered, setCentered] = useState(() =>
    Math.max(0, mid + items.indexOf(value)),
  );
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTick = useRef(centered);
  const baseId = useId();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Start centered on the value (no animation).
  // biome-ignore lint/correctness/useExhaustiveDependencies: initial position only
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = centered * ITEM_H;
  }, []);

  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );

  const valueAt = (i: number) => items[((i % n) + n) % n] as number;
  // After a fling: report the final item, then quietly jump back to the middle copy.
  const settle = () => {
    const el = ref.current;
    if (!el) return;
    const i = Math.round(el.scrollTop / ITEM_H);
    onChangeRef.current(valueAt(i));
    if (loop) {
      const local = ((i % n) + n) % n;
      const target = mid + local;
      if (Math.abs(i - target) >= n) {
        el.scrollTop = target * ITEM_H;
        setCentered(target);
        lastTick.current = target;
      }
    }
  };

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const i = Math.round(el.scrollTop / ITEM_H);
    if (i !== lastTick.current) {
      lastTick.current = i;
      setCentered(i);
      // Report every tick, so "Done" right after a flick keeps what's centered.
      onChangeRef.current(valueAt(i));
      haptic();
    }
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(settle, 140);
  };

  const scrollToIndex = (i: number) => {
    ref.current?.scrollTo({
      top: i * ITEM_H,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  };

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const k = e.key;
    if (k === "ArrowDown" || k === "ArrowUp") {
      e.preventDefault();
      const next = centered + (k === "ArrowDown" ? 1 : -1);
      if (!loop && (next < 0 || next >= n)) return;
      scrollToIndex(next);
    } else if (k === "Home" || k === "End") {
      e.preventDefault();
      scrollToIndex(mid + (k === "Home" ? 0 : n - 1));
    }
  };

  const total = n * reps;
  const activeId = `${baseId}-${centered}`;
  return (
    <div
      ref={ref}
      role="listbox"
      tabIndex={0}
      aria-label={label}
      aria-activedescendant={activeId}
      onScroll={onScroll}
      onKeyDown={onKey}
      className="wheel"
      style={{
        height: ITEM_H * VISIBLE,
        paddingBlock: (ITEM_H * (VISIBLE - 1)) / 2,
      }}
    >
      {Array.from({ length: total }, (_, i) => {
        const v = items[i % n] as number;
        const on = i === centered;
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: repeated copies of the same values
            key={i}
            id={`${baseId}-${i}`}
            role="option"
            aria-selected={on}
            tabIndex={-1}
            onClick={() => scrollToIndex(i)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                scrollToIndex(i);
              }
            }}
            className={cx(
              "wheel-item num",
              align === "end" && "justify-end pr-3",
              align === "start" && "justify-start pl-3",
              on ? "text-label" : "text-label-2",
            )}
            style={{ height: ITEM_H }}
          >
            {format(v)}
          </div>
        );
      })}
    </div>
  );
}
