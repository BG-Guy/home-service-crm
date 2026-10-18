import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { consentWithCompany } from "@/features/leads/consent-text";
import { processLeadFormFields } from "@/features/leads/intake/hosted";
import { sourceByPublicKey } from "@/features/leads/intake/process";
import { signTs } from "@/features/leads/intake/spam";
import { tsSecret, turnstileSiteKey } from "@/features/leads/keys";
import { listServiceTypes } from "@/features/settings/api";
import { findCompany, getSettings, isEnabled } from "@/lib/settings";
import { Select, TextArea, TextField } from "@/ui/components/Field";

export const metadata: Metadata = {
  title: "Request service",
  robots: { index: false },
};

// Hosted lead form (SPEC M04) for sites that can't run scripts: a plain, JS-free
// <form> posting to the form endpoint (303 → thanks). Embeddable in an iframe.
export default async function HostedLeadForm({
  params,
  searchParams,
}: {
  params: Promise<{ publicKey: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { publicKey } = await params;
  const sp = await searchParams;
  if (!(await isEnabled("leads"))) notFound();
  const src = await sourceByPublicKey(publicKey);
  if (!src) notFound();
  const [settings, company, services] = await Promise.all([
    getSettings(),
    findCompany(),
    listServiceTypes().catch(() => []),
  ]);
  const hidden = processLeadFormFields(sp);
  const turnstile = src.turnstileRequired ? turnstileSiteKey() : null;
  const name = settings.branding.app_name || company?.name || "";
  // Shown and stored verbatim (consent_events.text_shown), business name included.
  const consent = consentWithCompany(
    settings.compliance.sms_consent_text,
    name,
  );
  return (
    <div className="mt-2 flex flex-col gap-4">
      <div className="px-1">
        <h1 className="text-title1 font-bold tracking-tight">
          Request service
        </h1>
        <p className="mt-1 text-subhead text-label-2">
          Tell us what you need and we'll call you back within{" "}
          {settings.company.lead_response_minutes} minutes during business
          hours.
        </p>
      </div>
      <form
        method="post"
        action={`/api/v1/leads/f/${publicKey}`}
        className="list-card flex flex-col gap-4 px-4 py-5"
      >
        <TextField
          label="Full name"
          name="name"
          required
          autoComplete="name"
          maxLength={200}
        />
        <TextField
          label="Phone"
          name="phone"
          type="tel"
          required
          autoComplete="tel"
          inputMode="tel"
          maxLength={40}
        />
        <TextField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          hint="Optional"
          maxLength={200}
        />
        <TextField
          label="Service address"
          name="address"
          autoComplete="street-address"
          placeholder="12 Oak St, Austin, TX 78701"
          maxLength={300}
        />
        {services.length > 0 ? (
          <Select
            label="What do you need?"
            name="service_type"
            defaultValue=""
            options={[
              { value: "", label: "Choose a service" },
              ...services.map((s) => ({ value: s.name, label: s.name })),
              { value: "Other", label: "Something else" },
            ]}
          />
        ) : (
          <TextField
            label="What do you need?"
            name="service_type"
            maxLength={120}
          />
        )}
        <TextField
          label="Preferred date"
          name="preferred_date"
          type="date"
          hint="Optional"
        />
        <TextArea
          label="Details"
          name="notes"
          rows={3}
          maxLength={5000}
          placeholder="Anything that helps us prepare"
        />
        {/* Honeypot: hidden from people, irresistible to bots. */}
        <div
          aria-hidden
          className="absolute -left-[9999px] h-0 w-0 overflow-hidden"
        >
          <label>
            Company website
            <input name="company_website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>
        <input type="hidden" name="_ts" value={signTs(tsSecret(), publicKey)} />
        <input type="hidden" name="consent_text" value={consent} />
        {hidden.map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        {/* Consent is never pre-checked and never required (10DLC). */}
        <label className="flex min-h-11 items-start gap-3 text-footnote text-label-2">
          <input
            type="checkbox"
            name="sms_consent"
            value="yes"
            className="mt-0.5 size-5 shrink-0 accent-[var(--accent)]"
          />
          <span>{consent}</span>
        </label>
        <label className="flex min-h-11 items-start gap-3 text-footnote text-label-2">
          <input
            type="checkbox"
            name="marketing_consent"
            value="yes"
            className="mt-0.5 size-5 shrink-0 accent-[var(--accent)]"
          />
          <span>{settings.compliance.marketing_consent_text}</span>
        </label>
        {turnstile && (
          <>
            <div className="cf-turnstile" data-sitekey={turnstile} />
            <script
              src="https://challenges.cloudflare.com/turnstile/v0/api.js"
              async
              defer
            />
          </>
        )}
        <button
          type="submit"
          className="pressable min-h-[50px] rounded-control bg-accent px-6 text-body font-semibold text-on-accent"
        >
          Request service
        </button>
        <p className="text-center text-caption text-label-3">
          By submitting you agree to be contacted about this request.{" "}
          <a href="/privacy" className="underline">
            Privacy
          </a>{" "}
          ·{" "}
          <a href="/sms-terms" className="underline">
            SMS terms
          </a>
        </p>
      </form>
    </div>
  );
}
