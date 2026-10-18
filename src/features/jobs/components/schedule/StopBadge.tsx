import type { CSSProperties } from "react";
import { cx } from "@/ui/cx";

/**
 * A route stop's number in the tech's color, matching its map pin (presentational;
 * server or client). `offMap`: the stop has no pin (dashed outline). `label` "?"
 * marks an unassigned job. Screen readers hear "Stop 3" / "Unassigned".
 */
export function StopBadge({
  label,
  color,
  offMap = false,
  done = false,
  size = 26,
  className,
}: {
  label: string;
  /** CSS color (hex or `var(--…)`), from `techColor()`. */
  color: string;
  offMap?: boolean;
  done?: boolean;
  size?: number;
  className?: string;
}) {
  const style: CSSProperties = offMap
    ? { width: size, height: size, borderColor: color }
    : { width: size, height: size, background: color };
  return (
    <span
      className={cx(
        "num inline-flex shrink-0 select-none items-center justify-center rounded-full text-caption font-bold leading-none",
        offMap
          ? "border-[1.5px] border-dashed bg-card text-label-2"
          : "text-white shadow-[0_0_0_1.5px_var(--card)]",
        done && !offMap && "opacity-60",
        className,
      )}
      style={style}
    >
      {label === "?" ? (
        <>
          <span className="sr-only">Unassigned,</span>
          <span aria-hidden>?</span>
        </>
      ) : (
        <>
          <span className="sr-only">Stop </span>
          {label}
          {/* A pause, so "Stop 1, 8:00 AM" isn't heard as "18:00". */}
          <span className="sr-only">,</span>
        </>
      )}
    </span>
  );
}
