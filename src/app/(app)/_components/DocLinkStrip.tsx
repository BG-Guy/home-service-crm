import { ChevronRight, CircleCheck } from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";
import { cx } from "@/ui/cx";

// The documents of one job in order, linked (Quote to Paid "sync"): estimate →
// job → invoice, e.g. "EST-1026 → J-1079 → INV-1067". A shared piece for the
// estimate, invoice and job screens to adopt; server-renderable, no JS.

export interface DocLink {
  /** "EST-1026", "J-1079", "INV-1067". */
  label: string;
  /** The document's page; omit it for the one on screen (plain text). */
  href?: string | null;
  /** Settled (approved, done, paid): a green check. */
  done?: boolean;
}

export function DocLinkStrip({
  items,
  label = "Linked documents",
  className,
}: {
  items: readonly DocLink[];
  /** The strip's accessible name. */
  label?: string;
  className?: string;
}) {
  const shown = items.filter((i) => i.label);
  if (shown.length < 2) return null;
  return (
    <nav
      aria-label={label}
      className={cx("flex flex-wrap items-center gap-1.5", className)}
    >
      {shown.map((it, i) => {
        const chip = (
          <span
            className={cx(
              "inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-pill bg-card px-2.5 text-footnote font-semibold shadow-card",
              it.done ? "text-success" : "text-label",
            )}
          >
            {it.done && <CircleCheck size={13} aria-hidden />}
            {it.label}
          </span>
        );
        return (
          <Fragment key={it.label}>
            {i > 0 && (
              <ChevronRight size={14} aria-hidden className="text-label-3" />
            )}
            {it.href ? (
              <Link href={it.href} className="hit-44 rounded-pill">
                {chip}
              </Link>
            ) : (
              <span aria-current="page">{chip}</span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
