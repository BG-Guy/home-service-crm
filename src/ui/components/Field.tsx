import { ChevronDown } from "lucide-react";
import {
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
} from "react";
import { cx } from "../cx";

/*
 * Form fields (SPEC §12.6). All server-renderable (no client hooks), 17 px text so
 * iOS never zooms, error text wired via aria-invalid + aria-describedby.
 *
 * Two layouts:
 *  - `stacked` (default): label above a rounded field — standalone forms.
 *  - `row`: iOS Settings style inside a `<ListSection>`: label left, input right
 *    of it, transparent background, hairline separators from the list card.
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

function errText(e: FieldChromeProps["error"]): string | null {
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

/** Label + control + hint/error wrapper for custom controls (Toggle, Stepper, pickers). */
export function FormRow({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label?: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | string[] | null;
  children: ReactNode;
  className?: string;
}) {
  const msg = errText(error);
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="px-1 text-footnote font-medium text-label-2"
        >
          {label}
        </label>
      )}
      {children}
      {msg ? (
        <FieldError>{msg}</FieldError>
      ) : hint ? (
        <p className="px-1 text-footnote text-label-2">{hint}</p>
      ) : null}
    </div>
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
  children,
}: FieldChromeProps & {
  id: string;
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

/* -------------------------------------------------------------------------- */

export type TextFieldProps = FieldChromeProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "size"> & {
    /** Node before the input (icon, "$"). */
    leading?: ReactNode;
    /** Node after the input (unit, clear button). */
    trailing?: ReactNode;
    ref?: Ref<HTMLInputElement>;
  };

/** Single-line text input. `type` passes through (email, tel, number, url, password…). */
export function TextField({
  label,
  hideLabel,
  hint,
  error,
  layout,
  className,
  leading,
  trailing,
  id,
  ...input
}: TextFieldProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldShell
      id={fid}
      label={label}
      hideLabel={hideLabel}
      hint={hint}
      error={error}
      layout={layout}
      className={className}
      leading={leading}
      trailing={trailing}
    >
      {(aria) => (
        <input id={fid} className={inputResetClass} {...aria} {...input} />
      )}
    </FieldShell>
  );
}

export type TextAreaProps = FieldChromeProps &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> & {
    ref?: Ref<HTMLTextAreaElement>;
  };

/** Multi-line text. Grows with content where `field-sizing: content` is supported. */
export function TextArea({
  label,
  hideLabel,
  hint,
  error,
  layout,
  className,
  id,
  rows = 3,
  ...input
}: TextAreaProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldShell
      id={fid}
      label={label}
      hideLabel={hideLabel}
      hint={hint}
      error={error}
      layout={layout}
      className={className}
    >
      {(aria) => (
        <textarea
          id={fid}
          rows={rows}
          className={cx(
            inputResetClass,
            "min-h-[88px] resize-y [field-sizing:content]",
          )}
          {...aria}
          {...input}
        />
      )}
    </FieldShell>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export type SelectProps = FieldChromeProps &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, "className"> & {
    options?: readonly SelectOption[];
    /** Adds an empty first option. */
    placeholder?: string;
    ref?: Ref<HTMLSelectElement>;
  };

/** Native `<select>` (iOS shows its wheel picker) styled as an iOS field. */
export function Select({
  label,
  hideLabel,
  hint,
  error,
  layout,
  className,
  id,
  options,
  placeholder,
  children,
  ...input
}: SelectProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldShell
      id={fid}
      label={label}
      hideLabel={hideLabel}
      hint={hint}
      error={error}
      layout={layout}
      className={className}
      trailing={
        <ChevronDown
          aria-hidden
          size={18}
          className="pointer-events-none -ml-7 shrink-0 text-label-3"
        />
      }
    >
      {(aria) => (
        <select
          id={fid}
          className={cx(inputResetClass, "cursor-pointer appearance-none pr-7")}
          {...aria}
          {...input}
        >
          {placeholder != null && <option value="">{placeholder}</option>}
          {options?.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
          {children}
        </select>
      )}
    </FieldShell>
  );
}

/** Native date picker (`YYYY-MM-DD`). */
export function DateField(props: Omit<TextFieldProps, "type">) {
  return <TextField type="date" {...props} />;
}

/** Native time picker (`HH:MM`). `step={900}` gives 15-minute steps. */
export function TimeField(props: Omit<TextFieldProps, "type">) {
  return <TextField type="time" {...props} />;
}
