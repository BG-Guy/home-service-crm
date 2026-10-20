import { BadgeCheck, MessageCircle, Phone, Star } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../cx";
import { Avatar } from "./Avatar";
import { IconButton } from "./IconButton";

/**
 * Technician card in the Uber driver-card style (DESIGN.md §5): avatar 48, first
 * name, rating and license, an optional status and ETA on the right, then the
 * vehicle with round call / text buttons. Used on the customer portal, the
 * on-my-way page and job details. Presentational and server-renderable.
 *
 * ```tsx
 * <TechCard firstName="Tom" rating={4.9} ratingCount={212} vehicle="White Ford Transit · 7XJ 221"
 *   status={<StatusPill kind="job" status="en_route" />} eta="12 min"
 *   phoneHref="tel:+15551234567" smsHref="sms:+15551234567" />
 * ```
 */
export function TechCard({
  firstName,
  photoUrl,
  seed,
  licenseNo,
  rating,
  ratingCount,
  subtitle,
  vehicle,
  status,
  eta,
  etaLabel = "away",
  phoneHref,
  smsHref,
  presence,
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
  /** e.g. "White Ford Transit · 7XJ 221". */
  vehicle?: ReactNode;
  /** e.g. a `<StatusPill>` next to the name. */
  status?: ReactNode;
  /** Big tabular ETA on the right, e.g. "12 min". */
  eta?: ReactNode;
  /** Caption under the ETA (default "away"). */
  etaLabel?: ReactNode;
  /** `tel:` link → round call button. */
  phoneHref?: string;
  /** `sms:` link → round text button. */
  smsHref?: string;
  /** Green presence ring on the avatar (clocked in / live). */
  presence?: boolean;
  /** Any extra trailing node (e.g. a custom button). */
  trailing?: ReactNode;
  className?: string;
}) {
  const actions = phoneHref != null || smsHref != null;
  return (
    <div className={cx("card p-4", className)}>
      <div className="flex items-center gap-3.5">
        <Avatar
          name={firstName}
          src={photoUrl}
          seed={seed}
          size={48}
          presence={presence}
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-headline">{firstName}</span>
            {status}
          </div>
          {subtitle && (
            <div className="text-subhead text-label-2">{subtitle}</div>
          )}
          {(rating != null || licenseNo) && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-footnote text-label-2">
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
          )}
        </div>
        {eta != null && (
          <div className="shrink-0 text-right">
            <div className="num text-title2 leading-none">{eta}</div>
            <div className="mt-1 text-caption text-label-2">{etaLabel}</div>
          </div>
        )}
        {trailing}
      </div>
      {(vehicle != null || actions) && (
        <div className="mt-3 flex items-center gap-3 border-t border-sep pt-3">
          <div className="min-w-0 flex-1 truncate text-subhead font-medium text-label">
            {vehicle}
          </div>
          {smsHref && (
            <IconButton label="Text" variant="secondary" href={smsHref}>
              <MessageCircle size={20} aria-hidden />
            </IconButton>
          )}
          {phoneHref && (
            <IconButton label="Call" variant="secondary" href={phoneHref}>
              <Phone size={20} aria-hidden />
            </IconButton>
          )}
        </div>
      )}
    </div>
  );
}
