import { FIELD_ALIASES } from "./normalize";

// JSON Schema of the lead intake payload (GET /api/v1/leads/schema). Generated from
// the alias table so docs and the normalizer can never drift apart.

const DESCRIPTIONS: Record<string, string> = {
  name: "Full name (or send first_name + last_name).",
  first_name: "Given name.",
  last_name: "Family name.",
  phone: "Any US format: (512) 555-0100, 512.555.0100, +15125550100.",
  email: "Email address.",
  address: 'One-line address: "12 Oak St, Austin, TX 78701".',
  street: "Street line (with city, state, zip).",
  unit: "Apartment, suite or unit.",
  city: "City.",
  state: "Two-letter state.",
  zip: "ZIP code.",
  service:
    "Service requested; matched to your service types, else kept as text.",
  price: 'Quoted price: "$1,200", "1200" or "1200.50".',
  date: "Preferred date: YYYY-MM-DD or MM/DD/YYYY (company time zone).",
  window: 'Preferred time window, e.g. "morning".',
  notes: "Free-text message.",
  external_id: "Your id for this lead; repeats are merged, not duplicated.",
  sms_consent:
    "true/on/1/yes when the person ticked an (unchecked by default) SMS consent box.",
  marketing_consent: "Separate, optional marketing consent box.",
  consent_text: "The exact consent wording shown next to the box.",
  redirect:
    "Form posts only: where to send the browser after submit (origin must be allow-listed).",
  honeypot: "Leave empty. Bots fill it in.",
  ts: "Signed render timestamp added by embed.js and the hosted form.",
  turnstile: "Cloudflare Turnstile token (when the source requires it).",
  test: "true to mark a test lead.",
  source: "API keys only: source id or name to attribute the lead to.",
};

const TYPES: Record<string, string | string[]> = {
  sms_consent: ["boolean", "string"],
  marketing_consent: ["boolean", "string"],
  test: ["boolean", "string"],
  price: ["string", "number"],
};

export function leadJsonSchema() {
  const properties: Record<string, unknown> = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const [primary, ...rest] = aliases as readonly string[];
    if (!primary) continue;
    properties[primary] = {
      type: TYPES[field] ?? "string",
      description: DESCRIPTIONS[field] ?? field,
      ...(rest.length ? { "x-aliases": rest } : {}),
    };
  }
  properties.utm_source = {
    type: "string",
    description:
      "Attribution: every utm_* field plus gclid, gbraid, wbraid, fbclid, msclkid, referrer, landing_url and page_url is stored with the lead.",
  };
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Lead",
    description:
      "POST /api/v1/leads (JSON, X-Site-Key or Bearer key) or /api/v1/leads/f/<public key> (form post). Unknown fields are kept in the lead's extra data. At least one of phone or email is expected.",
    type: "object",
    properties,
    additionalProperties: true,
    "x-responses": {
      "201": { id: "uuid", status: "created", customer_id: "uuid|null" },
      "200": { id: "uuid", status: "merged", customer_id: "uuid|null" },
      "200 (X-Site-Key)": { status: "received" },
      "400": { error: "invalid_request", errors: { field: ["message"] } },
      "429": { error: "rate_limited" },
    },
  };
}
