// The /jobs layout preference (isomorphic, no imports): cards (the default) or
// the list, in a plain cookie like the leads column count, so the server renders
// the layout the person picked with no flash.

export const JOBS_LAYOUT_COOKIE = "jobs-layout";
export type JobsLayout = "cards" | "list";

const ONE_YEAR = 60 * 60 * 24 * 365;

export function parseJobsLayout(v: string | null | undefined): JobsLayout {
  return v === "list" ? "list" : "cards";
}

/** Client only: remember the choice on this device. */
export function writeJobsLayout(v: JobsLayout): void {
  // biome-ignore lint/suspicious/noDocumentCookie: a tiny UI preference, like the Appearance cookie
  document.cookie = `${JOBS_LAYOUT_COOKIE}=${v}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
}
