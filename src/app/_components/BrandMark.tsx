import { cx } from "@/ui/cx";

/** House + wrench glyph (64-unit box): shared by the in-app mark and the generated PWA icons. */
export const HOUSE_PATH = "M32 9 6 31h7v24h38V31h7L32 9Z";
export const WRENCH_PATH =
  "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z";

/** The glyph as an SVG; `fg` is the house, `cut` the wrench drawn on top. */
export function BrandGlyph({
  size,
  fg = "#fff",
  cut = "var(--accent)",
}: {
  size: number;
  fg?: string;
  cut?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d={HOUSE_PATH} fill={fg} strokeLinejoin="round" />
      <g transform="translate(19 25) scale(1.1)">
        <path
          d={WRENCH_PATH}
          fill="none"
          stroke={cut}
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

/** App mark: the glyph on an accent squircle (auth screens, sidebar, offline page). */
export function BrandMark({
  size = 56,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cx(
        "inline-flex items-center justify-center bg-accent shadow-[var(--shadow-float)]",
        className,
      )}
      style={{ width: size, height: size, borderRadius: size * 0.2237 }}
    >
      <BrandGlyph size={Math.round(size * 0.72)} />
    </span>
  );
}
