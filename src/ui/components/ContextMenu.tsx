"use client";

import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { cx } from "../cx";
import { haptic } from "../motion/haptics";
import { onMenuKeyDown, placeMenu } from "./MenuPopover";

export interface MenuAction {
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
}

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE = 10;

/**
 * Context menu (SPEC §12.6): long-press 450 ms on touch, right-click on desktop,
 * Shift+F10 / the Menu key from the keyboard. Renders a top-layer
 * `popover="manual"` menu (own light-dismiss so the finger lift after a long
 * press doesn't close it), keyboard navigable (↑/↓/Home/End, Esc). It grows
 * from the press point (docs/DESIGN.md §4 M5): glass, scale .92 → 1 in 220 ms,
 * items staggered 12 ms (`.menu-pop` in globals.css).
 *
 * ```tsx
 * <ContextMenu actions={[{ label: "Call", onSelect: call }, { label: "Delete", destructive: true, onSelect: del }]}>
 *   <ListRow … />
 * </ContextMenu>
 * ```
 */
export function ContextMenu({
  actions,
  children,
  label = "Actions",
  disabled,
  className,
}: {
  actions: readonly MenuAction[];
  children: ReactNode;
  /** Accessible name of the menu. */
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const [pressing, setPressing] = useState(false);
  const [open, setOpen] = useState(false);
  const menuId = useId();

  const inMenu = (t: EventTarget | null) =>
    !!menuRef.current?.contains(t as Node);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPressing(false);
  };

  const openAt = (x: number, y: number) => {
    const menu = menuRef.current;
    if (!menu || disabled || actions.length === 0) return;
    if (!menu.matches(":popover-open")) menu.showPopover();
    placeMenu(menu, { x, y }, "start");
    setOpen(true);
    requestAnimationFrame(() =>
      menu
        .querySelector<HTMLElement>("[role=menuitem]:not(:disabled)")
        ?.focus(),
    );
  };

  const close = (restoreFocus = true) => {
    const menu = menuRef.current;
    if (menu?.matches(":popover-open")) {
      const hadFocus = menu.contains(document.activeElement);
      menu.hidePopover();
      if (restoreFocus && hadFocus) {
        wrapRef.current
          ?.querySelector<HTMLElement>(
            "a, button, [tabindex]:not([tabindex='-1'])",
          )
          ?.focus();
      }
    }
    setOpen(false);
  };

  // Own light-dismiss while open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    const onScroll = () => close(false);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: unmount cleanup only
  useEffect(() => () => clearTimer(), []);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: wrapper forwards gestures; actions are also reachable via Shift+F10
    <div
      ref={wrapRef}
      className={cx("ctx-target select-none", className)}
      data-pressing={pressing || undefined}
      onContextMenu={(e) => {
        if (disabled || actions.length === 0 || inMenu(e.target)) return;
        e.preventDefault();
        clearTimer();
        openAt(e.clientX, e.clientY);
      }}
      onPointerDown={(e) => {
        suppressClick.current = false;
        if (
          disabled ||
          e.pointerType === "mouse" ||
          actions.length === 0 ||
          inMenu(e.target)
        )
          return;
        start.current = { x: e.clientX, y: e.clientY };
        setPressing(true);
        timer.current = setTimeout(() => {
          timer.current = null;
          setPressing(false);
          suppressClick.current = true;
          haptic();
          const p = start.current;
          if (p) openAt(p.x, p.y);
        }, LONG_PRESS_MS);
      }}
      onPointerMove={(e) => {
        const p = start.current;
        if (
          timer.current &&
          p &&
          Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_TOLERANCE
        )
          clearTimer();
      }}
      onPointerUp={clearTimer}
      onPointerCancel={clearTimer}
      onClickCapture={(e) => {
        if (suppressClick.current && !inMenu(e.target)) {
          suppressClick.current = false;
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onKeyDown={(e) => {
        if (inMenu(e.target)) return;
        if ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") {
          e.preventDefault();
          const r = (e.target as HTMLElement).getBoundingClientRect();
          openAt(r.left + 16, r.bottom);
        }
      }}
    >
      {children}
      <div
        ref={menuRef}
        id={menuId}
        popover="manual"
        role="menu"
        aria-label={label}
        className="ctx-menu menu-pop"
        onKeyDown={(e) => onMenuKeyDown(e, close)}
      >
        {actions.map((a, i) => (
          <button
            key={a.label}
            type="button"
            role="menuitem"
            disabled={a.disabled}
            className={cx("menu-pop-item", a.destructive && "text-danger")}
            style={{ "--i": i } as CSSProperties}
            onClick={() => {
              close();
              a.onSelect();
            }}
          >
            <span className="min-w-0 flex-1 truncate">{a.label}</span>
            {a.icon && (
              <span aria-hidden className="menu-pop-icon">
                {a.icon}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
