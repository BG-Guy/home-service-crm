import type { ReactNode } from "react";
import { cx } from "../cx";

/**
 * Bottom action bar, the Airbnb "booking bar" (docs/DESIGN.md §5): a summary on
 * the left (amount, "3 to do"), the one primary action on the right. Server
 * Component, no JS; styles are `.bottom-bar*` in globals.css.
 *
 * - Phone: sticky at the bottom of its container, glass. In the app it floats as
 *   a card just above the tab bar; elsewhere (public pages) it sits on the bottom
 *   edge, safe-area aware. It's `position: sticky`, so it takes its own room in the
 *   flow and the last item can always scroll clear of it. Render it as the LAST
 *   child of the page content (inside `<Page>`), or pass it to `DetailLayout bar`.
 * - Desktop (≥ 1200 px) inside `DetailLayout`'s rail: a plain card at the top of
 *   the sticky rail. Anywhere else it stays a sticky floating bar.
 * - While one is on screen, the root publishes `--bottombar-h` (its height plus the
 *   gap) so fixed overlays such as the sync capsule and toasts lift above it.
 *
 * ```tsx
 * <BottomBar
 *   summary={<BarSummary title="$334.54" subtitle="Total due" />}
 *   action={<Button size="lg">Approve</Button>} />
 * ```
 */
export function BottomBar({
  summary,
  action,
  secondary,
  edge,
  label = "Actions",
  className,
}: {
  /** Left side: `<BarSummary>` or any short content. */
  summary?: ReactNode;
  /** Right side: the one primary action (usually a `Button`). */
  action?: ReactNode;
  /** Optional extra controls before the action (icon buttons, a plain link). */
  secondary?: ReactNode;
  /**
   * Full-bleed bar on the bottom edge (hairline top) instead of a floating card.
   * For public pages; place it directly inside `<Page>` (it spans the gutters).
   */
  edge?: boolean;
  /** Accessible name of the region. */
  label?: string;
  className?: string;
}) {
  return (
    <section
      aria-label={label}
      data-chrome
      data-edge={edge || undefined}
      className={cx("bottom-bar", className)}
    >
      <div className="bottom-bar-in">
        {summary != null ? (
          <div className="bottom-bar-summary">{summary}</div>
        ) : null}
        <div className="bottom-bar-actions">
          {secondary}
          {action}
        </div>
      </div>
    </section>
  );
}

/** The bar's left side: a bold tabular title and a secondary line. */
export function BarSummary({
  title,
  subtitle,
}: {
  /** E.g. "$334.54" or "3 to do". */
  title: ReactNode;
  /** E.g. "Total due" or "Next: arrive by 2:30". */
  subtitle?: ReactNode;
}) {
  return (
    <>
      <div className="num truncate text-headline">{title}</div>
      {subtitle != null ? (
        <div className="truncate text-footnote text-label-2">{subtitle}</div>
      ) : null}
    </>
  );
}
