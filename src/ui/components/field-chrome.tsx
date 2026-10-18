import type { ReactNode } from "react";
import { cx } from "../cx";

/*
 * Field chrome shared by every form control (SPEC §12.6): the label / hint / error
 * wrapper and the field box classes. `Field.tsx` re-exports all of it; client
 * controls (DatePicker, TimePicker) import it from here so they don't import
 * `Field.tsx`, which re-exports them.
 */

export type FieldLayout = "stacked" | "row";

export interface FieldChromeProps {
  label?: ReactNode;
  /** Visually hide the label (still read by screen readers). */
  hideLabel?: boolean;
  hint?: ReactNode;
  /** Error message(s), e.g. `fieldErrors.email` from an ActionResult. */
  error?: string | string[] | null;
  layout?: FieldLayout;
  /** Extra classes on the outer wrapper. */
  className?: string;
}

export function errText(e: FieldChromeProps["error"]): string | null {
  if (!e) return null;
  return Array.isArray(e) ? e.filter(Boolean).join(" ") || null : e;
}

/** Inline validation message. `role="alert"` is avoided so it doesn't steal focus; it's linked via aria-describedby. */
export function FieldError({
  id,
  children,
}: {
  id?: string;
  children?: ReactNode;
}) {
  if (!children) return null;
  return (
    <p id={id} className="px-1 pt-1 text-footnote text-danger">
      {children}
    </p>
  );
}

/** Class for a stacked field box (exported for custom inputs like MoneyField). */
export const fieldBoxClass =
  "flex min-h-11 w-full items-center gap-2 rounded-control bg-card px-3.5 text-body text-label shadow-[inset_0_0_0_0.5px_var(--sep)] focus-within:shadow-[inset_0_0_0_2px_var(--accent)] has-[[aria-invalid=true]]:shadow-[inset_0_0_0_1.5px_var(--sys-red)]";

export const inputResetClass =
  "w-full min-w-0 flex-1 bg-transparent py-[11px] text-body text-label outline-none placeholder:text-label-3 disabled:text-label-3";

/**
 * Shared chrome: renders label/hint/error around `children(ids)`.
 * Exported for client fields that need the same look (MoneyField, PhoneField).
 */
export function FieldShell({
  id,
  label,
  hideLabel,
  hint,
  error,
  layout = "stacked",
  className,
  leading,
  trailing,
  labelId,
  children,
}: FieldChromeProps & {
  id: string;
  /** `id` for the `<label>` (for controls named via `aria-labelledby`). */
  labelId?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  children: (a: {
    "aria-invalid"?: true;
    "aria-describedby"?: string;
  }) => ReactNode;
}) {
  const msg = errText(error);
  const descId = msg || hint ? `${id}-desc` : undefined;
  const aria = {
    "aria-invalid": msg ? (true as const) : undefined,
    "aria-describedby": descId,
  };
  const desc = msg ? (
    <FieldError id={descId}>{msg}</FieldError>
  ) : hint ? (
    <p id={descId} className="px-1 pt-1 text-footnote text-label-2">
      {hint}
    </p>
  ) : null;

  if (layout === "row") {
    return (
      <div className={cx("list-row px-4", className)}>
        <div className="flex min-h-11 items-center gap-3">
          {label && (
            <label
              id={labelId}
              htmlFor={id}
              className={cx(
                "w-[38%] max-w-40 shrink-0 text-body",
                hideLabel && "sr-only",
              )}
            >
              {label}
            </label>
          )}
          {leading}
          {children(aria)}
          {trailing}
        </div>
        {desc && <div className="-mt-1 pb-2">{desc}</div>}
      </div>
    );
  }
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      {label && (
        <label
          id={labelId}
          htmlFor={id}
          className={cx(
            "px-1 text-footnote font-medium text-label-2",
            hideLabel && "sr-only",
          )}
        >
          {label}
        </label>
      )}
      <div className={fieldBoxClass}>
        {leading}
        {children(aria)}
        {trailing}
      </div>
      {desc}
    </div>
  );
}
