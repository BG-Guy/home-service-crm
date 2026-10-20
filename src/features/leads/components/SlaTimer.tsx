"use client";

import { Timer } from "lucide-react";
import { useEffect, useState } from "react";
import { cx } from "@/ui/cx";
import { toneStyle } from "@/ui/tone";
import { slaTone } from "../labels";

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 3600)
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  if (s < 86_400)
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86_400)}d`;
}

/** Fits inside the ring: "4:35", "1h30", "2d". */
function fmtShort(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 3600)
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  if (s < 86_400)
    return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
  return `${Math.floor(s / 86_400)}d`;
}

/** The ring fills over the red threshold (15 min, see `slaTone`). */
const RING_MS = 15 * 60_000;

/**
 * Speed-to-lead timer (SPEC M04): green < 5 min, amber < 15, red beyond, measured from
 * `created_at` to `first_response_at`. Ticks every second until answered, then freezes.
 * `variant="ring"` is the inbox card's leading SLA ring (DESIGN.md §7 brief 4): a
 * progress ring that fills toward the 15-minute mark with the wait inside.
 */
export function SlaTimer({
  createdAt,
  respondedAt,
  size = "md",
  variant = "pill",
  className,
}: {
  createdAt: string;
  respondedAt: string | null;
  size?: "sm" | "md";
  variant?: "pill" | "ring";
  className?: string;
}) {
  const start = Date.parse(createdAt);
  const end = respondedAt ? Date.parse(respondedAt) : null;
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (end) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [end]);
  const elapsed = (end ?? now ?? start) - start;
  const tone = slaTone(elapsed / 60_000);
  const label = end ? `Answered in ${fmt(elapsed)}` : now ? fmt(elapsed) : "…";

  if (variant === "ring") {
    const D = size === "sm" ? 40 : 48;
    const W = 4;
    const r = (D - W) / 2;
    const C = 2 * Math.PI * r;
    const known = end != null || now != null;
    const v = known ? Math.min(1, elapsed / RING_MS) : 0;
    return (
      <span
        role="timer"
        aria-live="off"
        aria-label={end ? label : `Waiting ${label}`}
        className={cx("relative inline-flex shrink-0", className)}
        style={{ ...toneStyle(tone), width: D, height: D }}
      >
        {/* biome-ignore lint/a11y/noSvgWithoutTitle: decorative; the timer span is labelled */}
        <svg
          aria-hidden
          width={D}
          height={D}
          viewBox={`0 0 ${D} ${D}`}
          className="-rotate-90"
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
          />
        </svg>
        <span
          aria-hidden
          className={cx(
            "tint-fg absolute inset-0 flex items-center justify-center font-semibold tabular-nums tracking-tight",
            size === "sm" ? "text-[11px]" : "text-[12px]",
          )}
        >
          {known ? fmtShort(elapsed) : "…"}
        </span>
      </span>
    );
  }

  return (
    <span
      role="timer"
      aria-live="off"
      aria-label={end ? label : `Waiting ${label}`}
      className={cx(
        "tint-bg tint-fg inline-flex shrink-0 items-center gap-1 rounded-pill font-semibold tabular-nums",
        size === "sm" ? "h-5 px-2 text-caption" : "h-7 px-2.5 text-footnote",
        className,
      )}
      style={toneStyle(tone)}
    >
      <Timer size={size === "sm" ? 12 : 14} aria-hidden />
      {label}
    </span>
  );
}
