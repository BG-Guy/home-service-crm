import type { ReactNode } from "react";
import { cx } from "../cx";

/**
 * Empty state (SPEC §12.6): large muted icon, title, message, primary action.
 *
 * ```tsx
 * <EmptyState icon={<Briefcase size={44} />} title="No jobs today"
 *   message="New bookings show up here." action={<Button href="/jobs/new">New job</Button>} />
 * ```
 */
export function EmptyState({
  icon,
  title,
  message,
  action,
  compact,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  message?: ReactNode;
  action?: ReactNode;
  /** Less vertical padding (inside cards and sheets). */
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "mx-auto flex max-w-sm flex-col items-center text-center",
        compact ? "px-4 py-8" : "px-6 py-16",
        className,
      )}
    >
      {icon && (
        <div aria-hidden className="mb-4 flex text-label-3">
          {icon}
        </div>
      )}
      <h2 className="text-title3 font-semibold">{title}</h2>
      {message && <p className="mt-1.5 text-subhead text-label-2">{message}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
