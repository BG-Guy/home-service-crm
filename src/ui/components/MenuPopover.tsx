"use client";

import Link from "next/link";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
} from "react";
import { cx } from "../cx";

export interface MenuPopoverItem {
  label: string;
  icon?: ReactNode;
  /** Navigate (push transition) and close. */
  href?: string;
  /** Runs as the menu closes. */
  onSelect?: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

/** What a menu grows from: an element's rect, or a point (right-click). */
export type MenuAnchor = DOMRect | { x: number; y: number };

const NAV_FORWARD = ["nav-forward"];
const ITEM = "[role=menuitem]:not(:disabled):not([aria-disabled=true])";

/**
 * Places a shown menu next to its anchor: below it (above when there's no room),
 * aligned to its `end` / `start` edge or centered, kept 8 px inside the viewport.
 * The transform-origin sits at the anchor, so the M5 scale grows from the trigger.
 * Uses layout sizes (offsetWidth), not the scaled rect of the entry animation.
 */
export function placeMenu(
  menu: HTMLElement,
  anchor: MenuAnchor,
  align: "start" | "end" | "center" = "end",
): void {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  const rect = "width" in anchor;
  const x0 = rect ? anchor.left : anchor.x;
  const x1 = rect ? anchor.right : anchor.x;
  const y0 = rect ? anchor.top : anchor.y;
  const y1 = rect ? anchor.bottom : anchor.y;
  const gap = rect ? 6 : 2;
  const raw =
    align === "end" ? x1 - w : align === "start" ? x0 : (x0 + x1) / 2 - w / 2;
  const left = Math.min(Math.max(8, raw), vw - w - 8);
  const below = y1 + gap + h + 8 <= vh || y0 - gap - h < 8;
  const top = below ? y1 + gap : Math.max(8, y0 - gap - h);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  const ox = Math.min(Math.max((x0 + x1) / 2 - left, 16), w - 16);
  menu.style.transformOrigin = `${ox}px ${below ? -gap : h + gap}px`;
}

/** ↑/↓/Home/End move between items; Tab closes (menus aren't tab stops). */
export function onMenuKeyDown(
  e: ReactKeyboardEvent<HTMLElement>,
  close: () => void,
): void {
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(ITEM));
  const i = items.indexOf(document.activeElement as HTMLElement);
  let next: HTMLElement | undefined;
  if (e.key === "ArrowDown") next = items[(i + 1) % items.length];
  else if (e.key === "ArrowUp")
    next = items[(i - 1 + items.length) % items.length];
  else if (e.key === "Home") next = items[0];
  else if (e.key === "End") next = items[items.length - 1];
  else if (e.key === "Tab") {
    e.preventDefault();
    close();
    return;
  }
  if (next) {
    e.preventDefault();
    next.focus();
  }
}

/**
 * A glass pop-up menu that grows from its trigger (docs/DESIGN.md §4 M5): scale
 * .92 → 1 + fade in 220 ms on the snappy spring, items staggered 12 ms. A native
 * `popover="auto"` gives light dismiss and Esc; the entry/exit is CSS
 * (`.menu-pop` in globals.css, `@starting-style`). Controlled by `open`:
 * `anchor()` is read when it opens. Used by AddMenu and the desktop ActionSheet.
 */
export function MenuPopover({
  open,
  onOpenChange,
  anchor,
  align = "end",
  label,
  title,
  message,
  items,
  returnFocus,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where to grow from, read at open time (null: the viewport center). */
  anchor: () => MenuAnchor | null;
  align?: "start" | "end" | "center";
  /** Accessible name of the menu. */
  label: string;
  /** Optional caption above the items. */
  title?: ReactNode;
  message?: ReactNode;
  items: readonly MenuPopoverItem[];
  /** Focused again when the menu closes with focus inside it. */
  returnFocus?: () => HTMLElement | null;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const shown = menu.matches(":popover-open");
    if (open && !shown) {
      menu.showPopover();
      const a = anchor();
      placeMenu(
        menu,
        a ?? { x: window.innerWidth / 2, y: window.innerHeight / 3 },
        a ? align : "center",
      );
      requestAnimationFrame(() =>
        menu.querySelector<HTMLElement>(ITEM)?.focus(),
      );
    } else if (!open && shown) {
      menu.hidePopover();
    }
  }, [open, anchor, align]);

  const close = () => onOpenChange(false);

  return (
    <div
      ref={ref}
      popover="auto"
      role="menu"
      aria-label={label}
      className={cx("menu-pop", className)}
      onKeyDown={(e) => onMenuKeyDown(e, close)}
      onToggle={(e) => {
        const nowOpen = (e.nativeEvent as ToggleEvent).newState === "open";
        if (nowOpen) return;
        const menu = ref.current;
        if (
          menu?.contains(document.activeElement) ||
          document.activeElement === document.body
        )
          returnFocus?.()?.focus({ preventScroll: true });
        if (open) onOpenChange(false);
      }}
    >
      {title || message ? (
        <div className="menu-pop-head">
          {title ? <div className="font-semibold">{title}</div> : null}
          {message ? <div>{message}</div> : null}
        </div>
      ) : null}
      {items.map((it, i) => {
        const style = { "--i": i } as CSSProperties;
        const cls = cx("menu-pop-item", it.destructive && "text-danger");
        const inner = (
          <>
            <span className="min-w-0 flex-1 truncate">{it.label}</span>
            {it.icon ? (
              <span aria-hidden className="menu-pop-icon">
                {it.icon}
              </span>
            ) : null}
          </>
        );
        return it.href && !it.disabled ? (
          <Link
            key={it.label}
            href={it.href}
            role="menuitem"
            transitionTypes={NAV_FORWARD}
            className={cls}
            style={style}
            onClick={() => {
              close();
              it.onSelect?.();
            }}
          >
            {inner}
          </Link>
        ) : (
          <button
            key={it.label}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            className={cls}
            style={style}
            onClick={() => {
              close();
              it.onSelect?.();
            }}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}
