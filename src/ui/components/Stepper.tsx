"use client";

import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import { cx } from "../cx";

/**
 * iOS −/+ stepper with a tabular value (SPEC §12.6). Controlled (`value` +
 * `onChange`) or uncontrolled (`defaultValue`); `name` submits the value in forms.
 * Each half has a ≥ 44 px hit area.
 */
export function Stepper({
  value,
  defaultValue = 0,
  onChange,
  min = 0,
  max = Number.POSITIVE_INFINITY,
  step = 1,
  name,
  label,
  format = (n) => String(n),
  showValue = true,
  className,
}: {
  value?: number;
  defaultValue?: number;
  onChange?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  name?: string;
  /** Accessible name, e.g. "Quantity". */
  label: string;
  /** Display formatter (e.g. quantities with 3 decimals). */
  format?: (n: number) => string;
  /** Render the value to the left of the control. */
  showValue?: boolean;
  className?: string;
}) {
  const [inner, setInner] = useState(defaultValue);
  const current = value ?? inner;
  const set = (n: number) => {
    // Avoid float drift for fractional steps.
    const next = Math.min(max, Math.max(min, Math.round(n * 1000) / 1000));
    setInner(next);
    onChange?.(next);
  };
  const btn =
    "relative flex h-9 w-12 items-center justify-center text-label outline-offset-[-2px] active:bg-fill disabled:text-label-3 before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']";
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would add unwanted chrome
    <div
      role="group"
      aria-label={label}
      className={cx("inline-flex items-center gap-3", className)}
    >
      {showValue && (
        <output
          aria-live="polite"
          className="num min-w-[2ch] text-right text-body"
        >
          {format(current)}
        </output>
      )}
      <div className="flex overflow-hidden rounded-pill bg-fill">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          className={btn}
          disabled={current <= min}
          onClick={() => set(current - step)}
        >
          <Minus aria-hidden size={18} strokeWidth={2.5} />
        </button>
        <span aria-hidden className="my-2.5 w-px bg-sep" />
        <button
          type="button"
          aria-label={`Increase ${label}`}
          className={btn}
          disabled={current >= max}
          onClick={() => set(current + step)}
        >
          <Plus aria-hidden size={18} strokeWidth={2.5} />
        </button>
      </div>
      {name && <input type="hidden" name={name} value={current} />}
    </div>
  );
}
