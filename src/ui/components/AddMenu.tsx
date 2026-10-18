"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { cx } from "../cx";
import { ActionSheet, type ActionSheetItem } from "./ActionSheet";
import { IconButton } from "./IconButton";

/**
 * The global "+" (SPEC §13.1): a context-aware ActionSheet of create actions
 * (new job / lead / customer / estimate). `nav` renders a nav-bar icon button;
 * `fab` a floating accent button above the tab bar (bouncy entrance).
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
  if (items.length === 0) return null;
  return (
    <>
      {variant === "nav" ? (
        <IconButton
          label={label}
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
          className={className}
        >
          <Plus aria-hidden size={24} strokeWidth={2.2} />
        </IconButton>
      ) : (
        <button
          type="button"
          aria-label={label}
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
          data-chrome
          className={cx(
            "enter-pop pressable fixed bottom-[calc(var(--tabbar-space)+8px)] right-[var(--gutter)] z-[var(--z-bar)] flex size-14 items-center justify-center rounded-full bg-accent text-on-accent shadow-[var(--shadow-float)] lg:bottom-8 lg:right-8",
            className,
          )}
        >
          <Plus aria-hidden size={28} strokeWidth={2.4} />
        </button>
      )}
      <ActionSheet
        open={open}
        onOpenChange={setOpen}
        title={title}
        items={items}
      />
    </>
  );
}
