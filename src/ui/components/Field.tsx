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
import {
  errText,
  type FieldChromeProps,
  FieldError,
  FieldShell,
  inputResetClass,
} from "./field-chrome";

/*
 * Form fields (SPEC §12.6). All server-renderable (no client hooks), 17 px text so
 * iOS never zooms, error text wired via aria-invalid + aria-describedby.
 *
 * Two layouts:
 *  - `stacked` (default): label above a rounded field — standalone forms.
 *  - `row`: iOS Settings style inside a `<ListSection>`: label left, input right
 *    of it, transparent background, hairline separators from the list card.
 */

export type { FieldChromeProps, FieldLayout } from "./field-chrome";
export {
  FieldError,
  FieldShell,
  fieldBoxClass,
  inputResetClass,
} from "./field-chrome";

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

/** Date field (`YYYY-MM-DD`): opens the calendar sheet / popover (`DatePicker.tsx`). */
export { DateField } from "./DatePicker";

/** Time field (`HH:MM`): iOS wheels on touch, typed segments + AM/PM on desktop (`TimePicker.tsx`). */
export { TimeField } from "./TimePicker";
