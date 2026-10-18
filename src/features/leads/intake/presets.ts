import "server-only";
import { parseMoneyToCents } from "@/lib/money";
import { type FlatPayload, getPath } from "./normalize";

// Marketplace/automation presets (SPEC M04, §8.1 hooks). Each turns the vendor's
// payload into a flat payload using our canonical aliases, before the source
// mapping and the alias pass run. Unknown vendor fields stay in the flat payload
// and end up in `leads.extra`.

export type LeadPreset =
  | "generic"
  | "zapier"
  | "make"
  | "thumbtack"
  | "angi"
  | "google_ads_leadform";

export interface PresetResult {
  payload: FlatPayload;
  sourceCostCents: number | null;
  /** Google Ads lead form `google_key` (verified against the source's hash). */
  googleKey: string | null;
  /** Hook answer body (Google expects `{}`). */
  isTest: boolean;
}

/** Flatten nested objects ({ data: { name } } → { name }); top-level keys win. */
export function flatten(obj: unknown, depth = 1): FlatPayload {
  const out: FlatPayload = {};
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return out;
  const nested: unknown[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      depth > 0 &&
      k !== "first_touch" &&
      k !== "last_touch"
    )
      nested.push(v);
    else out[k] = v;
  }
  for (const n of nested)
    for (const [k, v] of Object.entries(flatten(n, depth - 1)))
      if (!(k in out)) out[k] = v;
  return out;
}

const cents = (v: unknown): number | null => {
  if (typeof v === "number") return Math.round(v * 100);
  if (typeof v === "string") return parseMoneyToCents(v);
  return null;
};

/** First non-empty string (numbers count: marketplaces send numeric ids). */
const firstStr = (...vals: unknown[]): string | undefined => {
  for (const v of vals) {
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
};

/** Google Ads lead form column ids → our aliases. */
const GOOGLE_COLUMNS: Record<string, string> = {
  FULL_NAME: "name",
  FIRST_NAME: "first_name",
  LAST_NAME: "last_name",
  PHONE_NUMBER: "phone",
  EMAIL: "email",
  POSTAL_CODE: "zip",
  STREET_ADDRESS: "street",
  CITY: "city",
  REGION: "state",
  COUNTRY: "country",
  COMPANY_NAME: "company",
  WORK_EMAIL: "email",
  WORK_PHONE: "phone",
};

export function applyPreset(preset: string, raw: unknown): PresetResult {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  switch (preset as LeadPreset) {
    case "thumbtack": {
      // Thumbtack lead webhook (v2/v4 shapes): customer{}, request{location{}}, leadPrice.
      const p: FlatPayload = {
        external_id: firstStr(
          getPath(body, "leadID") as string,
          getPath(body, "negotiationID") as string,
          getPath(body, "lead.leadID") as string,
          getPath(body, "data.leadID") as string,
        ),
        name: firstStr(
          getPath(body, "customer.name") as string,
          getPath(body, "data.customer.name") as string,
          [
            getPath(body, "customer.firstName"),
            getPath(body, "customer.lastName"),
          ]
            .filter(Boolean)
            .join(" "),
        ),
        phone: firstStr(
          getPath(body, "customer.phone") as string,
          getPath(body, "customer.phoneNumber") as string,
          getPath(body, "data.customer.phone") as string,
        ),
        email: firstStr(getPath(body, "customer.email") as string),
        service: firstStr(
          getPath(body, "request.category") as string,
          getPath(body, "request.categoryName") as string,
          getPath(body, "request.title") as string,
          getPath(body, "category.name") as string,
        ),
        notes: firstStr(
          getPath(body, "request.description") as string,
          getPath(body, "message.text") as string,
        ),
        street: firstStr(getPath(body, "request.location.address1") as string),
        city: firstStr(getPath(body, "request.location.city") as string),
        state: firstStr(getPath(body, "request.location.state") as string),
        zip: firstStr(
          getPath(body, "request.location.zipCode") as string,
          getPath(body, "request.location.zip") as string,
        ),
        preferred_date: firstStr(
          getPath(body, "request.schedule.date") as string,
        ),
      };
      return {
        payload: { ...flatten(body, 0), ...compact(p) },
        sourceCostCents: cents(
          getPath(body, "leadPrice") ?? getPath(body, "price"),
        ),
        googleKey: null,
        isTest: false,
      };
    }
    case "angi": {
      // Angi Leads / HomeAdvisor JSON (and their XML-to-JSON shape).
      const p: FlatPayload = {
        external_id: firstStr(
          getPath(body, "leadOid") as string,
          getPath(body, "srOid") as string,
          getPath(body, "LeadOid") as string,
          String(getPath(body, "leadId") ?? "") || undefined,
        ),
        first_name: firstStr(
          getPath(body, "firstName") as string,
          getPath(body, "FirstName") as string,
        ),
        last_name: firstStr(
          getPath(body, "lastName") as string,
          getPath(body, "LastName") as string,
        ),
        phone: firstStr(
          getPath(body, "primaryPhone") as string,
          getPath(body, "phone") as string,
          getPath(body, "PrimaryPhone") as string,
        ),
        email: firstStr(
          getPath(body, "email") as string,
          getPath(body, "Email") as string,
        ),
        street: firstStr(
          getPath(body, "address") as string,
          getPath(body, "Address") as string,
        ),
        city: firstStr(
          getPath(body, "city") as string,
          getPath(body, "City") as string,
        ),
        state: firstStr(
          getPath(body, "stateProvince") as string,
          getPath(body, "State") as string,
        ),
        zip: firstStr(
          getPath(body, "postalCode") as string,
          getPath(body, "PostalCode") as string,
        ),
        service: firstStr(
          getPath(body, "taskName") as string,
          getPath(body, "TaskName") as string,
        ),
        notes: firstStr(
          getPath(body, "comments") as string,
          getPath(body, "Comments") as string,
        ),
      };
      return {
        payload: { ...flatten(body, 0), ...compact(p) },
        sourceCostCents: cents(
          getPath(body, "fee") ?? getPath(body, "leadFee"),
        ),
        googleKey: null,
        isTest: false,
      };
    }
    case "google_ads_leadform": {
      const p: FlatPayload = {};
      const cols = getPath(body, "user_column_data");
      if (Array.isArray(cols)) {
        for (const c of cols) {
          if (!c || typeof c !== "object") continue;
          const id = String((c as Record<string, unknown>).column_id ?? "");
          const value = (c as Record<string, unknown>).string_value;
          const key =
            GOOGLE_COLUMNS[id] ?? `q_${id.toLowerCase().slice(0, 40)}`;
          if (value != null && p[key] == null) p[key] = value;
        }
      }
      p.external_id = firstStr(getPath(body, "lead_id") as string);
      p.gclid = firstStr(getPath(body, "gcl_id") as string);
      p.utm_campaign = firstStr(
        String(getPath(body, "campaign_id") ?? "") || undefined,
      );
      p.utm_source = "google";
      p.utm_medium = "lead_form";
      return {
        payload: compact(p),
        sourceCostCents: null,
        googleKey: firstStr(getPath(body, "google_key") as string) ?? null,
        isTest: getPath(body, "is_test") === true,
      };
    }
    default:
      return {
        payload: flatten(body, 1),
        sourceCostCents: null,
        googleKey: null,
        isTest: false,
      };
  }
}

function compact(p: FlatPayload): FlatPayload {
  return Object.fromEntries(
    Object.entries(p).filter(
      ([, v]) => v !== undefined && v !== null && v !== "",
    ),
  );
}

/** Sample payloads for the settings test console and docs. */
export const PRESET_SAMPLES: Record<LeadPreset, unknown> = {
  generic: {
    name: "Dana Lee",
    phone: "(512) 555-7788",
    address: "12 Oak St, Austin, TX 78701",
    service_type: "Rekey",
    price: "$149",
    preferred_date: "2026-10-20",
    notes: "3 locks",
    sms_consent: true,
  },
  zapier: { name: "Dana Lee", phone: "5125557788", service: "Lockout" },
  make: { data: { full_name: "Dana Lee", phone_number: "+15125557788" } },
  thumbtack: {
    leadID: "tt-1234",
    leadPrice: "$22.00",
    customer: { name: "Dana Lee", phone: "5125557788" },
    request: {
      category: "Locksmith",
      description: "Locked out",
      location: { zipCode: "78701", city: "Austin", state: "TX" },
    },
  },
  angi: {
    leadOid: 998877,
    firstName: "Dana",
    lastName: "Lee",
    primaryPhone: "5125557788",
    postalCode: "78701",
    taskName: "Rekey Locks",
  },
  google_ads_leadform: {
    lead_id: "gl-1",
    google_key: "your-google-key",
    user_column_data: [
      { column_id: "FULL_NAME", string_value: "Dana Lee" },
      { column_id: "PHONE_NUMBER", string_value: "+15125557788" },
      { column_id: "POSTAL_CODE", string_value: "78701" },
    ],
    is_test: true,
  },
};
