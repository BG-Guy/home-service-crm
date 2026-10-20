import { cx } from "../cx";
import { type Tone, toneStyle } from "../tone";

/**
 * M10 success mark (DESIGN.md §4): a filled disc that pops 1 → 1.12 → 1 while
 * its checkmark stroke draws in 400 ms. CSS only (`.success-check`), no JS;
 * reduced motion shows the finished mark. It plays when it mounts, so render it
 * when the success happens (a paid screen, a sent confirmation, a rating).
 *
 * ```tsx
 * {paid && <SuccessCheck label="Payment received" />}
 * ```
 */
export function SuccessCheck({
  size = 56,
  tone = "green",
  label = "Done",
  className,
}: {
  /** Disc diameter in px (default 56). */
  size?: number;
  tone?: Tone;
  /** Accessible name. */
  label?: string;
  className?: string;
}) {
  const glyph = Math.round(size * 0.52);
  return (
    <span
      role="img"
      aria-label={label}
      className={cx(
        "success-check tone-bg inline-flex shrink-0 items-center justify-center rounded-full",
        className,
      )}
      style={toneStyle(tone, { width: size, height: size })}
    >
      {/* biome-ignore lint/a11y/noSvgWithoutTitle: decorative; the wrapper has role="img" + aria-label */}
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        width={glyph}
        height={glyph}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} />
      </svg>
    </span>
  );
}
