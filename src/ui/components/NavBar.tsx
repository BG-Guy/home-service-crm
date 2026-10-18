import type { ReactNode } from "react";
import { cx } from "../cx";
import { type BackTarget, CrumbTitle, HistoryBack } from "./NavHistory";
import { ScrollSentinel } from "./ScrollSentinel";

export type { BackTarget } from "./NavHistory";
// The iOS back button lives with the history breadcrumbs (NavHistory.tsx).
export { BackButton } from "./NavHistory";

function BarRow({
  back,
  leading,
  root,
  history = true,
  title,
  trailing,
  titleClassName,
  titleHidden,
}: {
  back?: BackTarget;
  leading?: ReactNode;
  /** A top-level screen: no back button on phones (breadcrumbs on desktop). */
  root?: boolean;
  /** `false`: no history back button / breadcrumbs (narrow list panes). */
  history?: boolean;
  title?: ReactNode;
  trailing?: ReactNode;
  titleClassName?: string;
  titleHidden?: boolean;
}) {
  return (
    <div className="mx-auto grid h-11 max-w-[var(--content-max)] grid-cols-[1fr_auto_1fr] items-center gap-2 px-[var(--gutter)]">
      <div className="flex min-w-0 items-center justify-start">
        {back ? (
          <HistoryBack fallback={back} />
        ) : (
          (leading ?? (history ? <HistoryBack root={root} /> : null))
        )}
      </div>
      <div
        aria-hidden={titleHidden || undefined}
        className={cx(
          "max-w-[50vw] truncate text-center text-headline lg:max-w-[480px]",
          titleClassName,
        )}
      >
        {title}
      </div>
      <div className="flex min-w-0 items-center justify-end gap-1">
        {trailing}
      </div>
    </div>
  );
}

/**
 * Inline-title nav bar for pushed/detail screens (SPEC §12.6): back button,
 * centered 17 px title, trailing actions, `.material` with a hairline, sticky,
 * padded for the status bar. The title is the page's `<h1>`.
 */
export function NavBar({
  title,
  back,
  leading,
  trailing,
  className,
}: {
  title?: ReactNode;
  back?: BackTarget;
  leading?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <header
      data-chrome
      className={cx(
        "material hairline-b sticky top-0 z-[var(--z-bar)] pt-[env(safe-area-inset-top)]",
        className,
      )}
    >
      <BarRow
        back={back}
        leading={leading}
        trailing={trailing}
        title={<h1 className="truncate text-headline">{title}</h1>}
      />
      {typeof title === "string" && <CrumbTitle title={title} />}
    </header>
  );
}

/**
 * Large-title header (SPEC §12.4): a 34 px title that collapses into the 17 px
 * inline bar title on scroll. Primary: CSS scroll-driven animation (range 0–52 px);
 * fallback: an IntersectionObserver sentinel sets `data-scrolled`. The bar
 * gains `.material` + hairline when scrolled. Server-rendered.
 *
 * ```tsx
 * <LargeTitleHeader title="Customers" trailing={<AddMenu items={…} />}
 *   search={<SearchField param="q" defaultValue={q} placeholder="Search customers" />} />
 * ```
 */
export function LargeTitleHeader({
  title,
  subtitle,
  back,
  leading,
  trailing,
  search,
  history = true,
  children,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: BackTarget;
  leading?: ReactNode;
  /** Trailing bar actions (IconButtons, "+" menu, bell). */
  trailing?: ReactNode;
  /** Search field under the title (`searchable`). */
  search?: ReactNode;
  /**
   * Show the history breadcrumbs (desktop). `false` for list panes that sit next
   * to a detail pane, which shows them instead.
   */
  history?: boolean;
  /** Extra content under the title (segmented control, chips). */
  children?: ReactNode;
  /** Visibility only (e.g. `lg:hidden`): the wrapper is `display: contents`. */
  className?: string;
}) {
  // `[data-lt]` is `display: contents` (globals.css), so the sticky bar is pinned
  // to the page, not to this header: it stays at the top after the title scrolls
  // away (QA T4-02).
  return (
    <div data-lt className={className}>
      <div data-chrome className="lt-bar pt-[env(safe-area-inset-top)]">
        <BarRow
          back={back}
          leading={leading}
          root
          history={history}
          trailing={trailing}
          title={title}
          titleClassName="lt-inline"
          titleHidden
        />
      </div>
      {typeof title === "string" && <CrumbTitle title={title} />}
      <header className="mx-auto max-w-[var(--content-max)] px-[var(--gutter)] pb-2">
        <h1 className="text-large-title tracking-tight">{title}</h1>
        {/* A control as the subtitle (e.g. a date jump that opens a popover or a
            sheet) can't sit inside a <p>. */}
        {subtitle &&
          (typeof subtitle === "string" ? (
            <p className="-mt-0.5 text-subhead text-label-2">{subtitle}</p>
          ) : (
            <div className="-mt-0.5 text-subhead text-label-2">{subtitle}</div>
          ))}
        <ScrollSentinel />
        {search && <div className="mt-2">{search}</div>}
        {children && <div className="mt-3">{children}</div>}
      </header>
    </div>
  );
}
