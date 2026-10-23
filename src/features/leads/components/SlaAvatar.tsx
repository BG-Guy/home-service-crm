"use client";

import type { CSSProperties } from "react";
import { cx } from "@/ui/cx";
import { TONE_VAR, toneFor, toneStyle } from "@/ui/tone";
import { slaTone } from "../labels";
import { useNow } from "./lead-links";

/** "4m", "1h49", "2d" (fits under the avatar). */
function shortWait(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  if (m < 24 * 60)
    return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
  return `${Math.floor(m / 1440)}d`;
}

/** The ring fills toward the red line (15 min, `slaTone`), as on the old cards. */
const RING_MS = 15 * 60_000;
const GAP = 2.5;
const W = 2.5;

/**
 * A lead's initials with the speed-to-lead ring around them (DESIGN.md §7 brief 4):
 * green < 5 min, amber < 15, red beyond; it freezes at the first response.
 * Closed leads pass `ring={false}`. Decorative: the box says the wait in words.
 */
export function SlaAvatar({
  initials,
  seed,
  size = 40,
  slaStart,
  respondedAt,
  ring = true,
  muted,
  waitTag,
  className,
}: {
  initials: string;
  seed: string;
  size?: number;
  slaStart: string;
  respondedAt: string | null;
  ring?: boolean;
  /** Closed leads: a quieter avatar. */
  muted?: boolean;
  /** Tight boxes: the live wait in a small tag under the ring (unanswered only). */
  waitTag?: boolean;
  className?: string;
}) {
  const now = useNow();
  const start = Date.parse(slaStart);
  const end = respondedAt ? Date.parse(respondedAt) : null;
  const known = end != null || now != null;
  const elapsed = Math.max(0, (end ?? now ?? start) - start);
  const tone = slaTone(elapsed / 60_000);
  const D = size + 2 * (GAP + W);
  const r = (D - W) / 2;
  const C = 2 * Math.PI * r;
  const v = known ? Math.min(1, elapsed / RING_MS) : 0;
  const c = TONE_VAR[toneFor(seed)];
  return (
    <span
      aria-hidden
      className={cx("relative inline-flex shrink-0", className)}
      style={{ width: D, height: D, ...toneStyle(tone) } as CSSProperties}
    >
      {ring && (
        // biome-ignore lint/a11y/noSvgWithoutTitle: decorative (aria-hidden parent)
        <svg
          width={D}
          height={D}
          viewBox={`0 0 ${D} ${D}`}
          className="absolute inset-0 -rotate-90"
        >
          <circle
            cx={D / 2}
            cy={D / 2}
            r={r}
            fill="none"
            strokeWidth={W}
            className="stroke-fill"
          />
          <circle
            cx={D / 2}
            cy={D / 2}
            r={r}
            fill="none"
            strokeWidth={W}
            strokeLinecap="round"
            stroke="var(--tone)"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - v)}
            className="transition-[stroke-dashoffset] duration-[var(--dur-quick)]"
          />
        </svg>
      )}
      <span
        className="absolute flex select-none items-center justify-center rounded-full font-semibold tracking-[0.01em] text-white"
        style={{
          inset: GAP + W,
          fontSize: Math.round(size * 0.38),
          background: `linear-gradient(145deg, color-mix(in srgb, ${c} 70%, #fff), ${c} 55%, color-mix(in srgb, ${c} 82%, #000))`,
          // Inline, not utilities: one-off values stay out of the global CSS.
          ...(muted && { opacity: 0.55, filter: "grayscale(35%)" }),
        }}
      >
        {initials}
      </span>
      {waitTag && ring && end == null && now != null && (
        <span
          className="tint-fg absolute -bottom-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-pill px-1.5 text-[10px] font-bold leading-[15px] tabular-nums"
          style={{
            backgroundColor: "color-mix(in srgb, var(--tone) 22%, var(--card))",
            boxShadow: "0 0 0 2px var(--card)",
          }}
        >
          {shortWait(elapsed)}
        </span>
      )}
    </span>
  );
}
