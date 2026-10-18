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

/**
 * Desktop sidebar (≥ 1024 px, SPEC §13.2): 260 px, sticky, `.material`,
 * grouped sections with badges, brand header and a footer slot (user menu).
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
    <nav
      aria-label="Main"
      data-chrome
      className={cx(
        "material sticky top-0 h-dvh w-[var(--sidebar-w)] flex-col overflow-y-auto overscroll-contain shadow-[inset_-0.5px_0_0_var(--sep)]",
        className,
      )}
    >
      {header && (
        <div className="px-5 pb-2 pt-[calc(env(safe-area-inset-top)+20px)]">
          {header}
        </div>
      )}
      <div className="flex flex-1 flex-col gap-5 px-3 pb-4 pt-2">
        {sections.map((s, si) => (
          <div key={s.title ?? si}>
            {s.title && (
              <h2 className="px-3 pb-1 text-footnote font-semibold text-label-2">
                {s.title}
              </h2>
            )}
            <ul className="flex flex-col gap-0.5">
              {s.items.map((it) => {
                const on = it.key === activeKey;
                return (
                  <li key={it.key}>
                    <Link
                      href={it.href}
                      aria-current={on ? "page" : undefined}
                      className={cx(
                        "flex min-h-9 items-center gap-3 rounded-control px-3 text-body outline-offset-[-2px]",
                        on
                          ? "bg-accent font-semibold text-on-accent"
                          : "text-label hover:bg-fill-2",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cx(
                          "flex [&_svg]:size-5",
                          !on && "text-accent-text",
                        )}
                      >
                        {it.icon}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {it.label}
                      </span>
                      {it.badge ? (
                        <Badge
                          count={it.badge}
                          tone={on ? "gray" : it.critical ? "red" : "gray"}
                          className={on ? "bg-white/25" : undefined}
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
      {footer && (
        <div className="hairline-t px-3 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3">
          {footer}
        </div>
      )}
    </nav>
  );
}
