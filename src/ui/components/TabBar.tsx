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

/**
 * Floating capsule tab bar (SPEC §12.6, §13.1): ≤ 5 tabs, `.material`, a
 * sliding selection pill (spring), badges, safe-area aware, never hides.
 * Tapping the active tab scrolls to top. Shares `view-transition-name: tabbar`
 * so it stays still during push/pop transitions.
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
    <nav
      aria-label="Tabs"
      data-chrome
      className={cx(
        "fixed inset-x-0 bottom-[max(12px,calc(env(safe-area-inset-bottom)-6px))] z-[var(--z-bar)] flex justify-center px-[var(--gutter)]",
        className,
      )}
      style={{ viewTransitionName: "tabbar" } as CSSProperties}
    >
      <div
        className="material relative grid h-[var(--tabbar-h)] w-full max-w-[420px] rounded-pill p-1 shadow-[var(--shadow-float),0_0_0_0.5px_var(--sep)]"
        style={{
          gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`,
        }}
      >
        {active >= 0 && (
          <span
            aria-hidden
            className="absolute bottom-1 left-1 top-1 rounded-pill bg-fill-2 transition-transform duration-[var(--dur-snappy)] ease-spring-snappy motion-reduce:transition-none"
            style={{
              width: `calc((100% - 8px) / ${tabs.length})`,
              transform: `translateX(${active * 100}%)`,
            }}
          />
        )}
        {tabs.map((t, i) => {
          const on = i === active;
          return (
            <Link
              key={t.key}
              href={t.href}
              aria-current={on ? "page" : undefined}
              onClick={(e) => {
                if (on && !e.metaKey && !e.ctrlKey) {
                  e.preventDefault();
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }
              }}
              className={cx(
                "pressable relative z-[1] flex flex-col items-center justify-center gap-0.5 rounded-pill outline-offset-[-2px]",
                on ? "text-accent-text" : "text-label",
              )}
            >
              <span aria-hidden className="relative flex [&_svg]:size-[24px]">
                {t.icon}
                {t.badge ? (
                  <span className="absolute -right-2.5 -top-1.5">
                    <Badge count={t.badge} tone={t.critical ? "red" : "gray"} />
                  </span>
                ) : null}
              </span>
              <span
                className={cx(
                  "max-w-full truncate px-1 text-[10px] leading-3",
                  on ? "font-semibold" : "font-medium",
                )}
              >
                {t.label}
              </span>
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
