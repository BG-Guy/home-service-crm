/**
 * Display-only phone formatting that is safe on both server and client.
 * It doesn't depend on libphonenumber, so client bundles stay small.
 * Server code that needs validation or normalization should keep using `@/lib/phone`.
 *
 * North American numbers (+1 and 10 digits) render as "(512) 555-0100".
 * Anything else is returned as given, so a value is never mangled.
 */
export function formatPhoneDisplay(value: string | null | undefined): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  const national =
    digits.length === 11 && digits.startsWith("1")
      ? digits.slice(1)
      : digits.length === 10
        ? digits
        : null;
  if (!national) return value;
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}
