import { Check } from "lucide-react";
import { Fragment } from "react";
import { cx } from "@/ui/cx";

const STEPS = ["Caller", "Schedule", "Done"] as const;

/** "1 Caller · 2 Schedule · 3 Done" progress header of the call-to-booking flow. */
export function BookingSteps({
  current,
  className,
}: {
  /** 1-based step on screen. */
  current: 1 | 2 | 3;
  className?: string;
}) {
  return (
    <ol
      aria-label="Booking steps"
      className={cx("flex items-center gap-2 py-1", className)}
    >
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const now = n === current;
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
              <span
                className={cx(
                  "num flex size-6 items-center justify-center rounded-full text-footnote font-bold",
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
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
