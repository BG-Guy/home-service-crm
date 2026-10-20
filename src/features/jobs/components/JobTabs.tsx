"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
import { cx } from "@/ui/cx";

/**
 * In-page tabs for the job screen (DESIGN.md §6 "Tabs inside a page"): a sticky
 * underline row under the nav bar. The indicator is one bar that slides to the
 * tapped tab at once (M14: transform only, 220 ms snappy) while the tab's
 * content loads; links replace the history entry and keep the scroll.
 */
export function JobTabs({
  tabs,
  active,
  label = "Job sections",
}: {
  tabs: { key: string; label: string; href: string }[];
  active: string;
  label?: string;
}) {
  const [current, setCurrent] = useState(active);
  // A server update (back / forward, a deep link) wins over the optimistic tab.
  const [prevActive, setPrevActive] = useState(active);
  if (prevActive !== active) {
    setPrevActive(active);
    setCurrent(active);
  }
  const row = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const r = row.current;
    const b = bar.current;
    if (!r || !b) return;
    const place = () => {
      const el = r.querySelector<HTMLElement>(`[data-tab="${current}"]`);
      if (!el) return;
      b.style.transform = `translateX(${el.offsetLeft}px) scaleX(${el.offsetWidth})`;
      // Keep the chosen tab in view on narrow screens.
      const pad = 24;
      if (el.offsetLeft - pad < r.scrollLeft)
        r.scrollTo({ left: el.offsetLeft - pad, behavior: "smooth" });
      else if (
        el.offsetLeft + el.offsetWidth + pad >
        r.scrollLeft + r.clientWidth
      )
        r.scrollTo({
          left: el.offsetLeft + el.offsetWidth + pad - r.clientWidth,
          behavior: "smooth",
        });
    };
    place();
    setReady(true);
    const ro = new ResizeObserver(place);
    ro.observe(r);
    return () => ro.disconnect();
  }, [current]);

  return (
    <nav
      aria-label={label}
      className="sticky top-[var(--sticky-top,calc(env(safe-area-inset-top)+44px))] z-[var(--z-sticky)] -mx-[var(--gutter)] bg-bg px-[var(--gutter)] shadow-[inset_0_-0.5px_0_var(--sep)] min-[1200px]:mx-0 min-[1200px]:px-0"
    >
      <div
        ref={row}
        className="relative flex gap-5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((t) => {
          const on = t.key === current;
          return (
            <Link
              key={t.key}
              data-tab={t.key}
              href={t.href}
              replace
              scroll={false}
              aria-current={on ? "page" : undefined}
              onClick={() => setCurrent(t.key)}
              className={cx(
                "hit-44 relative flex h-11 shrink-0 items-center text-subhead outline-offset-[-2px] transition-colors duration-150",
                on
                  ? "font-semibold text-label"
                  : "font-medium text-label-2 hover:text-label",
                // Before hydration the active tab draws its own underline.
                on &&
                  !ready &&
                  "after:absolute after:inset-x-0 after:bottom-0 after:h-[2.5px] after:rounded-full after:bg-label",
              )}
            >
              {t.label}
            </Link>
          );
        })}
        <span
          ref={bar}
          aria-hidden
          className={cx(
            "pointer-events-none absolute bottom-0 left-0 h-[2.5px] w-px origin-left rounded-full bg-label",
            !ready && "opacity-0",
            ready &&
              "transition-transform duration-[220ms] ease-[var(--ease-spring-snappy)] motion-reduce:transition-none",
          )}
        />
      </div>
    </nav>
  );
}
