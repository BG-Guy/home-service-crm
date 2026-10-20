import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "../cx";
import { type Tone, toneStyle } from "../tone";
import { formatValue, type ValueFormat } from "./charts";

export interface StatDelta {
  /** Change vs the previous period: a fraction for `percent` (0.12 = +12%), else absolute. */
  value: number;
  format?: ValueFormat;
  /** Which direction is good (colors only; ▲/▼ + sign always shown). Default `up`. */
  goodWhen?: "up" | "down" | "neutral";
  /** E.g. "vs last week". */
  label?: string;
}

/**
 * KPI tile (DESIGN.md §5): 13/500 label, a big bold tabular value, a delta chip
 * with ▲/▼ + sign + a green/red tint (never color alone), an optional sparkline
 * and link (press + hover lift). Radius 20.
 *
 * ```tsx
 * <StatCard label="Revenue" value={<MoneyText cents={1250000} compactWhole />}
 *   delta={{ value: 0.12, format: "percent", label: "vs last week" }}
 *   chart={<Sparkline values={[…]} label="Revenue trend" />} href="/insights/revenue" />
 * ```
 */
const VALUE_SIZE = {
  lg: "text-title1",
  md: "text-[24px] leading-[30px]",
  sm: "text-title2",
} as const;

export function StatCard({
  label,
  value,
  delta,
  chart,
  icon,
  href,
  footnote,
  size = "lg",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  /** Value size: `lg` 28 px (default), `md` 24 px, `sm` 22 px for 3-up rows on phones. */
  size?: keyof typeof VALUE_SIZE;
  delta?: StatDelta;
  /** Sparkline (or any small chart) under the value. */
  chart?: ReactNode;
  icon?: ReactNode;
  href?: string;
  footnote?: ReactNode;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-footnote font-medium text-label-2 [&_svg]:shrink-0">
        {icon && (
          <span aria-hidden className="flex">
            {icon}
          </span>
        )}
        <span className="truncate">{label}</span>
      </div>
      {/* Never truncated: a cut-off amount ("$6,1…") misleads. Too narrow wraps;
          pick a smaller `size` or fewer columns for dense rows (QA T4-05). */}
      <div
        className={cx(
          "num mt-1.5 font-bold text-label [overflow-wrap:anywhere]",
          VALUE_SIZE[size],
        )}
      >
        {value}
      </div>
      {delta && <Delta d={delta} />}
      {footnote && (
        <div className="mt-1 text-footnote text-label-2">{footnote}</div>
      )}
      {chart && <div className="mt-3">{chart}</div>}
    </>
  );
  const cls = cx(
    "card block min-w-0",
    size === "sm" ? "p-3.5" : "p-4",
    href && "pressable hover-lift",
    className,
  );
  return href ? (
    <Link href={href} transitionTypes={["nav-forward"]} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function Delta({ d }: { d: StatDelta }) {
  const up = d.value > 0;
  const down = d.value < 0;
  const good = d.goodWhen ?? "up";
  const positive = good === "neutral" ? null : good === "up" ? up : down;
  const tone: Tone =
    d.value === 0 || positive == null ? "gray" : positive ? "green" : "red";
  const mag = formatValue(Math.abs(d.value), d.format ?? "percent");
  const sign = up ? "+" : down ? "−" : "";
  const arrow = up ? "▲" : down ? "▼" : "";
  // A tinted chip, then the label as inline text so it wraps like a sentence (QA T4-30).
  return (
    <div className="mt-1.5 text-footnote leading-[22px]">
      <span
        className="num tint-bg tint-fg inline-flex h-[22px] items-center gap-0.5 whitespace-nowrap rounded-pill px-2 align-middle font-semibold"
        style={toneStyle(tone)}
      >
        {arrow && (
          <span aria-hidden className="text-[9px]">
            {arrow}
          </span>
        )}
        <span className="sr-only">
          {up ? "Up " : down ? "Down " : "No change "}
        </span>
        {sign}
        {mag}
      </span>
      {d.label && <span className="text-label-2"> {d.label}</span>}
    </div>
  );
}
