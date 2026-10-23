// Ready-to-paste integration snippets (SPEC §8.5), generated with the source's real
// key. Pure: the settings page passes the app URL, key, company and consent text.

import { consentWithCompany } from "./consent-text";

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export interface SnippetInput {
  appUrl: string;
  publicKey: string | null;
  companyName: string;
  consentText: string;
  services: string[];
  /** Placeholder shown in the curl example when the secret was already shown once. */
  secretKey?: string | null;
  thanksUrl?: string | null;
}

export interface Snippets {
  plainForm: string | null;
  jsSnippet: string | null;
  scriptTag: string | null;
  curl: string;
  curlPublic: string | null;
  hostedUrl: string | null;
  iframe: string | null;
}

export function buildSnippets(i: SnippetInput): Snippets {
  const base = i.appUrl.replace(/\/+$/, "");
  const pk = i.publicKey;
  const services = (
    i.services.length
      ? i.services
      : ["Free estimate", "Service call", "Project"]
  )
    .slice(0, 12)
    .concat("Other");
  const consent = esc(consentWithCompany(i.consentText, i.companyName));
  const fields = (
    action: string,
    extra = "",
  ) => `<form method="post" action="${action}"${extra}>
  <input name="name" required placeholder="Full name" autocomplete="name">
  <input name="phone" type="tel" required placeholder="Phone" autocomplete="tel">
  <input name="email" type="email" placeholder="Email" autocomplete="email">
  <input name="address" placeholder="Service address" autocomplete="street-address">
  <select name="service_type">
${services.map((s) => `    <option>${esc(s)}</option>`).join("\n")}
  </select>
  <input name="preferred_date" type="date">
  <textarea name="notes" placeholder="What do you need?"></textarea>
  <!-- honeypot: must stay empty; hidden from people -->
  <input name="company_website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px">
  <label><input type="checkbox" name="sms_consent" value="yes"> ${consent}</label>
  <input type="hidden" name="consent_text" value="${consent}">${
    i.thanksUrl
      ? `\n  <input type="hidden" name="redirect" value="${esc(i.thanksUrl)}">`
      : ""
  }
  <button>Request service</button>
</form>`;
  const formAction = pk ? `${base}/api/v1/leads/f/${pk}` : null;
  const scriptTag = pk
    ? `<script src="${base}/embed.js" data-key="${pk}" defer></script>`
    : null;
  const sample = JSON.stringify({
    name: "Dana Lee",
    phone: "(555) 201-7788",
    address: "12 Oak St, Austin, TX 78701",
    service_type: services[0],
    price: "$149",
    preferred_date: "2026-10-20",
    preferred_window: "morning",
    notes: "3 locks",
    external_id: "site-4411",
    sms_consent: true,
  });
  return {
    plainForm: formAction ? fields(formAction) : null,
    jsSnippet:
      formAction && scriptTag
        ? `${fields(formAction, " data-crm-lead")}\n${scriptTag}`
        : null,
    scriptTag,
    curl: `curl -X POST ${base}/api/v1/leads \\
  -H "Authorization: Bearer ${i.secretKey ?? "sk_live_…"}" \\
  -H "Content-Type: application/json" \\
  -d '${sample}'`,
    curlPublic: pk
      ? `fetch("${base}/api/v1/leads", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Site-Key": "${pk}" },
  body: JSON.stringify({ name, phone, service_type, notes, sms_consent }),
});`
      : null,
    hostedUrl: pk ? `${base}/f/${pk}` : null,
    iframe: pk
      ? `<iframe src="${base}/f/${pk}" title="Request service" style="width:100%;min-height:900px;border:0" loading="lazy"></iframe>`
      : null,
  };
}
