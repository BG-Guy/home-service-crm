"use client";

import { BarSummary, BottomBar } from "@/ui/components/BottomBar";
import { Button } from "@/ui/components/Button";
import { cx } from "@/ui/cx";

/**
 * The settings save bar (DESIGN.md §5 bottom action bar): unsaved-changes status on
 * the left, Save on the right. Sticky above the tab bar; render it LAST in the
 * form's (tall) container. `onSave` for click-to-save forms, else it's a submit.
 */
export function SaveBar({
  dirty,
  pending,
  onSave,
  label = "Save changes",
  disabled,
  className,
}: {
  dirty: boolean;
  pending: boolean;
  onSave?: () => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <BottomBar
      label="Save changes"
      className={cx("mt-2", className)}
      summary={
        <BarSummary
          title={
            <span className="inline-flex items-center gap-2 text-subhead font-semibold">
              <span
                aria-hidden
                className={cx(
                  "size-2 rounded-full transition-colors",
                  dirty ? "bg-[var(--sys-orange)]" : "bg-[var(--sys-green)]",
                )}
              />
              {pending ? "Saving…" : dirty ? "Unsaved changes" : "All saved"}
            </span>
          }
        />
      }
      action={
        <Button
          type={onSave ? "button" : "submit"}
          size="lg"
          loading={pending}
          loadingText="Saving…"
          disabled={pending || disabled}
          onClick={onSave}
        >
          {label}
        </Button>
      }
    />
  );
}
