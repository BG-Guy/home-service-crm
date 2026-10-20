"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cx } from "@/ui/cx";
import { type Tone, toneStyle } from "@/ui/tone";

export interface SettingsNavItem {
  key: string;
  href: string;
  label: string;
  icon: ReactNode;
  tone: Tone;
}

/**
 * Desktop settings column (≥ 1024 px): the grouped settings index as a sticky
 * list with the current page highlighted (iPadOS Settings style).
 */
export function SettingsNav({
  title,
  groups,
}: {
  title: string;
  groups: { key: string; label: string; items: SettingsNavItem[] }[];
}) {
  const pathname = usePathname() ?? "";
  const active = groups
    .flatMap((g) => g.items)
    .filter(
      (i) =>
        pathname === i.href.split("#")[0] ||
        pathname.startsWith(`${i.href.split("#")[0]}/`),
    )
    .sort((a, b) => b.href.length - a.href.length)[0]?.key;
  return (
    <nav aria-label="Settings" className="flex flex-col gap-5 px-3 pt-6 pb-10">
      <Link
        href="/settings"
        className="px-3 text-title2 font-bold tracking-tight"
        aria-current={pathname === "/settings" ? "page" : undefined}
      >
        {title}
      </Link>
      {groups.map((g) => (
        <div key={g.key}>
          <h2 className="px-3 pb-1.5 text-footnote font-semibold text-label-3">
            {g.label}
          </h2>
          <ul className="flex flex-col gap-0.5">
            {g.items.map((i) => {
              const on = i.key === active;
              return (
                <li key={i.key}>
                  <Link
                    href={i.href}
                    aria-current={on ? "page" : undefined}
                    className={cx(
                      "pressable flex min-h-10 items-center gap-3 rounded-[10px] px-3 text-body outline-offset-[-2px] transition-colors",
                      on
                        ? "bg-card font-semibold text-label shadow-card"
                        : "text-label hover:bg-fill-3",
                    )}
                  >
                    <span
                      aria-hidden
                      className="tint-bg tint-fg flex size-7 shrink-0 items-center justify-center rounded-[8px]"
                      style={toneStyle(i.tone)}
                    >
                      {i.icon}
                    </span>
                    <span className="truncate">{i.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
