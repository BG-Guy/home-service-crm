// Shared geometry of the nav bars (NavBar.tsx) and of their loading skeletons
// (SkeletonHeader in NavTitles.tsx), so a skeleton is pixel-identical to the bar
// that replaces it without bundling NavBar.tsx into client chunks. Pure, no JS.

/**
 * The 44 px bar row: leading / centered title / trailing. The side columns never
 * shrink below their buttons and the title column gives way (it truncates), so
 * three trailing icons can't overlap a long title; with room to spare the title
 * stays centered.
 */
export const BAR_ROW =
  "mx-auto grid h-11 max-w-[var(--content-max)] grid-cols-[minmax(max-content,1fr)_minmax(0,max-content)_minmax(max-content,1fr)] items-center gap-2 px-[var(--gutter)]";
export const BAR_LEADING = "flex min-w-0 items-center justify-start";
export const BAR_TITLE =
  "min-w-0 max-w-[50vw] truncate text-center text-headline lg:max-w-[480px]";
export const BAR_TRAILING = "flex min-w-0 items-center justify-end gap-1";
/** iOS back button: chevron + previous title. */
export const BACK_LINK =
  "pressable -ml-2 flex min-h-11 max-w-[40vw] items-center gap-0.5 rounded-control pr-2 text-body text-accent-text outline-offset-0";
/** The large title block under the bar. */
export const LARGE_HEADER =
  "mx-auto max-w-[var(--content-max)] px-[var(--gutter)] pb-2";
export const LARGE_TITLE =
  "text-large-title tracking-tight lg:text-[30px] lg:leading-9";

/** The back chevron (lucide `chevron-left`, 28 px, stroke 2.4), inline. */
export function BackChevron() {
  return (
    <svg
      aria-hidden="true"
      width={28}
      height={28}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="-mr-0.5 shrink-0"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}
