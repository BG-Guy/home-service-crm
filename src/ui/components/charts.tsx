import type { CSSProperties, ReactNode } from "react";
import { formatMoney } from "@/lib/money";
import { cx } from "../cx";
import { TONE_VAR, type Tone } from "../tone";

/*
 * Hand-rolled charts (SPEC §12.6, §14: no chart library). Server Components:
 * zero client JS. Shapes are SVG (lines use non-scaling strokes so they stay
 * 2 px at any width) or plain HTML boxes (bars), text is HTML so it never
 * distorts. Every chart has an accessible name, native `title` tooltips and a
 * screen-reader data table. Colors come from tokens and follow dark mode.
 *
 * Categorical order is fixed (validated for CVD separation): blue, orange,
 * indigo, teal, purple. Green/red/orange-as-status stay reserved for state.
 */

export const SERIES_TONES: readonly Tone[] = [
  "blue",
  "orange",
  "indigo",
  "teal",
  "purple",
];

export type ValueFormat =
  | "number"
  | "money"
  | "percent"
  | ((n: number) => string);

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Format a value. `money` expects cents; `percent` expects a fraction (0.25 → 25%). */
export function formatValue(
  n: number,
  f: ValueFormat = "number",
  short = false,
): string {
  if (typeof f === "function") return f(n);
  if (f === "money") {
    if (short && Math.abs(n) >= 100000) return `$${compact.format(n / 100)}`;
    return formatMoney(n, { compactWhole: true });
  }
  if (f === "percent") return `${nf.format(n * 100)}%`;
  return short ? compact.format(n) : nf.format(n);
}

const toneColor = (t: Tone | undefined, i: number) =>
  TONE_VAR[t ?? SERIES_TONES[i % SERIES_TONES.length] ?? "blue"];

/** "Nice" axis maximum: 1, 2, 2.5, 5 × 10ⁿ ≥ max. */
function niceMaxRaw(max: number): number {
  if (max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= max) return m * p;
  return 10 * p;
}

/**
 * Axis maximum with a floor per format, so an all-zero (or tiny) series reads
 * "$1 · $0.50 · $0" instead of "$0.01 · $0.01 · $0" (QA T4-18), and counts get
 * whole-number ticks.
 */
export function niceMax(max: number, format: ValueFormat = "number"): number {
  const m = niceMaxRaw(max);
  if (format === "money") return Math.max(m, 100);
  if (format === "number") return Math.max(m, 2);
  return m;
}

function DataTable({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: string[][];
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static table rows
          <tr key={i}>
            {r.map((c, j) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static table cells
              <td key={j}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Legend({
  items,
}: {
  items: { label: string; color: string; value?: string }[];
}) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-footnote text-label-2">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2.5 rounded-full"
            style={{ background: it.color }}
          />
          <span>{it.label}</span>
          {it.value && <span className="num text-label">{it.value}</span>}
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Sparkline                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Tiny trend line for StatCards and rows. Stretches to its container width.
 * @param label accessible description, e.g. "Revenue, last 30 days".
 */
export function Sparkline({
  values,
  tone = "accent",
  height = 28,
  area = true,
  label,
  className,
}: {
  values: readonly number[];
  tone?: Tone;
  height?: number;
  area?: boolean;
  label: string;
  className?: string;
}) {
  const W = 100;
  const H = height;
  const pts = values.length > 1 ? values : [values[0] ?? 0, values[0] ?? 0];
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const xy = pts.map((v, i) => [
    (i / (pts.length - 1)) * W,
    H - 2 - ((v - min) / span) * (H - 4),
  ]);
  const d = xy.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join("");
  const color = TONE_VAR[tone];
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={cx("block w-full overflow-visible", className)}
      style={{ height }}
    >
      <title>{label}</title>
      {area && (
        <path d={`${d}L${W},${H}L0,${H}Z`} fill={color} opacity={0.14} />
      )}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* BarChart                                                                   */
/* -------------------------------------------------------------------------- */

export interface BarDatum {
  label: string;
  value: number;
  /** Override color (e.g. highlight the current period). */
  tone?: Tone;
}

/**
 * Bar chart. `vertical` (columns, e.g. revenue by week) or `horizontal`
 * (ranked rows with values, best on phones: leaderboards, sources).
 * Bars are single-hue by default — color only when it encodes something.
 */
export function BarChart({
  data,
  title,
  format = "number",
  orientation = "vertical",
  tone = "blue",
  height = 160,
  className,
}: {
  data: readonly BarDatum[];
  /** Accessible name + table caption. */
  title: string;
  format?: ValueFormat;
  orientation?: "vertical" | "horizontal";
  tone?: Tone;
  height?: number;
  className?: string;
}) {
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)), format);
  const table = (
    <DataTable
      caption={title}
      head={["Label", "Value"]}
      rows={data.map((d) => [d.label, formatValue(d.value, format)])}
    />
  );

  if (orientation === "horizontal") {
    const top = Math.max(0, ...data.map((d) => d.value)) || 1;
    return (
      <figure className={cx("m-0", className)}>
        <div role="img" aria-label={title} className="flex flex-col gap-2.5">
          {data.map((d) => (
            <div
              key={d.label}
              title={`${d.label}: ${formatValue(d.value, format)}`}
              className="grid grid-cols-[minmax(0,7.5rem)_1fr_auto] items-center gap-3"
            >
              <span className="truncate text-footnote text-label-2">
                {d.label}
              </span>
              <span className="h-2.5 overflow-hidden rounded-full bg-fill">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${Math.max(0, (d.value / top) * 100)}%`,
                    background: TONE_VAR[d.tone ?? tone],
                  }}
                />
              </span>
              <span className="num text-footnote font-medium">
                {formatValue(d.value, format, true)}
              </span>
            </div>
          ))}
        </div>
        {table}
      </figure>
    );
  }

  const ticks = [max, max / 2, 0];
  return (
    <figure className={cx("m-0", className)}>
      <div
        role="img"
        aria-label={title}
        className="grid grid-cols-[auto_1fr] gap-x-2"
      >
        <div
          aria-hidden
          className="num flex flex-col justify-between text-right text-caption text-label-2"
          style={{ height }}
        >
          {ticks.map((t) => (
            <span key={t} className="-my-2 leading-4">
              {formatValue(t, format, true)}
            </span>
          ))}
        </div>
        <div className="relative" style={{ height }}>
          {ticks.map((t, i) => (
            <span
              key={t}
              aria-hidden
              className="absolute inset-x-0 h-px bg-sep opacity-50"
              style={{ top: `${(i / (ticks.length - 1)) * 100}%` }}
            />
          ))}
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {data.map((d) => (
              <div
                key={d.label}
                title={`${d.label}: ${formatValue(d.value, format)}`}
                className="flex h-full min-w-0 flex-1 items-end justify-center"
              >
                <span
                  className="block w-full max-w-7 rounded-t-md"
                  style={{
                    height: `${Math.max(0, (d.value / max) * 100)}%`,
                    minHeight: d.value > 0 ? 2 : 0,
                    background: TONE_VAR[d.tone ?? tone],
                  }}
                />
              </div>
            ))}
          </div>
        </div>
        <span />
        <div aria-hidden className="mt-1.5 flex gap-[2px]">
          {data.map((d, i) => (
            <span
              key={d.label}
              className="min-w-0 flex-1 truncate text-center text-caption text-label-2"
            >
              {/* Thin out labels when crowded */}
              {data.length <= 8 || i % Math.ceil(data.length / 6) === 0
                ? d.label
                : ""}
            </span>
          ))}
        </div>
      </div>
      {table}
    </figure>
  );
}

/* -------------------------------------------------------------------------- */
/* LineChart                                                                  */
/* -------------------------------------------------------------------------- */

export interface LineSeries {
  name: string;
  values: readonly (number | null)[];
  tone?: Tone;
}

/**
 * Line chart over a shared x axis (`labels`). One y axis only (never dual).
 * Hovering a column shows all series values via a native tooltip; ≥ 2 series
 * get a legend.
 */
export function LineChart({
  series,
  labels,
  title,
  format = "number",
  height = 180,
  area,
  className,
}: {
  series: readonly LineSeries[];
  labels: readonly string[];
  title: string;
  format?: ValueFormat;
  height?: number;
  /** Fill under a single series. */
  area?: boolean;
  className?: string;
}) {
  const n = labels.length;
  const all = series.flatMap((s) =>
    s.values.filter((v): v is number => v != null),
  );
  const max = niceMax(Math.max(0, ...all), format);
  const W = 100;
  const H = 100;
  const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => H - (v / max) * H;
  const path = (vals: readonly (number | null)[]) => {
    let d = "";
    let pen = false;
    vals.forEach((v, i) => {
      if (v == null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i)},${y(v)}`;
      pen = true;
    });
    return d;
  };
  const ticks = [max, max / 2, 0];
  const xIdx = n <= 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];
  const tip = (i: number) =>
    `${labels[i]}: ${series
      .map((s) =>
        s.values[i] == null
          ? `${s.name} —`
          : `${s.name} ${formatValue(s.values[i] as number, format)}`,
      )
      .join(" · ")}`;

  return (
    <figure className={cx("m-0 flex flex-col gap-2", className)}>
      {series.length > 1 && (
        <Legend
          items={series.map((s, i) => ({
            label: s.name,
            color: toneColor(s.tone, i),
          }))}
        />
      )}
      <div
        role="img"
        aria-label={title}
        className="grid grid-cols-[auto_1fr] gap-x-2"
      >
        <div
          aria-hidden
          className="num flex flex-col justify-between text-right text-caption text-label-2"
          style={{ height }}
        >
          {ticks.map((t) => (
            <span key={t} className="-my-2 leading-4">
              {formatValue(t, format, true)}
            </span>
          ))}
        </div>
        <div className="relative" style={{ height }}>
          {ticks.map((t, i) => (
            <span
              key={t}
              aria-hidden
              className="absolute inset-x-0 h-px bg-sep opacity-50"
              style={{ top: `${(i / (ticks.length - 1)) * 100}%` }}
            />
          ))}
          {/* biome-ignore lint/a11y/noSvgWithoutTitle: decorative; the wrapper has role=img + label and a data table */}
          <svg
            aria-hidden
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="absolute inset-0 size-full overflow-visible"
          >
            {series.map((s, i) => {
              const d = path(s.values);
              const color = toneColor(s.tone, i);
              return (
                <g key={s.name}>
                  {area && series.length === 1 && d && (
                    <path
                      d={`${d}L${x(n - 1)},${H}L${x(0)},${H}Z`}
                      fill={color}
                      opacity={0.12}
                    />
                  )}
                  <path
                    d={d}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              );
            })}
          </svg>
          {/* Hover columns: native tooltips with every series' value */}
          <div className="absolute inset-0 flex">
            {labels.map((l, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: x labels may repeat
                key={`${l}-${i}`}
                title={tip(i)}
                className="h-full flex-1 hover:bg-fill-2"
              />
            ))}
          </div>
        </div>
        <span />
        <div
          aria-hidden
          className="relative mt-1.5 h-4 text-caption text-label-2"
        >
          {xIdx.map((i) => (
            <span
              key={i}
              className="absolute whitespace-nowrap"
              style={
                {
                  left: `${n <= 1 ? 50 : (i / (n - 1)) * 100}%`,
                  translate:
                    i === 0 ? "0 0" : i === n - 1 ? "-100% 0" : "-50% 0",
                } as CSSProperties
              }
            >
              {labels[i]}
            </span>
          ))}
        </div>
      </div>
      <DataTable
        caption={title}
        head={["", ...series.map((s) => s.name)]}
        rows={labels.map((l, i) => [
          l,
          ...series.map((s) =>
            s.values[i] == null
              ? "—"
              : formatValue(s.values[i] as number, format),
          ),
        ])}
      />
    </figure>
  );
}

/* -------------------------------------------------------------------------- */
/* DonutChart                                                                 */
/* -------------------------------------------------------------------------- */

export interface DonutSegment {
  label: string;
  value: number;
  tone?: Tone;
}

/**
 * Donut for part-to-whole with ≤ 5 parts (fold the rest into "Other").
 * Segments are separated by a 2 px gap; the legend carries values and shares.
 */
export function DonutChart({
  segments,
  title,
  format = "number",
  size = 140,
  thickness = 18,
  center,
  legend = true,
  className,
}: {
  segments: readonly DonutSegment[];
  title: string;
  format?: ValueFormat;
  size?: number;
  thickness?: number;
  /** Center content (defaults to the formatted total). */
  center?: ReactNode;
  legend?: boolean;
  className?: string;
}) {
  const total = segments.reduce((a, s) => a + Math.max(0, s.value), 0);
  const r = (size - thickness) / 2;
  const C = 2 * Math.PI * r;
  const gap = segments.length > 1 ? 2 : 0;
  let acc = 0;
  const pct = (v: number) =>
    total ? `${Math.round((v / total) * 100)}%` : "0%";
  return (
    <figure
      className={cx(
        "m-0 flex flex-wrap items-center gap-x-6 gap-y-4",
        className,
      )}
    >
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg
          role="img"
          aria-label={title}
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="-rotate-90"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--fill-2)"
            strokeWidth={thickness}
          />
          {total > 0 &&
            segments.map((s, i) => {
              const len = (Math.max(0, s.value) / total) * C;
              const dash = Math.max(0, len - gap);
              const el = (
                <circle
                  key={s.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={toneColor(s.tone, i)}
                  strokeWidth={thickness}
                  strokeDasharray={`${dash} ${C - dash}`}
                  strokeDashoffset={-acc}
                >
                  <title>{`${s.label}: ${formatValue(s.value, format)} (${pct(s.value)})`}</title>
                </circle>
              );
              acc += len;
              return el;
            })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          {center ?? (
            <>
              <span className="num text-headline">
                {formatValue(total, format, true)}
              </span>
              <span className="text-caption text-label-2">Total</span>
            </>
          )}
        </div>
      </div>
      {legend && (
        <ul className="flex min-w-0 flex-1 flex-col gap-1.5 text-footnote">
          {segments.map((s, i) => (
            <li key={s.label} className="flex items-center gap-2">
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: toneColor(s.tone, i) }}
              />
              <span className="min-w-0 flex-1 truncate text-label-2">
                {s.label}
              </span>
              <span className="num font-medium">
                {formatValue(s.value, format, true)}
              </span>
              <span className="num w-10 text-right text-label-2">
                {pct(s.value)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <DataTable
        caption={title}
        head={["Segment", "Value", "Share"]}
        rows={segments.map((s) => [
          s.label,
          formatValue(s.value, format),
          pct(s.value),
        ])}
      />
    </figure>
  );
}

/* -------------------------------------------------------------------------- */
/* ProgressRing                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Circular progress (0–1). Center shows `children` or the percentage.
 * @param label accessible name, e.g. "Checklist 3 of 5 done".
 */
export function ProgressRing({
  value,
  label,
  size = 44,
  stroke = 5,
  tone = "accent",
  children,
  showValue = true,
  className,
}: {
  value: number;
  label: string;
  size?: number;
  stroke?: number;
  tone?: Tone;
  children?: ReactNode;
  showValue?: boolean;
  className?: string;
}) {
  const v = Math.min(1, Math.max(0, value));
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      className={cx("relative inline-flex shrink-0", className)}
      style={{ width: size, height: size }}
    >
      {/* biome-ignore lint/a11y/noSvgWithoutTitle: decorative; the progressbar wrapper is labelled */}
      <svg
        aria-hidden
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--fill)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={TONE_VAR[tone]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${v * C} ${C}`}
          opacity={v === 0 ? 0 : 1}
        />
      </svg>
      {(children != null || showValue) && (
        <span
          aria-hidden
          className="num absolute inset-0 flex items-center justify-center font-semibold"
          style={{ fontSize: Math.max(10, Math.round(size * 0.28)) }}
        >
          {children ?? Math.round(v * 100)}
        </span>
      )}
    </span>
  );
}
