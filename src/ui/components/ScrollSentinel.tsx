"use client";

import { useEffect, useRef } from "react";

/**
 * Fallback for browsers without scroll-driven animations: when this sentinel
 * scrolls under the bar, set `data-scrolled` on the closest `[data-lt]` header
 * so CSS reveals the inline title + material (SPEC §12.4). No-op where
 * `animation-timeline: scroll()` is supported.
 */
export function ScrollSentinel({ offset = 52 }: { offset?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    const header = el?.closest<HTMLElement>("[data-lt]");
    if (!el || !header) return;
    if (
      typeof CSS !== "undefined" &&
      CSS.supports("animation-timeline: scroll()")
    )
      return;
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) header.removeAttribute("data-scrolled");
        else header.setAttribute("data-scrolled", "");
      },
      { rootMargin: `-${offset}px 0px 0px 0px` },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [offset]);
  return <span ref={ref} aria-hidden className="block h-px" />;
}
