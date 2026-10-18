import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "../cx";
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
    <Link
      href={href}
      transitionTypes={["nav-back"]}
      className="pressable -ml-2 flex min-h-11 max-w-[40vw] items-center gap-0.5 rounded-control pr-2 text-body text-accent-text outline-offset-0"
    >
      <ChevronLeft
        aria-hidden
        size={28}
        strokeWidth={2.4}
        className="-mr-0.5 shrink-0"
      />
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
    <div className="mx-auto grid h-11 max-w-[var(--content-max)] grid-cols-[1fr_auto_1fr] items-center gap-2 px-[var(--gutter)]">
      <div className="flex min-w-0 items-center justify-start">
        {back ? <BackButton {...back} /> : leading}
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
      <header className="mx-auto max-w-[var(--content-max)] px-[var(--gutter)] pb-2">
        <h1 className="text-large-title tracking-tight">{title}</h1>
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
