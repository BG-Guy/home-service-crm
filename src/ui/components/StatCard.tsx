import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "../cx";
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
 * KPI tile (SPEC §12.6): label, big tabular value, delta with ▲/▼ + sign +
 * color (never color alone), optional sparkline slot and link.
 *
 * ```tsx
 * <StatCard label="Revenue" value={<MoneyText cents={1250000} compactWhole />}
 *   delta={{ value: 0.12, format: "percent", label: "vs last week" }}
 *   chart={<Sparkline values={[…]} label="Revenue trend" />} href="/insights/revenue" />
 * ```
 */
const VALUE_SIZE = {
  lg: "text-title1",
  md: "text-title2",
  sm: "text-title3",
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
  /** Value size: `lg` 28 px (default), `md` 22 px, `sm` 20 px for 3-up rows on phones. */
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
      <div className="flex items-center gap-1.5 text-footnote font-medium text-label-2">
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
          "num mt-1 font-bold tracking-tight [overflow-wrap:anywhere]",
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
    "block min-w-0 rounded-tile bg-card p-4 shadow-card",
    href && "pressable row-press",
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
  const color =
    d.value === 0 || positive == null
      ? "text-label-2"
      : positive
        ? "text-[color-mix(in_oklab,var(--sys-green)_70%,var(--label))]"
        : "text-danger";
  const mag = formatValue(Math.abs(d.value), d.format ?? "percent");
  const sign = up ? "+" : down ? "−" : "";
  const arrow = up ? "▲" : down ? "▼" : "";
  // Inline text, so a long label wraps under the number like a sentence (QA T4-30).
  return (
    <div className="mt-1 text-footnote">
      <span className={cx("num whitespace-nowrap font-semibold", color)}>
        {arrow && (
          <span aria-hidden className="mr-0.5 text-[10px]">
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
