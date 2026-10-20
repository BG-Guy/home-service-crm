"use client";

import { Plus } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { cx } from "../cx";
import type { ActionSheetItem } from "./ActionSheet";
import { IconButton } from "./IconButton";
import { MenuPopover } from "./MenuPopover";

/**
 * The global "+" (SPEC §13.1): a context-aware menu of create actions (new job /
 * lead / customer / estimate) that grows from the button (docs/DESIGN.md §4 M5),
 * on phones too, like an iOS pull-down menu. `nav` renders a nav-bar icon button;
 * `fab` a floating accent button above the tab bar (bouncy entrance) whose menu
 * opens upward.
 *
 * ```tsx
 * <AddMenu items={[{ label: "New job", href: "/jobs/new" }, { label: "New lead", href: "/leads/new" }]} />
 * ```
 */
export function AddMenu({
  items,
  title,
  label = "Create",
  variant = "nav",
  className,
}: {
  items: readonly ActionSheetItem[];
  title?: string;
  /** Accessible name of the trigger. */
  label?: string;
  variant?: "nav" | "fab";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  // A tap on the trigger while the menu is open: light dismiss closes it on
  // pointerdown, so the click must not reopen it.
  const wasOpen = useRef<boolean | null>(null);
  const anchor = useCallback(
    () => trigger.current?.getBoundingClientRect() ?? null,
    [],
  );
  const returnFocus = useCallback(() => trigger.current, []);
  if (items.length === 0) return null;
  const toggle = {
    "aria-haspopup": "menu" as const,
    "aria-expanded": open,
    onPointerDown: () => {
      wasOpen.current = open;
    },
    onClick: () => {
      const was = wasOpen.current ?? open;
      wasOpen.current = null;
      setOpen(!was);
    },
  };
  return (
    <>
      {variant === "nav" ? (
        <IconButton
          ref={trigger}
          label={label}
          className={className}
          {...toggle}
        >
          <Plus aria-hidden size={24} strokeWidth={2.2} />
        </IconButton>
      ) : (
        <button
          ref={trigger}
          type="button"
          aria-label={label}
          data-chrome
          className={cx(
            "enter-pop pressable fixed bottom-[calc(var(--tabbar-space)+var(--bottombar-h,0px)+8px)] right-[var(--gutter)] z-[var(--z-bar)] flex size-14 items-center justify-center rounded-full bg-accent text-on-accent shadow-[var(--shadow-float)] lg:bottom-8 lg:right-8",
            className,
          )}
          {...toggle}
        >
          <Plus aria-hidden size={28} strokeWidth={2.4} />
        </button>
      )}
      <MenuPopover
        open={open}
        onOpenChange={setOpen}
        anchor={anchor}
        align="end"
        label={title ?? label}
        title={title}
        items={items}
        returnFocus={returnFocus}
      />
    </>
  );
}
