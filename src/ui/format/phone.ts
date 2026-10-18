// As-you-type phone formatting for the client (no libphonenumber on the client:
// SPEC §14). NANP numbers get "(555) 123-4567"; "+…" international input is kept
// as typed digits. The server normalizes to E.164 with libphonenumber.

export function phoneDigits(s: string): string {
  return s.replace(/\D/g, "");
}

/**
 * Format partial input progressively: "123" → "123", "5551" → "(555) 1",
 * "15551234567" → "1 (555) 123-4567", "+15551234567" → "+1 (555) 123-4567".
 * Without "+", a leading 1 is a country code only once there are 11 digits, so
 * "123" isn't shown as "1 23" while typing (QA2 office).
 */
export function formatPhoneInput(raw: string): string {
  const trimmed = raw.trimStart();
  const intl = trimmed.startsWith("+");
  let d = phoneDigits(trimmed);
  if (!d) return intl ? "+" : "";
  let prefix = "";
  if (intl) {
    if (!d.startsWith("1")) return `+${d}`;
    prefix = "+1 ";
    d = d.slice(1);
  } else if (d.length === 11 && d.startsWith("1")) {
    prefix = "1 ";
    d = d.slice(1);
  }
  if (!d) return prefix.trimEnd();
  if (d.length > 10) return prefix ? `${prefix}${d}` : d; // too long: don't guess
  const a = d.slice(0, 3);
  const b = d.slice(3, 6);
  const c = d.slice(6);
  if (d.length <= 3) return prefix + (d.length === 3 && prefix ? `(${a})` : a);
  if (d.length <= 6) return `${prefix}(${a}) ${b}`;
  return `${prefix}(${a}) ${b}-${c}`;
}

/** Number of digits in `s` before index `pos`. */
export function digitsBefore(s: string, pos: number): number {
  let n = 0;
  for (let i = 0; i < pos && i < s.length; i++) {
    const ch = s.charCodeAt(i);
    if (ch >= 48 && ch <= 57) n++;
  }
  return n;
}

/** Caret index in `formatted` just after its `n`-th digit. */
export function caretAfterDigits(formatted: string, n: number): number {
  if (n <= 0) {
    // Keep the caret after a leading "+" if present.
    return formatted.startsWith("+") ? 1 : 0;
  }
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    const ch = formatted.charCodeAt(i);
    if (ch >= 48 && ch <= 57) {
      seen++;
      if (seen === n) return i + 1;
    }
  }
  return formatted.length;
}

/**
 * Apply an edit: returns the new formatted value and caret. When the user
 * backspaced over a formatting character (digit count unchanged, text shorter),
 * the digit before the caret is removed so deletion never gets stuck.
 */
export function applyPhoneEdit(
  prev: string,
  next: string,
  caret: number,
): { value: string; caret: number } {
  let raw = next;
  let pos = caret;
  if (
    next.length < prev.length &&
    phoneDigits(next) === phoneDigits(prev) &&
    phoneDigits(next).length > 0
  ) {
    const n = digitsBefore(next, pos);
    if (n > 0) {
      // Remove the n-th digit.
      let seen = 0;
      for (let i = 0; i < raw.length; i++) {
        const ch = raw.charCodeAt(i);
        if (ch >= 48 && ch <= 57 && ++seen === n) {
          raw = raw.slice(0, i) + raw.slice(i + 1);
          pos = i;
          break;
        }
      }
    }
  }
  const n = digitsBefore(raw, pos);
  const value = formatPhoneInput(raw);
  return { value, caret: caretAfterDigits(value, n) };
}
