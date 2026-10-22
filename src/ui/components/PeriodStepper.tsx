import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../cx";
import { IconButton } from "./IconButton";

/**
 * Previous / label / next for a period (a day, a week) in a compact bar, such as
 * a full-screen hub's top bar. 36 px plain circles with 44 px hit areas; the
 * label is tabular and announced when it changes.
 *
 * ```tsx
 * <PeriodStepper prevLabel="Previous day" nextLabel="Next day"
 *   onPrev={() => go(prev)} onNext={() => go(next)}>Today · Oct 22</PeriodStepper>
 * ```
 */
export function PeriodStepper({
  children,
  onPrev,
  onNext,
  prevLabel = "Previous",
  nextLabel = "Next",
  className,
}: {
  /** The period, e.g. "Today · Oct 22" or "Oct 19 – 25". */
  children: ReactNode;
  onPrev: () => void;
  onNext: () => void;
  prevLabel?: string;
  nextLabel?: string;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-none items-center gap-0.5", className)}>
      <IconButton label={prevLabel} variant="plain" size={36} onClick={onPrev}>
        <ChevronLeft size={20} aria-hidden />
      </IconButton>
      <span
        aria-live="polite"
        className="num min-w-24 whitespace-nowrap text-center text-subhead font-semibold"
      >
        {children}
      </span>
      <IconButton label={nextLabel} variant="plain" size={36} onClick={onNext}>
        <ChevronRight size={20} aria-hidden />
      </IconButton>
    </div>
  );
}
