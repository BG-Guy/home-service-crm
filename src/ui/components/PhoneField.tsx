"use client";

import {
  type ChangeEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { applyPhoneEdit, formatPhoneInput } from "../format/phone";
import { type FieldChromeProps, FieldShell, inputResetClass } from "./Field";

/**
 * Phone input that formats as you type — "(555) 123-4567" for NANP, raw digits
 * after "+" otherwise — with caret preservation and clean backspacing. Submits
 * the formatted text under `name`; the server normalizes to E.164.
 * No libphonenumber on the client (SPEC §14).
 */
export function PhoneField({
  name,
  value,
  defaultValue = "",
  onValueChange,
  placeholder = "(555) 123-4567",
  required,
  disabled,
  autoFocus,
  id,
  ...chrome
}: FieldChromeProps & {
  name?: string;
  /** Controlled formatted value. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (formatted: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  id?: string;
}) {
  const auto = useId();
  const fid = id ?? auto;
  const ref = useRef<HTMLInputElement>(null);
  const [inner, setInner] = useState(() => formatPhoneInput(defaultValue));
  const current = value ?? inner;
  const caret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && caret.current != null && document.activeElement === el) {
      el.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  });

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    const next = applyPhoneEdit(
      current,
      el.value,
      el.selectionStart ?? el.value.length,
    );
    caret.current = next.caret;
    setInner(next.value);
    onValueChange?.(next.value);
  };

  return (
    <FieldShell id={fid} {...chrome}>
      {(aria) => (
        <input
          ref={ref}
          id={fid}
          name={name}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          // biome-ignore lint/a11y/noAutofocus: opt-in by the caller
          autoFocus={autoFocus}
          value={current}
          onChange={onChange}
          className={inputResetClass}
          {...aria}
        />
      )}
    </FieldShell>
  );
}
