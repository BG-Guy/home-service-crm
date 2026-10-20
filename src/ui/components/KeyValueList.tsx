import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "../cx";

export interface KeyValueItem {
  label: ReactNode;
  value: ReactNode;
  /** Link the value (tel:, mailto:, maps, or an app route). */
  href?: string;
  /** Stack label above value (long text such as addresses and notes). */
  stacked?: boolean;
  /** Use tabular numbers for the value. */
  numeric?: boolean;
  /** Stable key (defaults to the index). */
  key?: string;
}

/**
 * Label / value rows for detail views (DESIGN.md §5), as an inset grouped card
 * built on `<dl>`: quiet label, the value in the primary color (hierarchy from
 * type). Empty values render an em dash.
 */
export function KeyValueList({
  items,
  className,
  card = true,
}: {
  items: readonly KeyValueItem[];
  className?: string;
  /** Render inside a list card (default) or bare. */
  card?: boolean;
}) {
  return (
    <dl className={cx(card && "list-card", className)}>
      {items.map((it, i) => {
        const empty = it.value == null || it.value === "" || it.value === false;
        const value = empty ? (
          <span className="text-label-3">—</span>
        ) : it.href ? (
          <Link
            href={it.href}
            className="text-accent-text underline-offset-2 hover:underline"
          >
            {it.value}
          </Link>
        ) : (
          it.value
        );
        return (
          <div
            key={it.key ?? i}
            className={cx(
              "list-row flex min-h-12 px-4 py-3",
              it.stacked
                ? "flex-col gap-0.5"
                : "items-baseline justify-between gap-4",
            )}
          >
            {/* Side by side, a long label wraps and the value keeps ≤ 60%, so
                neither pushes the other off the card (QA T4-04). */}
            <dt
              className={cx(
                it.stacked
                  ? "text-footnote font-semibold text-label-2"
                  : "min-w-0 flex-1 text-body text-label-2",
              )}
            >
              {it.label}
            </dt>
            <dd
              className={cx(
                "text-body text-label",
                it.stacked
                  ? "min-w-0 whitespace-pre-line break-words"
                  : "max-w-[60%] shrink-0 break-words text-right",
                it.numeric && "num",
              )}
            >
              {value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
