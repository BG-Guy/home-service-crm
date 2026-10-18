// Client-safe labels for the leads module (no server imports).

export const LOST_REASON_LABEL: Record<string, string> = {
  price: "Price",
  timing: "Timing",
  out_of_area: "Out of area",
  no_answer: "No answer",
  went_with_competitor: "Went with competitor",
  other: "Other",
};

export const lostReasonLabel = (r: string | null | undefined) =>
  r ? (LOST_REASON_LABEL[r] ?? r.replace(/_/g, " ")) : "";

export const INTEGRATION_LABEL: Record<string, string> = {
  plain_form: "Plain HTML form",
  js_snippet: "Form + JS snippet",
  hosted_form: "Hosted form",
  json_api: "JSON API",
  preset: "Marketplace / Zapier hook",
};

export const INTEGRATION_HINT: Record<string, string> = {
  plain_form: "Any static site. No JavaScript needed.",
  js_snippet:
    "Your form plus embed.js: attribution, inline success, stronger spam checks.",
  hosted_form: "We host the form. Link to it or embed it in an iframe.",
  json_api: "Server-to-server, Zapier/Make webhooks or your own backend.",
  preset: "Thumbtack, Angi, Google lead forms, Zapier or Make.",
};

export const PRESET_LABEL: Record<string, string> = {
  generic: "Generic JSON",
  zapier: "Zapier",
  make: "Make",
  thumbtack: "Thumbtack",
  angi: "Angi / HomeAdvisor",
  google_ads_leadform: "Google Ads lead form",
};

export const SOURCE_KIND_LABEL: Record<string, string> = {
  website: "Website",
  google_lsa: "Google LSA",
  google_ads: "Google Ads",
  angi: "Angi",
  thumbtack: "Thumbtack",
  yelp: "Yelp",
  referral: "Referral",
  repeat: "Repeat customer",
  phone: "Phone",
  walk_in: "Walk-in",
  zapier: "Zapier",
  other: "Other",
};

export const EVENT_LABEL: Record<string, string> = {
  received: "Received",
  touch: "Submitted again",
  call_attempt: "Call",
  status: "Status changed",
  note: "Note",
  spam: "Marked as spam",
  mapping_error: "Mapping incomplete",
};

export const OUTCOME_LABEL: Record<string, string> = {
  connected: "connected",
  no_answer: "no answer",
  voicemail: "left voicemail",
  wrong_number: "wrong number",
  busy: "busy",
};

/** Spam / "Check" signals in plain words (codes from intake/spam.ts). */
export const SPAM_SIGNAL_LABEL: Record<string, string> = {
  ts_missing:
    "sent without the site script's timestamp (plain form, or embed.js blocked)",
  ts_expired: "form page was open for over a day",
  ts_too_fast: "submitted faster than a person can type",
  ts_bad_signature: "forged form timestamp",
  ts_malformed: "forged form timestamp",
  honeypot: "hidden bot field was filled in",
  origin_not_allowed: "sent from a site that isn't on the allowed list",
  turnstile_failed: "failed the bot check",
  many_urls: "several links in the message",
  url_no_phone: "a link and no phone number",
  no_contact: "no phone or email",
  non_us_phone: "non-US phone number",
  gibberish_name: "name looks random",
  url_in_name: "link in the name",
  foreign_script: "unexpected alphabet",
};

/** "ts_missing,no_contact" → readable signals. */
export function spamSignals(reason: string | null | undefined): string {
  if (!reason) return "";
  return reason
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => SPAM_SIGNAL_LABEL[r] ?? r.replace(/_/g, " "))
    .join("; ");
}

/** Speed-to-lead tone: green < 5 min, amber < 15, red beyond (SPEC M04). */
export function slaTone(minutes: number): "green" | "orange" | "red" {
  if (minutes < 5) return "green";
  if (minutes < 15) return "orange";
  return "red";
}
