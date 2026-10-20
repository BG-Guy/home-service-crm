"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { type ReactNode, useCallback, useSyncExternalStore } from "react";
import { cx } from "../cx";
import { DESKTOP_OVERLAY_QUERY, isDesktop } from "./dialog-utils";
import { Sheet } from "./Sheet";

// The desktop pop-up loads only where it's used: phones never download it.
const MenuPopover = dynamic(
  () => import("./MenuPopover").then((m) => m.MenuPopover),
  { ssr: false },
);

export interface ActionSheetItem {
  label: string;
  /** Runs as the sheet starts closing. */
  onSelect?: () => void;
  /** Navigate instead (push transition). */
  href?: string;
  destructive?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
}

const card =
  "overflow-hidden rounded-[18px] bg-[var(--alert-bg)] backdrop-blur-[30px] backdrop-saturate-[180%]";
const row =
  "flex min-h-[57px] w-full items-center justify-center gap-2 px-4 text-title3 outline-offset-[-2px] active:bg-fill-2 disabled:opacity-40";

// The control the user pressed last: on desktop the menu grows from it, so call
// sites (an IconButton that sets `open`) don't have to pass an anchor.
let lastPress: { el: Element; at: number } | null = null;
if (typeof document !== "undefined") {
  document.addEventListener(
    "pointerdown",
    (e) => {
      const el = (e.target as Element | null)?.closest?.(
        "button, a, [role=button], [role=menuitem]",
      );
      if (el) lastPress = { el, at: performance.now() };
    },
    { capture: true, passive: true },
  );
}

function pressedAnchor(): DOMRect | null {
  const recent =
    lastPress && performance.now() - lastPress.at < 1500 ? lastPress.el : null;
  const el =
    (recent?.isConnected ? recent : null) ??
    (document.activeElement?.matches("button, a, [role=button]")
      ? document.activeElement
      : null);
  return el ? el.getBoundingClientRect() : null;
}

const subscribeDesktop = (cb: () => void) => {
  const m = window.matchMedia(DESKTOP_OVERLAY_QUERY);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

/**
 * Action sheet: a list of choices (docs/DESIGN.md §5). Use for "more" menus,
 * photo source pickers, destructive confirmations.
 * - Phone: the iOS bottom sheet (built on `Sheet`, M4) with a separate Cancel.
 * - Desktop (≥ 768 px or a fine pointer): a glass pop-up menu that grows from the
 *   control that opened it (M5); Esc or a click outside cancels.
 *
 * ```tsx
 * <ActionSheet open={open} onOpenChange={setOpen} title="New"
 *   items={[{ label: "Job", href: "/jobs/new" }, { label: "Lead", href: "/leads/new" }]} />
 * ```
 */
export function ActionSheet({
  open,
  onOpenChange,
  title,
  message,
  items,
  cancelLabel = "Cancel",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  message?: ReactNode;
  items: readonly ActionSheetItem[];
  cancelLabel?: string;
}) {
  const desktop = useSyncExternalStore(
    subscribeDesktop,
    isDesktop,
    () => false,
  );
  const anchor = useCallback(() => pressedAnchor(), []);
  const close = () => onOpenChange(false);
  const label = typeof title === "string" ? title : "Actions";
  return (
    <>
      {desktop && (
        <MenuPopover
          open={open}
          onOpenChange={onOpenChange}
          anchor={anchor}
          align="end"
          label={label}
          title={title}
          message={message}
          items={items}
        />
      )}
      <Sheet
        open={open && !desktop}
        onOpenChange={onOpenChange}
        bare
        label={label}
        detents={["content"]}
      >
        <div className="flex flex-col gap-2 px-2 pb-[max(env(safe-area-inset-bottom),8px)]">
          <div className={card}>
            {(title || message) && (
              <div className="hairline-b px-4 py-3.5 text-center text-footnote text-label-2">
                {title && <div className="font-semibold">{title}</div>}
                {message && (
                  <div className={title ? "mt-0.5" : undefined}>{message}</div>
                )}
              </div>
            )}
            {items.map((it, i) => {
              const cls = cx(
                row,
                i > 0 && "hairline-t",
                it.destructive ? "text-danger" : "text-accent-text",
              );
              const inner = (
                <>
                  {it.icon}
                  <span className="truncate">{it.label}</span>
                </>
              );
              return it.href && !it.disabled ? (
                <Link
                  key={it.label}
                  href={it.href}
                  transitionTypes={["nav-forward"]}
                  className={cls}
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
                  disabled={it.disabled}
                  className={cls}
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
          <div className={card}>
            <button
              type="button"
              className={cx(row, "font-semibold text-accent-text")}
              onClick={close}
            >
              {cancelLabel}
            </button>
          </div>
        </div>
      </Sheet>
    </>
  );
}
