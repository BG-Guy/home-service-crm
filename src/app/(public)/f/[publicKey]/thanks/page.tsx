import { CircleCheck, PhoneCall } from "lucide-react";
import type { Metadata } from "next";
import { formatPhoneDisplay } from "@/lib/phone-display";
import { findCompany, getSettings } from "@/lib/settings";

export const metadata: Metadata = {
  title: "Thanks!",
  robots: { index: false },
};

// Hosted thank-you page (303 target of form posts without an allowed `redirect`).
export default async function LeadThanksPage({
  searchParams,
}: {
  params: Promise<{ publicKey: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const busy = sp.status === "busy";
  const [settings, company] = await Promise.all([getSettings(), findCompany()]);
  const phone = settings.company.emergency_phone || company?.phone;
  return (
    <div className="list-card mt-4 flex flex-col items-center gap-3 px-6 py-10 text-center">
      {busy ? (
        <PhoneCall
          size={52}
          strokeWidth={1.6}
          className="text-[var(--sys-orange)]"
          aria-hidden
        />
      ) : (
        <CircleCheck
          size={52}
          strokeWidth={1.6}
          className="text-[var(--sys-green)]"
          aria-hidden
        />
      )}
      <h1 className="text-title2 font-bold">
        {busy ? "We couldn't take that just now" : "Thanks — we got it!"}
      </h1>
      <p className="max-w-[40ch] text-body text-label-2">
        {busy
          ? "We're receiving a lot of requests. Please call us so we don't miss you."
          : `We'll call you back within ${settings.company.lead_response_minutes} minutes during business hours.`}
      </p>
      {phone && (
        <a
          href={`tel:${phone}`}
          className="pressable mt-2 flex min-h-11 items-center gap-2 rounded-full bg-accent/15 px-5 font-semibold text-accent-text"
        >
          <PhoneCall size={18} aria-hidden /> Call {formatPhoneDisplay(phone)}
        </a>
      )}
    </div>
  );
}
