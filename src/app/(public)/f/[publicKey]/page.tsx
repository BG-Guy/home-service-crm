import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { consentWithCompany } from "@/features/leads/consent-text";
import { processLeadFormFields } from "@/features/leads/intake/hosted";
import { sourceByPublicKey } from "@/features/leads/intake/process";
import { signTs } from "@/features/leads/intake/spam";
import { tsSecret, turnstileSiteKey } from "@/features/leads/keys";
import { listServiceTypes } from "@/features/settings/api";
import { findCompany, getSettings, isEnabled } from "@/lib/settings";
import { buttonClass } from "@/ui/components/Button";
import { TextArea, TextField } from "@/ui/components/Field";
import { cx } from "@/ui/cx";

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
  // Stepped (service → details → contact) with CSS only: three step radios that
  // belong to no form (`form` points at a missing id, so they're never posted),
  // and `:has()` shows one step at a time. Browsers without `:has()` see the
  // whole form. With Turnstile the form stays one page (the widget must render
  // visible). The page ships no JS of its own.
  const stepped = !turnstile;
  const stepCls = (n: 1 | 2 | 3) =>
    cx(
      "card flex flex-col gap-4 p-5 enter-fade-up",
      stepped &&
        {
          1: "group-has-[#lf-s2:checked]/lf:hidden group-has-[#lf-s3:checked]/lf:hidden",
          2: "group-has-[#lf-s1:checked]/lf:hidden group-has-[#lf-s3:checked]/lf:hidden",
          3: "group-has-[#lf-s1:checked]/lf:hidden group-has-[#lf-s2:checked]/lf:hidden",
        }[n],
    );
  const next = (to: 2 | 3, label: string) =>
    stepped ? (
      <div className="hidden supports-[selector(:has(*))]:block">
        <label
          htmlFor={`lf-s${to}`}
          className={cx(
            buttonClass({ variant: "primary", size: "lg", block: true }),
            "cursor-pointer",
          )}
        >
          {label}
        </label>
      </div>
    ) : null;
  const back = (to: 1 | 2) =>
    stepped ? (
      <div className="-mt-2 hidden justify-center supports-[selector(:has(*))]:flex">
        <label
          htmlFor={`lf-s${to}`}
          className="flex min-h-11 cursor-pointer items-center px-4 text-subhead font-semibold text-accent-text"
        >
          Back
        </label>
      </div>
    ) : null;
  const stepTitle = (n: number, title: string) => (
    <div>
      {stepped ? (
        <p className="text-footnote font-semibold text-label-2">
          Step {n} of 3
        </p>
      ) : null}
      <h2 className="text-title3">{title}</h2>
    </div>
  );
  return (
    <div className="mt-1 flex flex-col gap-4">
      <div className="px-1 pt-2">
        <h1 className="text-large-title">Request service</h1>
        <p className="mt-2 text-subhead text-label-2">
          Tell us what you need and we'll call you back within{" "}
          {settings.company.lead_response_minutes} minutes during business
          hours.
        </p>
      </div>
      <form
        method="post"
        action={`/api/v1/leads/f/${publicKey}`}
        className="group/lf flex flex-col gap-4"
      >
        {stepped && (
          <>
            {/* Default button, disabled: Enter in an earlier step never submits
                a half-filled form; the visible button below does. */}
            <button type="submit" disabled hidden aria-hidden tabIndex={-1} />
            <fieldset className="hidden gap-1.5 supports-[selector(:has(*))]:grid supports-[selector(:has(*))]:grid-cols-3">
              <legend className="sr-only">Steps</legend>
              {(["What you need", "Details", "Contact"] as const).map(
                (label, i) => (
                  <label
                    key={label}
                    className="flex cursor-pointer flex-col gap-1.5 text-caption text-label-2 has-[:checked]:text-label has-[:focus-visible]:text-accent-text"
                  >
                    <input
                      type="radio"
                      id={`lf-s${i + 1}`}
                      name="lf_step"
                      form="lf-step-state"
                      defaultChecked={i === 0}
                      className="sr-only"
                    />
                    <span
                      aria-hidden
                      className={cx(
                        "h-1 rounded-pill transition-colors duration-[var(--dur-quick)]",
                        i === 0 ? "bg-accent" : "bg-fill",
                        i === 1 &&
                          "group-has-[#lf-s2:checked]/lf:bg-accent group-has-[#lf-s3:checked]/lf:bg-accent",
                        i === 2 && "group-has-[#lf-s3:checked]/lf:bg-accent",
                      )}
                    />
                    <span className="truncate px-0.5">{label}</span>
                  </label>
                ),
              )}
            </fieldset>
          </>
        )}

        <section className={stepCls(1)} aria-labelledby="lf-t1">
          <div id="lf-t1">{stepTitle(1, "What do you need?")}</div>
          {services.length > 0 ? (
            <fieldset className="flex flex-wrap gap-2">
              <legend className="sr-only">Service</legend>
              {[
                ...services.map((s) => ({ value: s.name, label: s.name })),
                { value: "Other", label: "Something else" },
              ].map((o) => (
                <label
                  key={o.value}
                  className="pressable inline-flex min-h-11 cursor-pointer items-center rounded-pill bg-card px-4 text-subhead font-semibold shadow-[0_0_0_1px_var(--sep)] transition-colors duration-[var(--dur-quick)] has-[:checked]:bg-label has-[:checked]:text-bg has-[:checked]:shadow-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent"
                >
                  <input
                    type="radio"
                    name="service_type"
                    value={o.value}
                    className="sr-only"
                  />
                  {o.label}
                </label>
              ))}
            </fieldset>
          ) : (
            <TextField
              label="What do you need?"
              hideLabel
              name="service_type"
              maxLength={120}
              placeholder="e.g. Fix a leaking faucet"
            />
          )}
          {next(2, "Continue")}
        </section>

        <section className={stepCls(2)} aria-labelledby="lf-t2">
          <div id="lf-t2">{stepTitle(2, "Tell us a little more")}</div>
          <TextArea
            label="Details"
            name="notes"
            rows={4}
            maxLength={5000}
            placeholder="What's going on? Anything that helps us prepare"
          />
          <TextField
            label="Service address"
            name="address"
            autoComplete="street-address"
            placeholder="12 Oak St, Austin, TX 78701"
            maxLength={300}
          />
          <TextField
            label="Preferred date (optional)"
            name="preferred_date"
            type="date"
          />
          {next(3, "Continue")}
          {back(1)}
        </section>

        <section className={stepCls(3)} aria-labelledby="lf-t3">
          <div id="lf-t3">{stepTitle(3, "How do we reach you?")}</div>
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
            label="Email (optional)"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={200}
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
          <input
            type="hidden"
            name="_ts"
            value={signTs(tsSecret(), publicKey)}
          />
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
            className={buttonClass({
              variant: "primary",
              size: "lg",
              block: true,
            })}
          >
            Request service
          </button>
          {back(2)}
          <p className="text-center text-caption text-label-2">
            By submitting you agree to be contacted about this request.{" "}
            <a href="/privacy" className="underline">
              Privacy
            </a>{" "}
            ·{" "}
            <a href="/sms-terms" className="underline">
              SMS terms
            </a>
          </p>
        </section>
      </form>
    </div>
  );
}
