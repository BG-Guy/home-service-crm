"use client";

import { Check } from "lucide-react";
import { useId, useState } from "react";
import { cx } from "@/ui/cx";

export interface SwatchOption {
  value: string;
  /** CSS color to paint (defaults to `value`). */
  css?: string;
  name: string;
}

/**
 * Color picker as a radio group of 32 px swatches (44 px hit area). Controlled
 * (`value`/`onChange`) or uncontrolled with `name` for plain forms.
 */
export function ColorSwatches({
  label,
  options,
  value,
  defaultValue,
  onChange,
  name,
  allowNone,
  className,
}: {
  label: string;
  options: readonly SwatchOption[];
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (v: string) => void;
  name?: string;
  /** Adds a "none" choice (value ""). */
  allowNone?: boolean;
  className?: string;
}) {
  const auto = useId();
  const [inner, setInner] = useState(defaultValue ?? "");
  const current = (value ?? inner ?? "").toLowerCase();
  const all = allowNone
    ? [{ value: "", name: "None", css: "transparent" }, ...options]
    : options;
  return (
    <fieldset className={className}>
      <legend className="mb-1.5 text-subhead font-medium text-label-2">
        {label}
      </legend>
      <div className="flex flex-wrap gap-1">
        {all.map((o) => {
          const on = current === o.value.toLowerCase();
          return (
            <label
              key={o.value || "none"}
              title={o.name}
              className="relative flex size-11 cursor-pointer items-center justify-center"
            >
              <input
                type="radio"
                className="peer sr-only"
                name={name ?? auto}
                value={o.value}
                checked={on}
                onChange={() => {
                  setInner(o.value);
                  onChange?.(o.value);
                }}
              />
              <span className="sr-only">{o.name}</span>
              <span
                aria-hidden
                className={cx(
                  "flex size-8 items-center justify-center rounded-full transition-transform duration-200 [transition-timing-function:var(--ease-spring-snappy)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent",
                  on &&
                    "scale-110 ring-2 ring-offset-2 ring-offset-[var(--card)]",
                  o.value === "" && "border border-dashed border-label-3",
                )}
                style={{
                  background: o.css ?? o.value,
                  ["--tw-ring-color" as string]: o.css ?? o.value,
                }}
              >
                {on && o.value !== "" && (
                  <Check
                    size={16}
                    strokeWidth={3}
                    className="text-white drop-shadow"
                  />
                )}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
