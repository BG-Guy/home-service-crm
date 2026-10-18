import "server-only";
import { parseAddressLine } from "@/features/customers/normalize";
import { parseMoneyToCents } from "@/lib/money";
import { normalizePhone, normalizePhoneLenient } from "@/lib/phone";
import { dateKey } from "@/lib/time";

// Lead payload normalizer (SPEC M04 "Tolerant schema with aliases", §8.3 step 4).
// Pure apart from libphonenumber (server-only). Golden-tested in tests/golden/leads*.

export type FlatPayload = Record<string, unknown>;

export interface NormalizedLead {
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null; // E.164
  phoneRaw: string | null;
  phoneIsUs: boolean;
  email: string | null;
  address: {
    street: string;
    unit: string | null;
    city: string;
    state: string;
    zip: string;
  } | null;
  addressText: string | null;
  service: string | null;
  priceCents: number | null;
  preferredDate: string | null; // YYYY-MM-DD (company TZ)
  preferredWindow: string | null;
  notes: string | null;
  externalId: string | null;
  smsConsent: boolean;
  marketingConsent: boolean;
  consentText: string | null;
  redirect: string | null;
  attribution: Record<string, unknown>;
  honeypot: string | null;
  ts: string | null;
  turnstileToken: string | null;
  isTest: boolean;
  sourceHint: string | null;
  extra: Record<string, unknown>;
}

export interface NormalizeResult {
  lead: NormalizedLead;
  /** Field-level format errors (the JSON API answers 400; forms/hooks keep the lead). */
  errors: Record<string, string[]>;
  warnings: string[];
}

/** Canonical field → accepted aliases (first match wins). */
export const FIELD_ALIASES = {
  name: [
    "name",
    "full_name",
    "fullname",
    "your-name",
    "your_name",
    "contact_name",
    "customer_name",
  ],
  first_name: ["first_name", "firstname", "fname", "given_name"],
  last_name: ["last_name", "lastname", "lname", "family_name", "surname"],
  phone: [
    "phone",
    "tel",
    "phone_number",
    "phonenumber",
    "mobile",
    "telephone",
    "your-phone",
    "cell",
  ],
  email: ["email", "email_address", "your-email", "e-mail", "mail"],
  address: ["address", "full_address", "service_address", "address_line"],
  street: [
    "street",
    "address1",
    "address_1",
    "street_address",
    "address_line1",
  ],
  unit: ["unit", "address2", "address_2", "apt", "suite"],
  city: ["city", "town", "locality"],
  state: ["state", "region", "province", "state_province"],
  zip: ["zip", "zipcode", "zip_code", "postal_code", "postcode", "postal"],
  service: [
    "service_type",
    "service",
    "job_type",
    "service_needed",
    "category",
  ],
  price: ["price", "budget", "quoted_price", "quote"],
  date: ["preferred_date", "date", "appointment_date"],
  window: ["preferred_window", "preferred_time", "time_window"],
  notes: [
    "notes",
    "message",
    "comments",
    "comment",
    "your-message",
    "description",
    "details",
  ],
  external_id: ["external_id", "externalid", "lead_id_external"],
  sms_consent: ["sms_consent", "consent", "sms_opt_in"],
  marketing_consent: ["marketing_consent", "marketing_opt_in"],
  consent_text: ["consent_text"],
  redirect: ["redirect", "_redirect", "redirect_url", "_next"],
  honeypot: ["company_website"],
  ts: ["_ts"],
  turnstile: ["cf-turnstile-response", "turnstile_token"],
  test: ["test", "is_test", "_test"],
  source: ["source", "lead_source", "source_id", "lead_source_id"],
} as const;

export type CanonicalField = keyof typeof FIELD_ALIASES;

/** Attribution keys copied as-is (plus every utm_*). */
export const ATTRIBUTION_KEYS = [
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "msclkid",
  "referrer",
  "landing_url",
  "page_url",
  "first_touch",
  "last_touch",
] as const;

/** Checkbox truthiness: `on`/`true`/`1`/`yes` (any case) and boolean true. */
export function truthy(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === "number") return v === 1;
  if (typeof v !== "string") return false;
  return ["on", "true", "1", "yes", "y", "checked"].includes(
    v.trim().toLowerCase(),
  );
}

function str(v: unknown, max = 2000): string | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return str(v[0], max);
  if (typeof v === "object") return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

/** "$1,200" / "1200" / "1200.50" → cents; null when blank; NaN marker when unparseable. */
export function parsePrice(v: unknown): number | null | "invalid" {
  const s = str(v, 50);
  if (!s) return null;
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v * 100);
  const cents = parseMoneyToCents(
    s.replace(/^usd\s*/i, "").replace(/\s*usd$/i, ""),
  );
  if (cents == null || cents < 0) return "invalid";
  return cents;
}

/**
 * ISO (`2026-10-20`, `2026-10-20T15:00:00Z`) or `MM/DD/YYYY` (also `M/D/YY`) → a
 * calendar date in the company time zone. Instants are converted to that zone.
 */
export function parseLeadDate(
  v: unknown,
  tz: string,
): string | null | "invalid" {
  const s = str(v, 40);
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return validYmd(Number(m[1]), Number(m[2]), Number(m[3]));
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) {
    const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(s);
    if (!hasZone) {
      m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
      return m ? validYmd(Number(m[1]), Number(m[2]), Number(m[3])) : "invalid";
    }
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? "invalid" : dateKey(d, tz);
  }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    return validYmd(y, Number(m[1]), Number(m[2]));
  }
  return "invalid";
}

function validYmd(y: number, mo: number, d: number): string | "invalid" {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  )
    return "invalid";
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Resolve a JSON path like `data.customer.name`, `$.answers[0].value` or `user_column_data[FULL_NAME]`. */
export function getPath(obj: unknown, path: string): unknown {
  const clean = path.trim().replace(/^\$\.?/, "");
  if (!clean) return obj;
  const parts: string[] = [];
  for (const seg of clean.split(".")) {
    const re = /([^[\]]+)|\[([^\]]*)\]/g;
    let mm: RegExpExecArray | null = re.exec(seg);
    while (mm) {
      parts.push((mm[1] ?? mm[2] ?? "").replace(/^["']|["']$/g, ""));
      mm = re.exec(seg);
    }
  }
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) {
      if (/^\d+$/.test(p)) cur = cur[Number(p)];
      else {
        // [KEY] on an array of {column_id|key|name|id, value|string_value} pairs
        const hit = cur.find(
          (x) =>
            x &&
            typeof x === "object" &&
            [x.column_id, x.key, x.name, x.id, x.field].some(
              (k) => String(k ?? "") === p,
            ),
        ) as Record<string, unknown> | undefined;
        cur = hit
          ? (hit.value ?? hit.string_value ?? hit.answer ?? hit)
          : undefined;
      }
    } else if (typeof cur === "object")
      cur = (cur as Record<string, unknown>)[p];
    else return undefined;
  }
  return cur;
}

/** Mapping targets accepted in `lead_sources.mapping` (key = target, value = JSON path). */
export const MAPPING_TARGETS: Record<string, CanonicalField> = {
  name: "name",
  "customer.displayName": "name",
  "customer.name": "name",
  first_name: "first_name",
  "customer.firstName": "first_name",
  last_name: "last_name",
  "customer.lastName": "last_name",
  phone: "phone",
  "customer.phone": "phone",
  email: "email",
  "customer.email": "email",
  address: "address",
  street: "street",
  unit: "unit",
  city: "city",
  state: "state",
  zip: "zip",
  service: "service",
  service_type: "service",
  price: "price",
  quoted_price: "price",
  preferred_date: "date",
  date: "date",
  preferred_window: "window",
  notes: "notes",
  external_id: "external_id",
  sms_consent: "sms_consent",
  marketing_consent: "marketing_consent",
};

/**
 * Apply a source mapping: each `target → path` pair copies the value at `path` in the
 * raw payload onto the canonical field (overriding aliases). Returns the merged flat
 * payload plus the list of targets that resolved to nothing.
 */
export function applyMapping(
  flat: FlatPayload,
  raw: unknown,
  mapping: Record<string, string> | null | undefined,
): { payload: FlatPayload; missing: string[] } {
  if (!mapping || Object.keys(mapping).length === 0)
    return { payload: flat, missing: [] };
  const out: FlatPayload = { ...flat };
  const missing: string[] = [];
  for (const [target, path] of Object.entries(mapping)) {
    const field = MAPPING_TARGETS[target] ?? (target as CanonicalField);
    const v = getPath(raw, path);
    if (v === undefined || v === null || v === "") {
      missing.push(target);
      continue;
    }
    out[`__map_${field}`] = v;
  }
  return { payload: out, missing };
}

function pick(
  p: FlatPayload,
  field: CanonicalField,
  used: Set<string>,
): unknown {
  const mapped = p[`__map_${field}`];
  if (mapped !== undefined) {
    used.add(`__map_${field}`);
    return mapped;
  }
  const lower = new Map(Object.keys(p).map((k) => [k.toLowerCase(), k]));
  for (const alias of FIELD_ALIASES[field]) {
    const key = lower.get(alias);
    if (key === undefined || p[key] === undefined) continue;
    // Known-but-empty fields (e.g. the blank honeypot) never land in `extra` (T2-22).
    used.add(key);
    if (p[key] !== "") return p[key];
  }
  return undefined;
}

const MAX_EXTRA_KEYS = 50;

/** Map aliases → canonical fields, validate formats and normalize (phone, email, price, date). */
export function normalizeLeadPayload(
  payload: FlatPayload,
  opts: { tz: string },
): NormalizeResult {
  const used = new Set<string>();
  const errors: Record<string, string[]> = {};
  const warnings: string[] = [];
  const get = (f: CanonicalField) => pick(payload, f, used);

  const firstName = str(get("first_name"), 80);
  const lastName = str(get("last_name"), 80);
  let name = str(get("name"), 200);
  if (!name && (firstName || lastName))
    name = [firstName, lastName].filter(Boolean).join(" ");

  const phoneRaw = str(get("phone"), 40);
  let phone: string | null = null;
  let phoneIsUs = true;
  if (phoneRaw) {
    phone = normalizePhone(phoneRaw) ?? normalizePhoneLenient(phoneRaw);
    if (!phone) {
      errors.phone = ["Phone number isn't valid."];
      warnings.push("invalid_phone");
    } else phoneIsUs = phone.startsWith("+1");
  }

  const emailRaw = str(get("email"), 200);
  let email: string | null = null;
  if (emailRaw) {
    const e = emailRaw.toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) email = e;
    else {
      errors.email = ["Email isn't valid."];
      warnings.push("invalid_email");
    }
  }

  const addressText = str(get("address"), 300);
  const street = str(get("street"), 200);
  const unit = str(get("unit"), 40);
  const city = str(get("city"), 80);
  const state = str(get("state"), 40);
  const zip = str(get("zip"), 12);
  let address: NormalizedLead["address"] = null;
  if (street && zip) {
    address = {
      street,
      unit,
      city: city ?? "",
      state: (state ?? "").toUpperCase().slice(0, 2),
      zip: (/\d{5}/.exec(zip)?.[0] ?? zip).slice(0, 10),
    };
  } else if (addressText) {
    const parsed = parseAddressLine(addressText);
    if (parsed)
      address = {
        street: parsed.street,
        unit: parsed.unit ?? unit,
        city: parsed.city || city || "",
        state: (parsed.state || state || "").toUpperCase().slice(0, 2),
        zip: parsed.zip,
      };
    else warnings.push("unparsed_address");
  } else if (zip) {
    warnings.push("zip_only");
  }

  const priceRes = parsePrice(get("price"));
  let priceCents: number | null = null;
  if (priceRes === "invalid") errors.price = ["Price isn't a dollar amount."];
  else priceCents = priceRes;

  const dateRes = parseLeadDate(get("date"), opts.tz);
  let preferredDate: string | null = null;
  if (dateRes === "invalid")
    errors.preferred_date = ["Use YYYY-MM-DD or MM/DD/YYYY."];
  else preferredDate = dateRes;

  const attribution: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    const lk = k.toLowerCase();
    if (
      lk.startsWith("utm_") ||
      (ATTRIBUTION_KEYS as readonly string[]).includes(lk)
    ) {
      used.add(k);
      if (v === null || v === undefined || v === "") continue;
      if (lk === "first_touch" || lk === "last_touch") {
        let obj: unknown = v;
        if (typeof v === "string") {
          try {
            obj = JSON.parse(v);
          } catch {
            obj = null;
          }
        }
        if (obj && typeof obj === "object" && !Array.isArray(obj))
          attribution[lk] = Object.fromEntries(
            Object.entries(obj as Record<string, unknown>)
              .slice(0, 20)
              .map(([a, b]) => [a.slice(0, 40), str(b, 500)]),
          );
      } else attribution[lk] = str(v, 1000);
    }
  }

  const smsRaw = get("sms_consent");
  const mktRaw = get("marketing_consent");
  const service = str(get("service"), 120);
  const preferredWindow = str(get("window"), 60);
  const notes = str(get("notes"), 5000);
  const externalId = str(get("external_id"), 120);
  const consentText = str(get("consent_text"), 1000);
  const redirect = str(get("redirect"), 500);
  const honeypot = str(get("honeypot"), 500);
  const ts = str(get("ts"), 100);
  const turnstileToken = str(get("turnstile"), 4000);
  const isTest = truthy(get("test"));
  const sourceHint = str(get("source"), 120);

  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (used.has(k) || k.startsWith("__map_") || k.startsWith("$ACTION"))
      continue;
    if (Object.keys(extra).length >= MAX_EXTRA_KEYS) break;
    extra[k.slice(0, 60)] = typeof v === "string" ? v.slice(0, 2000) : v;
  }

  return {
    lead: {
      name,
      firstName,
      lastName,
      phone,
      phoneRaw,
      phoneIsUs,
      email,
      address,
      addressText,
      service,
      priceCents,
      preferredDate,
      preferredWindow,
      notes,
      externalId,
      smsConsent: truthy(smsRaw),
      marketingConsent: truthy(mktRaw),
      consentText,
      redirect,
      attribution,
      honeypot,
      ts,
      turnstileToken,
      isTest,
      sourceHint,
      extra,
    },
    errors,
    warnings,
  };
}
