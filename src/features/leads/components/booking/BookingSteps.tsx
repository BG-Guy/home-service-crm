import { Check } from "lucide-react";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { cx } from "@/ui/cx";

const STEPS = ["Who", "What", "When"] as const;
export type BookingStep = 1 | 2 | 3;

/**
 * "Who · What · When" progress header of the booking flow (any lead). Done steps
 * can go back: a link (`hrefs`) or a button (`onPick`, client components only).
 * No hooks, so server pages and client components both render it.
 */
export function BookingSteps({
  current,
  hrefs,
  onPick,
  className,
}: {
  /** 1-based step on screen; 4 = all done (the Done screen). */
  current: BookingStep | 4;
  hrefs?: Partial<Record<BookingStep, string>>;
  onPick?: (step: BookingStep) => void;
  className?: string;
}) {
  return (
    <ol
      aria-label="Booking steps"
      className={cx("flex items-center gap-2 py-1", className)}
    >
      {STEPS.map((label, i) => {
        const n = (i + 1) as BookingStep;
        const done = n < current;
        const now = n === current;
        const body: ReactNode = (
          <>
            <span
              className={cx(
                "num flex size-6 shrink-0 items-center justify-center rounded-full text-footnote font-bold",
                now
                  ? "bg-label text-bg"
                  : done
                    ? "bg-[color-mix(in_srgb,var(--accent)_var(--tint-a),transparent)] text-accent-text"
                    : "bg-fill text-label-2",
              )}
            >
              {done ? <Check aria-hidden size={14} strokeWidth={3} /> : n}
            </span>
            <span
              className={cx(
                "text-subhead",
                now ? "font-semibold text-label" : "text-label-2",
              )}
            >
              {label}
              {done && <span className="sr-only"> (done)</span>}
            </span>
          </>
        );
        const href = done ? hrefs?.[n] : undefined;
        const tap = "hit-44 pressable flex items-center gap-2 rounded-pill";
        return (
          <Fragment key={label}>
            {i > 0 && (
              <li
                aria-hidden
                className={cx(
                  "h-px min-w-3 flex-1 rounded-full",
                  n <= current ? "bg-label-2" : "bg-sep",
                )}
              />
            )}
            <li
              aria-current={now ? "step" : undefined}
              className="flex shrink-0 items-center gap-2"
            >
              {href ? (
                <Link
                  href={href}
                  transitionTypes={["nav-back"]}
                  className={tap}
                  aria-label={`Back to ${label}`}
                >
                  {body}
                </Link>
              ) : done && onPick ? (
                <button
                  type="button"
                  className={tap}
                  onClick={() => onPick(n)}
                  aria-label={`Back to ${label}`}
                >
                  {body}
                </button>
              ) : (
                body
              )}
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
