"use client";

import { useId, useMemo, useRef, useState } from "react";
import { parseMoneyToCents } from "@/lib/money";
import { type FieldChromeProps, FieldShell, inputResetClass } from "./Field";

function symbolFor(currency: string, locale: string): string {
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? "$";
  } catch {
    return "$";
  }
}

function display(cents: number | null, locale: string): string {
  if (cents == null) return "";
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** More than two digits after the decimal point ("12.345"): not a typed amount. */
const PAST_CENTS = /\.\d{3,}/;

const parseTyped = (raw: string) => parseMoneyToCents(raw, { strict: true });

/**
 * Currency input that works in integer cents (SPEC §6.1). The visible text is
 * free-form ("1,234.5", "$20") and is reformatted on blur; a hidden input named
 * `name` submits the parsed cents as an integer string ("" when empty).
 * Editing: a $0 value clears to the "0.00" placeholder on focus and any other
 * value is selected, so typing replaces it; a third decimal digit is refused.
 *
 * ```tsx
 * <MoneyField name="amountCents" label="Amount" defaultCents={12500} />
 * ```
 */
export function MoneyField({
  name,
  valueCents,
  defaultCents = null,
  onChangeCents,
  currency = "USD",
  locale = "en-US",
  allowNegative = false,
  min,
  max,
  placeholder = "0.00",
  required,
  disabled,
  id,
  error,
  ...chrome
}: FieldChromeProps & {
  /** Hidden input name carrying cents. */
  name?: string;
  /** Controlled value in cents (`null` = empty). */
  valueCents?: number | null;
  defaultCents?: number | null;
  onChangeCents?: (cents: number | null) => void;
  currency?: string;
  locale?: string;
  allowNegative?: boolean;
  /** Bounds in cents (validated on blur). */
  min?: number;
  max?: number;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
}) {
  const auto = useId();
  const fid = id ?? auto;
  const symbol = useMemo(() => symbolFor(currency, locale), [currency, locale]);
  const [text, setText] = useState(() =>
    display(valueCents ?? defaultCents, locale),
  );
  const [focused, setFocused] = useState(false);
  // A $0 value cleared on focus still means $0 until the user types something.
  const [zeroCleared, setZeroCleared] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  // Chrome collapses a focus-time selection on the click's mouseup; skip that one.
  const keepSelection = useRef(false);
  const fromText = (raw: string): number | null =>
    raw.trim() ? parseTyped(raw) : zeroCleared ? 0 : null;
  const parsed = fromText(text);
  const cents = valueCents !== undefined && !focused ? valueCents : parsed;
  const shown =
    valueCents !== undefined && !focused ? display(valueCents, locale) : text;

  const validate = (c: number | null, raw: string): string | null => {
    if (raw.trim() && c == null) return "Enter an amount, like 125.00";
    if (c != null && !allowNegative && c < 0) return "Amount can't be negative";
    if (c != null && min != null && c < min)
      return `Minimum is ${symbol}${display(min, locale)}`;
    if (c != null && max != null && c > max)
      return `Maximum is ${symbol}${display(max, locale)}`;
    return null;
  };

  return (
    <FieldShell
      id={fid}
      error={localError ?? error}
      {...chrome}
      leading={
        <span aria-hidden className="text-body text-label-2">
          {symbol}
        </span>
      }
    >
      {(aria) => (
        <>
          <input
            id={fid}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder={placeholder}
            required={required}
            disabled={disabled}
            value={shown}
            className={`${inputResetClass} num`}
            onFocus={(e) => {
              setFocused(true);
              const current = valueCents !== undefined ? valueCents : parsed;
              if (current === 0) {
                setText("");
                setZeroCleared(true);
                return;
              }
              const el = e.currentTarget;
              if (valueCents !== undefined) {
                const t = display(valueCents, locale);
                setText(t);
                el.value = t;
              }
              el.setSelectionRange(0, el.value.length);
              keepSelection.current = true;
            }}
            onMouseUp={(e) => {
              if (keepSelection.current) e.preventDefault();
              keepSelection.current = false;
            }}
            onChange={(e) => {
              keepSelection.current = false;
              const raw = e.currentTarget.value;
              if (PAST_CENTS.test(raw.replace(/[\s,]/g, ""))) return;
              setText(raw);
              const c = fromText(raw);
              if (localError) setLocalError(validate(c, raw));
              if (c != null || !raw.trim()) onChangeCents?.(c);
            }}
            onBlur={() => {
              setFocused(false);
              keepSelection.current = false;
              const c = fromText(text);
              setZeroCleared(false);
              setLocalError(validate(c, text));
              if (c != null) setText(display(c, locale));
            }}
            {...aria}
          />
          {name && (
            <input
              type="hidden"
              name={name}
              value={cents == null ? "" : String(cents)}
            />
          )}
        </>
      )}
    </FieldShell>
  );
}
