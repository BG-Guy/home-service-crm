// Review-link safety (QA T5-17). The Google review URL comes from settings and is used
// as a redirect target on /r/[token] and in customer texts: only an absolute https URL
// is ever used. Pure; client-safe.

/** The URL when it parses as absolute `https:`, else null. */
export function safeHttpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !!u.hostname ? v : null;
  } catch {
    return null;
  }
}
