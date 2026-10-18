import { BadgeCheck, Star } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../cx";
import { Avatar } from "./Avatar";

/**
 * Technician card for the customer portal and the on-my-way page (SPEC §12.6):
 * photo, first name only, license #, rating. Presentational.
 */
export function TechCard({
  firstName,
  photoUrl,
  seed,
  licenseNo,
  rating,
  ratingCount,
  subtitle,
  trailing,
  className,
}: {
  firstName: string;
  photoUrl?: string | null;
  /** Stable color seed (user id). */
  seed?: string;
  licenseNo?: string | null;
  /** 0–5 average. */
  rating?: number | null;
  ratingCount?: number | null;
  /** e.g. "Your technician · arriving 2:30–3:00 PM". */
  subtitle?: ReactNode;
  /** e.g. a call/text button. */
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex items-center gap-3.5 rounded-tile bg-card p-4 shadow-card",
        className,
      )}
    >
      <Avatar name={firstName} src={photoUrl} seed={seed} size={56} />
      <div className="min-w-0 flex-1">
        <div className="text-headline">{firstName}</div>
        {subtitle && (
          <div className="text-subhead text-label-2">{subtitle}</div>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-footnote text-label-2">
          {rating != null && (
            <span className="num inline-flex items-center gap-1">
              <Star
                aria-hidden
                size={13}
                fill="var(--sys-yellow)"
                stroke="var(--sys-yellow)"
              />
              <span>
                <span className="font-semibold text-label">
                  {rating.toFixed(1)}
                </span>
                {ratingCount ? ` (${ratingCount})` : ""}
                <span className="sr-only"> out of 5 stars</span>
              </span>
            </span>
          )}
          {licenseNo && (
            <span className="inline-flex items-center gap-1">
              <BadgeCheck aria-hidden size={13} />
              License #{licenseNo}
            </span>
          )}
        </div>
      </div>
      {trailing}
    </div>
  );
}
