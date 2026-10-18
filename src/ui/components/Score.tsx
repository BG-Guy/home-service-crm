import { Check, Minus, X } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../cx";
import { STATUS } from "../status";
import { type Tone, toneStyle } from "../tone";
import { ProgressRing } from "./charts";

/** Readiness band color (SPEC §11.2): red < 50, amber 50–79, green ≥ 80. */
export function readinessTone(score: number): Tone {
  return score >= 80 ? "green" : score >= 50 ? "orange" : "red";
}

/**
 * Readiness ring (post-job evidence score, 0–100). Presentational: pass the
 * stored `jobs.readiness_score`. Put it inside a button/link to open the
 * "why" sheet (render `<ScoreBreakdown>` in a `<Sheet>`).
 */
export function ReadinessRing({
  score,
  size = 36,
  className,
}: {
  score: number | null | undefined;
  size?: number;
  className?: string;
}) {
  if (score == null) {
    return (
      <ProgressRing
        value={0}
        size={size}
        stroke={Math.max(3, Math.round(size / 9))}
        label="Readiness not computed"
        className={className}
      >
        –
      </ProgressRing>
    );
  }
  const s = Math.round(Math.min(100, Math.max(0, score)));
  return (
    <ProgressRing
      value={s / 100}
      size={size}
      stroke={Math.max(3, Math.round(size / 9))}
      tone={readinessTone(s)}
      label={`Readiness ${s} of 100`}
      className={className}
    >
      {s}
    </ProgressRing>
  );
}

/**
 * Risk band chip (pre-job risk, SPEC §11.1). Low/Medium/High/Critical with
 * a shield glyph count so it reads without color.
 */
export function RiskChip({
  band,
  score,
  size = "md",
  className,
}: {
  band: "low" | "medium" | "high" | "critical";
  score?: number | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const def = STATUS.risk[band];
  const bars = { low: 1, medium: 2, high: 3, critical: 4 }[band];
  return (
    <span
      className={cx(
        "tint-bg tint-fg inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill font-semibold",
        size === "sm" ? "h-5 px-2 text-caption" : "h-6 px-2.5 text-footnote",
        className,
      )}
      style={toneStyle(def.tone)}
    >
      <span aria-hidden className="flex items-end gap-px">
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="w-[3px] rounded-[1px]"
            style={{
              height: 3 + i * 2,
              background: "currentColor",
              opacity: i <= bars ? 1 : 0.25,
            }}
          />
        ))}
      </span>
      {def.label}
      {score != null && <span className="num opacity-75">{score}</span>}
    </span>
  );
}

export interface ScoreItem {
  label: ReactNode;
  /** Points earned / weight (readiness) or points added (risk signals). */
  points: number;
  weight?: number;
  /** `met` (earned), `missing`, or `na` (not applicable → full credit). */
  state: "met" | "missing" | "na";
  hint?: ReactNode;
}

/**
 * The "why" list for a readiness ring or risk chip: each item with a ✓ / ✕ / –
 * glyph, label, hint and points. Render inside a `<Sheet>` or card.
 */
export function ScoreBreakdown({
  items,
  className,
}: {
  items: readonly ScoreItem[];
  className?: string;
}) {
  return (
    <ul className={cx("list-card", className)}>
      {items.map((it, i) => {
        const tone: Tone =
          it.state === "met"
            ? "green"
            : it.state === "missing"
              ? "red"
              : "gray";
        const Icon =
          it.state === "met" ? Check : it.state === "missing" ? X : Minus;
        return (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: static breakdown
            key={i}
            className="list-row flex min-h-11 items-center gap-3 px-4 py-2.5"
          >
            <span
              className="tint-bg tint-fg flex size-6 shrink-0 items-center justify-center rounded-full"
              style={toneStyle(tone)}
            >
              <Icon
                size={14}
                strokeWidth={3}
                aria-label={
                  it.state === "met"
                    ? "Met"
                    : it.state === "missing"
                      ? "Missing"
                      : "Not applicable"
                }
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body">{it.label}</span>
              {it.hint && (
                <span className="block text-footnote text-label-2">
                  {it.hint}
                </span>
              )}
            </span>
            <span className="num shrink-0 text-subhead text-label-2">
              {it.weight != null
                ? `${it.points}/${it.weight}`
                : it.points > 0
                  ? `+${it.points}`
                  : it.points}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
