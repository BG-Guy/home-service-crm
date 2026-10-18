"use client";

import { type CSSProperties, type ReactNode, useId, useState } from "react";
import { cx } from "../cx";

export interface Segment<V extends string = string> {
  value: V;
  label: ReactNode;
  disabled?: boolean;
}

/**
 * iOS segmented control (2–5 segments) with a sliding thumb (`translate` +
 * `--ease-spring-snappy`). Built on native radio inputs: arrow keys, form
 * submission (`name`) and screen readers work without extra code.
 *
 * ```tsx
 * <SegmentedControl label="View" value={view} onChange={setView}
 *   segments={[{ value: "day", label: "Day" }, { value: "week", label: "Week" }]} />
 * ```
 */
export function SegmentedControl<V extends string>({
  segments,
  value,
  defaultValue,
  onChange,
  name,
  label,
  className,
  size = "md",
}: {
  segments: readonly Segment<V>[];
  /** Controlled value. */
  value?: V;
  /** Uncontrolled initial value (defaults to the first segment). */
  defaultValue?: V;
  onChange?: (value: V) => void;
  /** Form field name. */
  name?: string;
  /** Accessible group label. */
  label: string;
  className?: string;
  /** `md` 32 px tall (default), `lg` 40 px. */
  size?: "md" | "lg";
}) {
  const autoName = useId();
  const [inner, setInner] = useState<V | undefined>(
    defaultValue ?? segments[0]?.value,
  );
  const [pressed, setPressed] = useState(false);
  const current = value ?? inner;
  const index = Math.max(
    0,
    segments.findIndex((s) => s.value === current),
  );
  const style = {
    "--n": segments.length,
    "--i": index,
  } as CSSProperties;

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx("seg", className)}
      style={style}
      data-pressed={pressed || undefined}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
    >
      <span aria-hidden className="seg-thumb" />
      {segments.map((s) => (
        <label
          key={s.value}
          className={cx("seg-item", size === "lg" && "min-h-9 text-subhead")}
        >
          <input
            type="radio"
            className="sr-only"
            name={name ?? autoName}
            value={s.value}
            checked={current === s.value}
            disabled={s.disabled}
            onChange={() => {
              setInner(s.value);
              onChange?.(s.value);
            }}
          />
          <span className="truncate">{s.label}</span>
        </label>
      ))}
    </div>
  );
}
