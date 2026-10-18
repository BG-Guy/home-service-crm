// Money helpers (docs/SPEC.md §6.1). All money is integer cents; rates are basis points
// (2500 = 25.00%); quantities have up to 3 decimals. Rounding is half away from zero.
// Isomorphic: no server-only imports, safe for client components.

export type Cents = number;
export type Bps = number;

/** Throws unless `n` is a safe integer (use at module boundaries, e.g. after parsing). */
export function assertCents(n: number, label = "amount"): asserts n is Cents {
  if (!Number.isSafeInteger(n)) {
    throw new TypeError(`${label} must be integer cents, got ${n}`);
  }
}

/**
 * Round half away from zero: 0.5 → 1, -0.5 → -1, 2.4999 → 2.
 * A tiny relative epsilon absorbs binary floating noise (e.g. 1.005 * 100 =
 * 100.49999999999999 → 101). Prefer the exact integer helpers below when inputs
 * are already scaled integers.
 */
export function roundHalfAway(x: number): number {
  if (!Number.isFinite(x)) throw new RangeError(`cannot round ${x}`);
  const a = Math.abs(x);
  // nudge by a relative epsilon so 2.5 stored as 2.4999999999999996 still rounds up
  const r = Math.floor(a + 0.5 + a * Number.EPSILON * 4);
  return x < 0 ? -r : r;
}

/** Exact integer division with half-away-from-zero rounding (num, den are integers). */
export function divRoundHalfAway(num: number, den: number): number {
  if (den === 0) throw new RangeError("division by zero");
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den)) {
    return roundHalfAway(num / den);
  }
  const sign = Math.sign(num) * Math.sign(den);
  const n = Math.abs(num);
  const d = Math.abs(den);
  const q = Math.floor(n / d);
  const r = n - q * d;
  const res = 2 * r >= d ? q + 1 : q;
  return sign < 0 ? -res : res;
}

/** cents × bps / 10000, rounded half away from zero. `applyBps(10_000, 2500) === 2500`. */
export function applyBps(cents: Cents, bps: Bps): Cents {
  return divRoundHalfAway(cents * bps, 10_000);
}

/** Percent (e.g. 8.25) → bps (825). */
export function percentToBps(percent: number): Bps {
  return roundHalfAway(percent * 100);
}

/** bps (825) → percent number (8.25). */
export function bpsToPercent(bps: Bps): number {
  return bps / 100;
}

/** Display a rate: 2500 → "25%", 825 → "8.25%". */
export function formatBps(bps: Bps, locale = "en-US"): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(bps / 10_000);
}

/** Quantity (≤ 3 decimals) → integer thousandths. */
export function qtyToMilli(qty: number): number {
  return roundHalfAway(qty * 1000);
}

/**
 * Line total = round(qty × unit_price) − discount, computed in integer thousandths
 * so 1.5 × 333 = 499.5 → 500 exactly.
 */
export function lineTotalCents(
  qty: number,
  unitPriceCents: Cents,
  discountCents: Cents = 0,
): Cents {
  return (
    divRoundHalfAway(qtyToMilli(qty) * unitPriceCents, 1000) - discountCents
  );
}

/** Tax on a taxable base at `rateBps`, rounded half away from zero. */
export function taxCents(taxableCents: Cents, rateBps: Bps): Cents {
  return applyBps(taxableCents, rateBps);
}

export function sumCents(values: Iterable<Cents | null | undefined>): Cents {
  let total = 0;
  for (const v of values) total += v ?? 0;
  return total;
}

/**
 * Split `total` across `weights` (e.g. split_bps) so parts are integers that sum
 * exactly to `total` (largest-remainder method; ties go to earlier entries).
 */
export function allocateCents(
  total: Cents,
  weights: readonly number[],
): Cents[] {
  if (weights.length === 0) return [];
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0) throw new RangeError("weights must sum to > 0");
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const raw = weights.map((w) => (abs * w) / weightSum);
  const parts = raw.map((r) => Math.floor(r));
  let remainder = abs - parts.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    parts[i] = (parts[i] ?? 0) + 1;
    remainder--;
  }
  return parts.map((p) => p * sign);
}

/** Dollars (number) → cents, half away from zero. */
export function dollarsToCents(dollars: number): Cents {
  return roundHalfAway(dollars * 100);
}

/** Cents → dollars number (for display math only; never store). */
export function centsToDollars(cents: Cents): number {
  return cents / 100;
}

/**
 * Parse user input like "$1,234.5", "-12", "(3.10)", "12.345" → cents.
 * Returns null when the input isn't a money amount. Extra decimals round half away,
 * unless `strict` (typed amounts: "12.345" is a typo, not $12.35 → null).
 */
export function parseMoneyToCents(
  input: string | null | undefined,
  opts: { strict?: boolean } = {},
): Cents | null {
  if (input == null) return null;
  let s = String(input).trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[\s$€£,]/g, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
  const [whole = "0", frac = ""] = s.split(".");
  if (opts.strict && frac.length > 2) return null;
  const cents2 = `${frac}00`.slice(0, 2);
  const rest = frac.slice(2);
  let cents = Number(whole || "0") * 100 + Number(cents2);
  if (rest && Number(rest[0]) >= 5) cents += 1;
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

const fmtCache = new Map<string, Intl.NumberFormat>();

function moneyFormatter(
  currency: string,
  locale: string,
  opts: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  const key = `${locale}|${currency}|${JSON.stringify(opts)}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, { style: "currency", currency, ...opts });
    fmtCache.set(key, f);
  }
  return f;
}

export interface FormatMoneyOptions {
  currency?: string;
  locale?: string;
  /** Drop ".00" on whole amounts ($25 instead of $25.00). */
  compactWhole?: boolean;
  /** Always show a sign (+$5.00 / -$5.00). */
  signed?: boolean;
}

/** Intl currency formatting: 123456 → "$1,234.56". */
export function formatMoney(
  cents: Cents | null | undefined,
  {
    currency = "USD",
    locale = "en-US",
    compactWhole = false,
    signed = false,
  }: FormatMoneyOptions = {},
): string {
  const value = (cents ?? 0) / 100;
  const whole = compactWhole && (cents ?? 0) % 100 === 0;
  return moneyFormatter(currency, locale, {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
    signDisplay: signed ? "exceptZero" : "auto",
  }).format(value);
}
