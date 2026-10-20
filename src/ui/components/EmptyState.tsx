import type { ReactNode } from "react";
import { cx } from "../cx";
import { type Tone, toneStyle } from "../tone";

/**
 * Empty state (DESIGN.md §5): the icon in a 56 px soft-tinted circle (any icon
 * size is scaled to 26 px), a 20/700 title, a `--label-2` message and one
 * primary or secondary action.
 *
 * ```tsx
 * <EmptyState icon={<Briefcase />} title="No jobs today"
 *   message="New bookings show up here." action={<Button href="/jobs/new">New job</Button>} />
 * ```
 */
export function EmptyState({
  icon,
  title,
  message,
  action,
  tone = "accent",
  compact,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  message?: ReactNode;
  action?: ReactNode;
  /** Circle tint (default accent). */
  tone?: Tone;
  /** Less vertical padding (inside cards and sheets). */
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "mx-auto flex max-w-sm flex-col items-center text-center",
        compact ? "px-4 py-8" : "px-6 py-14",
        className,
      )}
    >
      {icon && (
        <div
          aria-hidden
          className="tint-bg tint-fg mb-4 flex size-14 items-center justify-center rounded-full [&>svg]:size-[26px]"
          style={toneStyle(tone)}
        >
          {icon}
        </div>
      )}
      <h2 className="text-title3 text-label">{title}</h2>
      {message && (
        <p className="mt-1.5 text-subhead text-label-2 [text-wrap:pretty]">
          {message}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
