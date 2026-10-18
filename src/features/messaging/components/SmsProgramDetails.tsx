import { formatPhoneDisplay } from "@/lib/phone-display";
import { findCompany, getSettings } from "@/lib/settings";

/**
 * Generated SMS program disclosure (SPEC M12 "Generated compliance pages"): who sends,
 * what, how often, STOP/HELP, carrier disclaimer, how people opt in, and the
 * no-sharing-of-mobile-opt-in-data clause — the details 10DLC reviewers look for.
 */
export async function SmsProgramDetails() {
  const [company, settings] = await Promise.all([findCompany(), getSettings()]);
  const name = settings.branding.app_name || company?.name || "We";
  const raw = settings.messaging.reply_phone || company?.phone || null;
  const phone = raw ? formatPhoneDisplay(raw) : null;
  const email = company?.email ?? null;
  return (
    <article className="list-card mt-4 px-5 py-6">
      <h2 className="text-title3 font-semibold">Text message program</h2>
      <dl className="mt-3 flex flex-col gap-3 text-body">
        <div>
          <dt className="font-semibold">Who sends the texts</dt>
          <dd>
            {name}
            {phone ? `, ${phone}` : ""}.
          </dd>
        </div>
        <div>
          <dt className="font-semibold">What we send</dt>
          <dd>
            Replies to your requests, appointment confirmations and reminders,
            “on the way” notices, estimates, invoices, receipts and payment
            reminders. With your separate permission, occasional maintenance
            reminders and offers.
          </dd>
        </div>
        <div>
          <dt className="font-semibold">How you sign up</dt>
          <dd>
            By checking the text-message box on our website form, or by telling
            us on the phone or in person. Agreeing to texts is never required to
            buy our services.
          </dd>
        </div>
        <div>
          <dt className="font-semibold">How often</dt>
          <dd>
            Message frequency varies with your appointments — usually a few
            texts per visit. Never more than three automated texts in a day, and
            offers at most once a week. We don&apos;t text between 8 PM and 8 AM
            your time, except when a technician is on the way.
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Stop or get help</dt>
          <dd>
            Reply STOP to opt out at any time, START to opt back in, HELP for
            help.
            {phone ? ` You can also call ${phone}` : ""}
            {email ? ` or email ${email}` : ""}.
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Costs</dt>
          <dd>
            Message and data rates may apply. Carriers aren&apos;t liable for
            delayed or undelivered messages.
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Your number stays private</dt>
          <dd>
            We never sell, rent or share your mobile number or text-message
            opt-in data with third parties or affiliates for their marketing.
          </dd>
        </div>
      </dl>
    </article>
  );
}
