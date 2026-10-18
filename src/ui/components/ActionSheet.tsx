"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "../cx";
import { Sheet } from "./Sheet";

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
  "overflow-hidden rounded-[14px] bg-[var(--alert-bg)] backdrop-blur-[30px] backdrop-saturate-[180%]";
const row =
  "flex min-h-[57px] w-full items-center justify-center gap-2 px-4 text-title3 outline-offset-[-2px] active:bg-fill-2 disabled:opacity-40";

/**
 * iOS action sheet: a list of choices plus a separate Cancel, built on `Sheet`
 * (SPEC §12.6). Use for "+" menus, photo source pickers, destructive confirmations.
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
  const close = () => onOpenChange(false);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      bare
      label={typeof title === "string" ? title : "Actions"}
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
  );
}
