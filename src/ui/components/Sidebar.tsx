"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cx } from "../cx";
import { Badge } from "./Badge";
import { activeTabIndex, type TabItem } from "./TabBar";

export interface SidebarSection {
  title?: string;
  items: readonly TabItem[];
}

/** Root-section navigation plays the M2 cross-fade, not a push (PageTransition). */
const NAV_TAB = ["nav-tab"];

/**
 * Desktop sidebar (≥ 1024 px, docs/DESIGN.md §5, SPEC §13.2): 256 px, sticky, on
 * the page canvas. Items are 36 px; the selected one is a soft card (`--card`,
 * `--shadow-card`, hairline in dark) with an accent icon and ink text, never a
 * solid accent bar. Quiet 12/600 section labels, right-aligned count badges, a
 * brand header and a footer slot (user menu). Styles: `.sidebar*` in globals.css.
 */
export function Sidebar({
  sections,
  header,
  footer,
  className,
}: {
  sections: readonly SidebarSection[];
  /** Brand / company name area. */
  header?: ReactNode;
  /** User row, sign-out, etc. */
  footer?: ReactNode;
  className?: string;
}) {
  const pathname = usePathname() ?? "/";
  const flat = sections.flatMap((s) => s.items);
  const activeKey = flat[activeTabIndex(flat, pathname)]?.key;
  return (
    <nav aria-label="Main" data-chrome className={cx("sidebar", className)}>
      {header && <div className="sidebar-header">{header}</div>}
      <div className="flex flex-1 flex-col gap-5 px-3 pb-4 pt-1">
        {sections.map((s, si) => (
          <div key={s.title ?? si}>
            {s.title && <h2 className="sidebar-label">{s.title}</h2>}
            <ul className="flex flex-col gap-0.5">
              {s.items.map((it) => {
                const on = it.key === activeKey;
                return (
                  <li key={it.key}>
                    <Link
                      href={it.href}
                      transitionTypes={NAV_TAB}
                      aria-current={on ? "page" : undefined}
                      className="sidebar-item"
                    >
                      <span aria-hidden className="sidebar-icon">
                        {it.icon}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {it.label}
                      </span>
                      {it.badge ? (
                        <Badge
                          count={it.badge}
                          tone={it.critical ? "red" : "gray"}
                        />
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {footer && <div className="sidebar-footer">{footer}</div>}
    </nav>
  );
}
