// Post-login redirect target (`?next=`). Isomorphic, no imports.
// Only same-origin relative paths survive. Browsers strip tabs/newlines and treat "\"
// as "/" in URLs, so "/\t/evil.com" or "/\\evil.com" would become "//evil.com"
// (an open redirect); anything with backslashes, control characters or whitespace
// is rejected, and the result must resolve to the same origin.

const BASE = "http://same-origin.invalid";

export function safeNextPath(value: unknown): string | null {
  const s = Array.isArray(value) ? value[0] : value;
  if (typeof s !== "string" || s.length === 0 || s.length > 2048) return null;
  if (!s.startsWith("/") || s.startsWith("//")) return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control chars is the point
  if (/[\\\s\u0000-\u001f\u007f]/.test(s)) return null;
  try {
    const u = new URL(s, BASE);
    if (u.origin !== BASE) return null;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return null;
  }
}
