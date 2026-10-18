"use client";

import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import { type Tone, toneStyle } from "../tone";
import { ContextMenu } from "./ContextMenu";

export interface SwipeAction {
  label: string;
  onAction: () => void;
  icon?: ReactNode;
  /** Button color (default gray; `destructive` forces red). */
  tone?: Tone;
  destructive?: boolean;
}

let openRow: { close: () => void; el: HTMLElement } | null = null;

/**
 * Swipeable list row (SPEC §12.6). Pure CSS scroll-snap reveals leading /
 * trailing actions — the browser does the physics, no gesture JS. The same
 * actions are mirrored into a `ContextMenu` (long-press, right-click,
 * Shift+F10) for keyboard and screen-reader users. One row is open at a time;
 * tapping an open row closes it.
 *
 * ```tsx
 * <SwipeActions trailing={[{ label: "Delete", destructive: true, onAction: del }]}>
 *   <ListRow title="Gate code" href="/…" />
 * </SwipeActions>
 * ```
 */
export function SwipeActions({
  leading = [],
  trailing = [],
  children,
  className,
}: {
  leading?: readonly SwipeAction[];
  trailing?: readonly SwipeAction[];
  children: ReactNode;
  className?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const lead = useRef<HTMLDivElement>(null);

  const rest = () => lead.current?.offsetWidth ?? 0;
  const close = () =>
    scroller.current?.scrollTo({ left: rest(), behavior: "smooth" });
  const isOpen = () =>
    Math.abs((scroller.current?.scrollLeft ?? 0) - rest()) > 4;

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-rest only when the leading set changes
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // Leading actions stay display:none until here (no flash before hydration).
    el.dataset.ready = "";
    el.scrollLeft = rest();
  }, [leading.length]);

  useEffect(
    () => () => {
      if (openRow?.el === scroller.current) openRow = null;
    },
    [],
  );

  const run = (a: SwipeAction) => {
    close();
    a.onAction();
  };

  const buttons = (list: readonly SwipeAction[]) =>
    list.map((a) => (
      <button
        key={a.label}
        type="button"
        tabIndex={-1}
        onClick={() => run(a)}
        className="tone-bg flex w-[76px] flex-col items-center justify-center gap-1 px-1 text-footnote font-medium active:brightness-90"
        style={toneStyle(a.destructive ? "red" : (a.tone ?? "gray"))}
      >
        {a.icon && <span className="flex">{a.icon}</span>}
        <span className="max-w-full truncate">{a.label}</span>
      </button>
    ));

  return (
    <ContextMenu
      className={className}
      actions={[...leading, ...trailing].map((a) => ({
        label: a.label,
        icon: a.icon,
        destructive: a.destructive,
        onSelect: a.onAction,
      }))}
    >
      <div
        ref={scroller}
        className="swipe"
        onScroll={() => {
          const el = scroller.current;
          if (!el) return;
          if (isOpen()) {
            if (openRow && openRow.el !== el) openRow.close();
            openRow = { el, close };
          } else if (openRow?.el === el) {
            openRow = null;
          }
        }}
      >
        {leading.length > 0 && (
          <div ref={lead} aria-hidden className="swipe-leading flex">
            {buttons(leading)}
          </div>
        )}
        <div
          className="swipe-content"
          onClickCapture={(e) => {
            if (isOpen()) {
              e.preventDefault();
              e.stopPropagation();
              close();
            }
          }}
        >
          {children}
        </div>
        {trailing.length > 0 && (
          <div aria-hidden className="swipe-trailing flex">
            {buttons(trailing)}
          </div>
        )}
      </div>
    </ContextMenu>
  );
}
