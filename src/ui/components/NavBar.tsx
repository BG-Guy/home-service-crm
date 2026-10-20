import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "../cx";
import {
  BACK_LINK,
  BAR_LEADING,
  BAR_ROW,
  BAR_TITLE,
  BAR_TRAILING,
  BackChevron,
  LARGE_HEADER,
  LARGE_TITLE,
} from "./bar-parts";
import { ScrollSentinel } from "./ScrollSentinel";

export interface BackTarget {
  href: string;
  /** Previous screen's title (iOS shows it next to the chevron). Default "Back". */
  label?: string;
}

/**
 * iOS back button: chevron + previous title, `nav-back` pop transition.
 * Always render one on pushed screens — standalone iOS PWAs may lack swipe-back.
 */
export function BackButton({ href, label = "Back" }: BackTarget) {
  return (
    <Link href={href} transitionTypes={["nav-back"]} className={BACK_LINK}>
      <BackChevron />
      <span className="truncate">{label}</span>
    </Link>
  );
}

function BarRow({
  back,
  leading,
  title,
  trailing,
  titleClassName,
  titleHidden,
}: {
  back?: BackTarget;
  leading?: ReactNode;
  title?: ReactNode;
  trailing?: ReactNode;
  titleClassName?: string;
  titleHidden?: boolean;
}) {
  return (
    <div className={BAR_ROW}>
      <div className={BAR_LEADING}>
        {back ? <BackButton {...back} /> : leading}
      </div>
      <div
        aria-hidden={titleHidden || undefined}
        className={cx(BAR_TITLE, titleClassName)}
      >
        {title}
      </div>
      <div className={BAR_TRAILING}>{trailing}</div>
    </div>
  );
}

/**
 * Inline-title nav bar for pushed/detail screens (docs/DESIGN.md §5): back
 * button, centered 17 px title, trailing actions, sticky, padded for the status
 * bar. Clear over the canvas at the top; glass with a hairline once content
 * scrolls under it (`.nav-bar` in globals.css: a scroll-driven fade, always glass
 * where scroll timelines aren't supported). The title is the page's `<h1>`.
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
      className={cx("nav-bar pt-[env(safe-area-inset-top)]", className)}
    >
      <BarRow
        back={back}
        leading={leading}
        trailing={trailing}
        title={<h1 className="truncate text-headline">{title}</h1>}
      />
    </header>
  );
}

/**
 * Large-title header (docs/DESIGN.md §4 M17): a 34 px title that collapses into
 * the 17 px inline bar title on scroll. Primary: CSS scroll-driven animation
 * (range 0–52 px); fallback: an IntersectionObserver sentinel sets
 * `data-scrolled`. The bar turns to glass with a hairline when scrolled.
 * Server-rendered.
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
          trailing={trailing}
          title={title}
          titleClassName="lt-inline"
          titleHidden
        />
      </div>
      <header className={LARGE_HEADER}>
        <h1 className={LARGE_TITLE}>{title}</h1>
        {subtitle && (
          <p className="-mt-0.5 text-subhead text-label-2">{subtitle}</p>
        )}
        <ScrollSentinel />
        {search && <div className="mt-2">{search}</div>}
        {children && <div className="mt-3">{children}</div>}
      </header>
    </div>
  );
}
