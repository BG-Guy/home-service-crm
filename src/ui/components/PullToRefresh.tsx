"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { haptic } from "../motion/haptics";
import { springTo } from "../motion/spring-driver";
import { prefersReducedMotion, rubberBand, spring } from "../motion/springs";
import { Spinner } from "./Spinner";

const TRIGGER = 72;
const HOLD = 56;

/**
 * Pull-to-refresh for standalone PWAs (no native one on iOS home-screen apps).
 * Touch-only, active only at scroll top; rubber-banded pull, haptic at the
 * threshold, spinner while refreshing, spring back. Default action is
 * `router.refresh()` (waits for the transition to settle).
 *
 * It renders only the spinner and moves the `target` element (default
 * `#main`, AppShell's content), so it can be lazy-loaded without delaying the
 * page: `<LazyPullToRefresh />` anywhere on the page.
 */
export function PullToRefresh({
  onRefresh,
  disabled,
  target = "#main",
}: {
  onRefresh?: () => void | Promise<void>;
  disabled?: boolean;
  /** Selector of the element to translate while pulling. */
  target?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const content = useRef<HTMLElement | null>(null);
  const indicator = useRef<HTMLDivElement>(null);
  const waiter = useRef<(() => void) | null>(null);
  const opts = useRef({ onRefresh, disabled });
  opts.current = { onRefresh, disabled };

  useEffect(() => {
    if (!pending && waiter.current) {
      waiter.current();
      waiter.current = null;
    }
  }, [pending]);

  useEffect(() => {
    let startY = 0;
    let pull = 0;
    let active = false;
    let armed = false;
    let refreshing = false;
    let stop: (() => void) | null = null;
    content.current = document.querySelector<HTMLElement>(target);

    const render = (y: number) => {
      pull = y;
      if (content.current)
        content.current.style.transform = y ? `translate3d(0,${y}px,0)` : "";
      const ind = indicator.current;
      if (ind) {
        ind.style.opacity = String(Math.min(1, y / TRIGGER));
        ind.style.transform = `translate3d(0,${Math.min(y, HOLD) - 40}px,0) rotate(${y * 3}deg)`;
      }
    };
    const animate = (to: number) => {
      stop?.();
      if (prefersReducedMotion()) {
        render(to);
        return Promise.resolve();
      }
      const a = springTo({
        from: pull,
        to,
        spring: spring.snappy,
        onUpdate: render,
      });
      stop = a.stop;
      return a.finished;
    };
    const refresh = async () => {
      const fn = opts.current.onRefresh;
      const minDelay = new Promise((r) => setTimeout(r, 600));
      if (fn) await fn();
      else
        await new Promise<void>((resolve) => {
          waiter.current = resolve;
          startTransition(() => router.refresh());
        });
      await minDelay;
    };

    const onStart = (e: TouchEvent) => {
      if (
        opts.current.disabled ||
        refreshing ||
        window.scrollY > 0 ||
        e.touches.length !== 1
      )
        return;
      startY = e.touches[0]?.clientY ?? 0;
      active = true;
      armed = false;
    };
    const onMove = (e: TouchEvent) => {
      if (!active) return;
      const dy = (e.touches[0]?.clientY ?? 0) - startY;
      if (dy <= 0 || window.scrollY > 0) {
        if (pull) render(0);
        return;
      }
      const y = rubberBand(dy, window.innerHeight * 0.6, 0.55);
      render(y);
      if (!armed && y >= TRIGGER) {
        armed = true;
        haptic();
      } else if (armed && y < TRIGGER) armed = false;
    };
    const onEnd = async () => {
      if (!active) return;
      active = false;
      if (armed && !refreshing) {
        refreshing = true;
        indicator.current?.setAttribute("data-refreshing", "");
        await animate(HOLD);
        try {
          await refresh();
        } finally {
          indicator.current?.removeAttribute("data-refreshing");
          await animate(0);
          refreshing = false;
        }
      } else if (pull) {
        await animate(0);
      }
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      stop?.();
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [router, target]);

  return (
    <div
      ref={indicator}
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-[env(safe-area-inset-top)] z-[var(--z-bar)] flex justify-center text-label-2 opacity-0"
    >
      <span className="glass-chrome mt-2 flex size-9 items-center justify-center rounded-full">
        <Spinner size={20} />
      </span>
    </div>
  );
}

export default PullToRefresh;
