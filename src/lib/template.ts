// Logic-less template renderer (SPEC §7.4) + SMS segment counter (SPEC M12 GSM-7 lint).
// Syntax: {{path}}  {{path|fallback}}  {{path:filter}}  {{path:filter|fallback}}
//   - path: dotted variable name (customer.first_name, eta_minutes …)
//   - fallback: literal text used when the value is missing/empty ('' allowed: {{x|}})
//   - filters (optional; values are normally pre-formatted by buildContext()):
//       money (cents → $1,234.56), money0 ($1,235), date (Tue Oct 14), date_long,
//       time (1:30 PM), upper, lower, first (first word)
// No logic, loops or helpers. Unknown paths render the fallback (or '') and are
// reported in `missing`. Isomorphic: used by the server sender and editor previews.

export type TemplateContext = Record<string, unknown>;

export interface RenderOptions {
  /** HTML-escape substituted values (email bodies). */
  escape?: "html" | "none";
  /** Time zone for date/time filters (default ctx._tz, then America/New_York). */
  timeZone?: string;
}

export interface RenderReport {
  text: string;
  /** Paths that had no value (fallback or '' used). */
  missing: string[];
  /** Every path referenced, in order of first appearance. */
  variables: string[];
}

const TAG =
  /\{\{\s*([A-Za-z_][\w.]*)\s*(?::\s*([a-z_][a-z0-9_]*)\s*)?(?:\|([^}]*))?\}\}/g;

/** Look up a dotted path: flat key first ('customer.first_name'), then nested objects. */
export function lookup(ctx: TemplateContext, path: string): unknown {
  if (Object.hasOwn(ctx, path)) return ctx[path];
  let cur: unknown = ctx;
  for (const seg of path.split(".")) {
    if (
      cur === null ||
      typeof cur !== "object" ||
      !Object.hasOwn(cur as object, seg)
    )
      return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

const ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c] as string);
}

function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(
      /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? `${v}T12:00:00Z` : v,
    );
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function applyFilter(
  value: unknown,
  filter: string,
  tz: string,
): string | undefined {
  switch (filter) {
    case "money":
    case "money0": {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) return undefined;
      const whole = filter === "money0";
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: whole ? 0 : 2,
        maximumFractionDigits: whole ? 0 : 2,
      }).format(n / 100);
    }
    case "date":
    case "date_long":
    case "time": {
      const d = toDate(value);
      if (!d) return undefined;
      const opts: Intl.DateTimeFormatOptions =
        filter === "date"
          ? { weekday: "short", month: "short", day: "numeric" }
          : filter === "date_long"
            ? {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              }
            : { hour: "numeric", minute: "2-digit" };
      return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: tz })
        .format(d)
        .replace(",", filter === "date" ? "" : ",");
    }
    case "upper":
      return String(value).toUpperCase();
    case "lower":
      return String(value).toLowerCase();
    case "first":
      return String(value).trim().split(/\s+/)[0] ?? "";
    default:
      return String(value);
  }
}

function isEmpty(v: unknown): boolean {
  return (
    v === undefined || v === null || (typeof v === "string" && v.trim() === "")
  );
}

/** Render with a report of missing/used variables (editor preview). */
export function renderWithReport(
  template: string,
  ctx: TemplateContext,
  opts: RenderOptions = {},
): RenderReport {
  const missing: string[] = [];
  const variables: string[] = [];
  const tz =
    opts.timeZone ??
    (typeof ctx._tz === "string" ? ctx._tz : "America/New_York");
  const text = template.replace(
    TAG,
    (
      _m,
      path: string,
      filter: string | undefined,
      fallback: string | undefined,
    ) => {
      if (!variables.includes(path)) variables.push(path);
      const raw = lookup(ctx, path);
      let out: string | undefined;
      if (!isEmpty(raw)) {
        out = filter
          ? applyFilter(raw, filter, tz)
          : typeof raw === "object"
            ? undefined
            : String(raw);
      }
      if (out === undefined || out === "") {
        if (!missing.includes(path)) missing.push(path);
        return fallback ?? "";
      }
      return opts.escape === "html" ? escapeHtml(out) : out;
    },
  );
  return { text, missing, variables };
}

/** Render a template (unknown paths → fallback or ''). */
export function render(
  template: string,
  ctx: TemplateContext,
  opts: RenderOptions = {},
): string {
  return renderWithReport(template, ctx, opts).text;
}

/** Every variable path referenced by a template. */
export function extractVariables(template: string): string[] {
  return renderWithReport(template, {}).variables;
}

// ------------------------------------------------------------------ SMS segments

const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXT = "\f^{}\\[~]|€";
const BASIC = new Set(GSM7_BASIC);
const EXT = new Set(GSM7_EXT);

export interface SmsSegmentInfo {
  encoding: "GSM-7" | "UCS-2";
  /** Septets (GSM-7, extension chars count 2) or UTF-16 code units (UCS-2). */
  units: number;
  segments: number;
  /** Capacity per segment for the current encoding/segment count. */
  perSegment: number;
  /** Units left before the next segment is needed. */
  remaining: number;
  /** Characters that forced UCS-2 (deduplicated, in order). */
  nonGsmChars: string[];
}

/** GSM-7 vs UCS-2 segment count (160/153 septets; 70/67 UTF-16 units). */
export function smsSegments(text: string): SmsSegmentInfo {
  const nonGsm: string[] = [];
  let septets = 0;
  for (const ch of text) {
    if (BASIC.has(ch)) septets += 1;
    else if (EXT.has(ch)) septets += 2;
    else if (!nonGsm.includes(ch)) nonGsm.push(ch);
  }
  if (nonGsm.length === 0) {
    const segments =
      septets === 0 ? 0 : septets <= 160 ? 1 : Math.ceil(septets / 153);
    const perSegment = segments <= 1 ? 160 : 153;
    return {
      encoding: "GSM-7",
      units: septets,
      segments,
      perSegment,
      remaining: Math.max(0, Math.max(1, segments) * perSegment - septets),
      nonGsmChars: [],
    };
  }
  const units = text.length; // UTF-16 code units (surrogate pairs count 2)
  const segments = units <= 70 ? 1 : Math.ceil(units / 67);
  const perSegment = segments <= 1 ? 70 : 67;
  return {
    encoding: "UCS-2",
    units,
    segments,
    perSegment,
    remaining: Math.max(0, segments * perSegment - units),
    nonGsmChars: nonGsm,
  };
}

/** Typographic characters that commonly sneak in and their GSM-7 replacements. */
export const GSM_REPLACEMENTS: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "–": "-",
  "—": "-",
  "…": "...",
  " ": " ",
};

/** Replace curly quotes/dashes/ellipsis with GSM-7 equivalents. */
export function toGsmSafe(text: string): string {
  return text.replace(/[‘’“”–—… ]/g, (c) => GSM_REPLACEMENTS[c] ?? c);
}
