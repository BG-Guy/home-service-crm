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

/**
 * Speed-to-lead timer (SPEC M04): green < 5 min, amber < 15, red beyond, measured from
 * `created_at` to `first_response_at`. Ticks every second until answered, then freezes.
 */
export function SlaTimer({
  createdAt,
  respondedAt,
  size = "md",
  className,
}: {
  createdAt: string;
  respondedAt: string | null;
  size?: "sm" | "md";
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
