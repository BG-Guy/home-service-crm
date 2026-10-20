"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { cx } from "../cx";
import { Badge } from "./Badge";

export interface TabItem {
  key: string;
  href: string;
  label: string;
  /** Rendered icon element (resolve names with `iconFor()` on the server). */
  icon: ReactNode;
  badge?: number;
  /** Red badge — only for critical counts. */
  critical?: boolean;
  /** Extra path prefixes that mark this tab active (e.g. ["/jobs"] for Today). */
  match?: readonly string[];
}

/** Index of the tab whose href/match is the longest prefix of `pathname`. */
export function activeTabIndex(
  items: readonly Pick<TabItem, "href" | "match">[],
  pathname: string,
): number {
  let best = -1;
  let bestLen = -1;
  items.forEach((t, i) => {
    for (const raw of [t.href, ...(t.match ?? [])]) {
      const p = raw.split("?")[0] ?? raw;
      const hit = pathname === p || (p !== "/" && pathname.startsWith(`${p}/`));
      if (hit && p.length > bestLen) {
        best = i;
        bestLen = p.length;
      }
    }
  });
  return best;
}

/** Root-section navigation plays the M2 cross-fade, not a push (PageTransition). */
const NAV_TAB = ["nav-tab"];

/**
 * Floating glass capsule tab bar (docs/DESIGN.md §5, SPEC §13.1): ≤ 5 tabs, an
 * accent pill that slides behind the active tab (M14, transform only, its position
 * from `--i`), an icon bounce on tap (CSS), badges, safe-area aware, never hides.
 * Tapping the active tab scrolls to top. `view-transition-name: tabbar` (on the
 * capsule) keeps it still while pages push, pop or cross-fade. The styles are
 * `.tabbar*` in globals.css.
 */
export function TabBar({
  items,
  className,
}: {
  items: readonly TabItem[];
  className?: string;
}) {
  const pathname = usePathname() ?? "/";
  const tabs = items.slice(0, 5);
  const active = activeTabIndex(tabs, pathname);
  return (
    <nav aria-label="Tabs" data-chrome className={cx("tabbar", className)}>
      {/* The capsule carries the view-transition name, not the <nav>: a named
          element is a backdrop root, so on the wrapper the glass would blur only
          the empty wrapper and the page would read through it. */}
      <div
        className="tabbar-capsule"
        data-none={active < 0 || undefined}
        style={
          {
            viewTransitionName: "tabbar",
            "--n": tabs.length,
            "--i": Math.max(0, active),
          } as CSSProperties
        }
      >
        <span aria-hidden className="tabbar-pill" />
        {tabs.map((t, i) => {
          const on = i === active;
          return (
            <Link
              key={t.key}
              href={t.href}
              transitionTypes={NAV_TAB}
              aria-current={on ? "page" : undefined}
              onClick={(e) => {
                if (on && !e.metaKey && !e.ctrlKey) {
                  e.preventDefault();
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }
              }}
              className="tab"
            >
              <span aria-hidden className="tab-icon">
                {t.icon}
                {t.badge ? (
                  <span className="tab-badge">
                    <Badge count={t.badge} tone={t.critical ? "red" : "gray"} />
                  </span>
                ) : null}
              </span>
              <span className="tab-label">{t.label}</span>
              {t.badge ? (
                <span className="sr-only">, {t.badge} new</span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
