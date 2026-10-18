// Custom field value coercion + validation (SPEC M21 Custom fields; BUILD_PLAN §6.8
// validateCustomValues). Pure and client-safe so forms and tests can use it too.
//
// Input values usually come from FormData (`custom.<key>` → strings / string arrays);
// typed values (numbers, booleans, arrays) are accepted as well. Output values are
// stored in the entity's `custom` jsonb:
//   text → string · number → number · money → integer cents · date → 'YYYY-MM-DD'
//   select → one option · multiselect → option[] · boolean → boolean · photo → media id
// Unknown keys are dropped; empty values are omitted (or `false` for booleans).
import type { CustomFieldDef } from "./contracts";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT = 2000;

function isEmpty(v: unknown): boolean {
  return (
    v === undefined ||
    v === null ||
    (typeof v === "string" && v.trim() === "") ||
    (Array.isArray(v) && v.length === 0)
  );
}

function toCents(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  // MoneyField submits integer cents; people type "$1,234.50".
  if (/^-?\d+$/.test(s)) return Number(s);
  const cleaned = s.replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole = "0", frac = ""] = cleaned.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return cleaned.startsWith("-") ? -cents : cents;
}

function toBool(v: unknown): boolean {
  return v === true || v === "on" || v === "true" || v === "1" || v === 1;
}

export interface CoerceResult {
  values: Record<string, unknown>;
  fieldErrors: Record<string, string[]>;
}

/**
 * Coerce and validate `values` against `defs`. Errors are keyed `${prefix}.${key}`
 * (default prefix `custom`, matching the S56 input names).
 */
export function coerceCustomValues(
  defs: readonly CustomFieldDef[],
  values: Record<string, unknown> | null | undefined,
  prefix = "custom",
): CoerceResult {
  const src = values ?? {};
  const out: Record<string, unknown> = {};
  const fieldErrors: Record<string, string[]> = {};
  const fail = (key: string, msg: string) => {
    fieldErrors[`${prefix}.${key}`] = [msg];
  };

  for (const d of defs) {
    const raw = src[d.key];
    if (d.type === "boolean") {
      const b = toBool(raw);
      if (d.required && !b) fail(d.key, `${d.label} is required.`);
      out[d.key] = b;
      continue;
    }
    if (isEmpty(raw)) {
      if (d.required) fail(d.key, `${d.label} is required.`);
      continue;
    }
    switch (d.type) {
      case "text": {
        const s = String(raw).trim();
        if (s.length > MAX_TEXT) fail(d.key, `${d.label} is too long.`);
        else out[d.key] = s;
        break;
      }
      case "number": {
        const n = typeof raw === "number" ? raw : Number(String(raw).trim());
        if (!Number.isFinite(n)) fail(d.key, `${d.label} must be a number.`);
        else out[d.key] = n;
        break;
      }
      case "money": {
        const c = toCents(raw);
        if (c === null) fail(d.key, `${d.label} must be an amount.`);
        else out[d.key] = c;
        break;
      }
      case "date": {
        const s = String(raw).trim();
        if (!DATE.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`)))
          fail(d.key, `${d.label} must be a date.`);
        else out[d.key] = s;
        break;
      }
      case "select": {
        const s = String(Array.isArray(raw) ? raw[0] : raw).trim();
        if (d.options?.length && !d.options.includes(s))
          fail(d.key, `Pick one of the ${d.label} options.`);
        else out[d.key] = s;
        break;
      }
      case "multiselect": {
        const list = (Array.isArray(raw) ? raw : [raw])
          .map((x) => String(x).trim())
          .filter(Boolean);
        const uniq = [...new Set(list)];
        if (d.options?.length && uniq.some((x) => !d.options?.includes(x)))
          fail(d.key, `Pick from the ${d.label} options.`);
        else if (uniq.length === 0 && d.required)
          fail(d.key, `${d.label} is required.`);
        else if (uniq.length) out[d.key] = uniq;
        break;
      }
      case "photo": {
        const s = String(raw).trim();
        if (!UUID.test(s)) fail(d.key, `${d.label} must be a photo.`);
        else out[d.key] = s;
        break;
      }
    }
  }
  return { values: out, fieldErrors };
}

/** Human display of a stored custom value (invoice lines, detail views). */
export function formatCustomValue(def: CustomFieldDef, v: unknown): string {
  if (v === undefined || v === null || v === "") return "";
  switch (def.type) {
    case "boolean":
      return v ? "Yes" : "No";
    case "money":
      return typeof v === "number"
        ? new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
          }).format(v / 100)
        : String(v);
    case "multiselect":
      return Array.isArray(v) ? v.join(", ") : String(v);
    case "date":
      return typeof v === "string" && DATE.test(v)
        ? new Intl.DateTimeFormat("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            timeZone: "UTC",
          }).format(new Date(`${v}T00:00:00Z`))
        : String(v);
    case "photo":
      return "Photo";
    default:
      return String(v);
  }
}

/** Slugify a label into a custom-field key ("Lock brand" → "lock_brand"). */
export function fieldKeyFromLabel(label: string): string {
  return (
    label
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s-]+/g, "_")
      .replace(/^(\d)/, "f_$1")
      .slice(0, 40) || "field"
  );
}
