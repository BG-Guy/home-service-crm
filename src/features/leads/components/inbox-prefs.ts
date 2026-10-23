// Leads inbox preferences (isomorphic, no imports). The phone column count (1 or 2)
// lives in a plain cookie, like the Appearance cookie (src/lib/theme.ts), so the
// server renders the grid the person picked with no flash.

export const LEAD_COLS_COOKIE = "leads-cols";
export type LeadCols = 1 | 2;

const ONE_YEAR = 60 * 60 * 24 * 365;

/** Phones start with 2 columns (the owner's pick). */
export function parseLeadCols(v: string | null | undefined): LeadCols {
  return v === "1" ? 1 : 2;
}

/** Client only: remember the choice on this device. */
export function writeLeadCols(cols: LeadCols): void {
  // biome-ignore lint/suspicious/noDocumentCookie: a tiny UI preference, like the Appearance cookie
  document.cookie = `${LEAD_COLS_COOKIE}=${cols}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
}

/** The phone Grid / Map switch, mirrored in `?show=map`. */
export type InboxShow = "grid" | "map";

export function parseInboxShow(v: string | null | undefined): InboxShow {
  return v === "map" ? "map" : "grid";
}
