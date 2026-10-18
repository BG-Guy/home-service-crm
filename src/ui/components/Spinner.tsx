import { cx } from "../cx";

const SPOKES = [0, 1, 2, 3, 4, 5, 6, 7];

/**
 * iOS activity indicator (8 spokes, stepped rotation). Inherits `currentColor`.
 * @param size px (default 20)
 * @param label accessible label; omit when the parent already says "Loading".
 */
export function Spinner({
  size = 20,
  label,
  className,
}: {
  size?: number;
  label?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={cx("spinner", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {SPOKES.map((i) => (
        <line
          key={i}
          x1="12"
          y1="2.5"
          x2="12"
          y2="7"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          opacity={1 - i * 0.11}
          transform={`rotate(${-i * 45} 12 12)`}
        />
      ))}
    </svg>
  );
}
