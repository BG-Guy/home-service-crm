import type { ReactNode } from "react";
import { formatValue, type ValueFormat } from "@/ui/components/charts";
import { StatCard, type StatDelta } from "@/ui/components/StatCard";
import { cx } from "@/ui/cx";
import { change, pointChange } from "../math";

// Small presentational helpers shared by the three dashboards (server components).

export const DASH = "—";

export function pct(v: number | null | undefined, digits = 0): string {
  if (v == null) return DASH;
  return `${(v * 100).toFixed(digits)}%`;
}

/** "1 lead", "3 leads" (pass the plural for irregular words). */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function minutes(v: number | null | undefined): string {
  if (v == null) return DASH;
  if (v < 1) return "< 1 min";
  if (v < 90) return `${Math.round(v)} min`;
  return `${(v / 60).toFixed(1)} h`;
}

export function money(cents: number | null | undefined, short = false): string {
  if (cents == null) return DASH;
  return formatValue(cents, "money", short);
}

/** Δ vs the previous period: relative for amounts, percentage points for rates. */
export function delta(
  cur: number | null,
  prev: number | null,
  label: string,
  opts: {
    rate?: boolean;
    goodWhen?: StatDelta["goodWhen"];
    format?: ValueFormat;
  } = {},
): StatDelta | undefined {
  const v = opts.rate ? pointChange(cur, prev) : change(cur, prev);
  if (v == null || !Number.isFinite(v)) return undefined;
  return {
    value: v,
    format: opts.rate
      ? (x: number) => `${(x * 100).toFixed(1)} pts`
      : (opts.format ?? "percent"),
    goodWhen: opts.goodWhen ?? "up",
    label,
  };
}

/** Section heading for dashboard blocks (iOS grouped header style). */
export function Block({
  title,
  trailing,
  children,
  id,
  className,
}: {
  title: string;
  trailing?: ReactNode;
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cx("scroll-mt-24", className)}
      aria-label={title}
    >
      <div className="flex items-baseline justify-between gap-3 px-1 pb-3">
        <h2 className="text-title3 text-label">{title}</h2>
        {trailing && (
          <div className="shrink-0 text-subhead font-semibold">{trailing}</div>
        )}
      </div>
      {children}
    </section>
  );
}

/** Responsive KPI grid: 2 columns on phones, 3–4 on wider screens. */
export function KpiGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

export { StatCard };

/** A plain card wrapper matching the list-card look. */
export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cx("card p-4", className)}>{children}</div>;
}
