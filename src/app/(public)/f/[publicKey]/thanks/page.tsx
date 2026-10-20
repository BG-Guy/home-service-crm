import { PhoneCall } from "lucide-react";
import type { Metadata } from "next";
import { formatPhoneDisplay } from "@/lib/phone-display";
import { findCompany, getSettings } from "@/lib/settings";
import { SuccessCheck } from "@/ui/components/SuccessCheck";
import { toneStyle } from "@/ui/tone";

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
    <div className="card mt-4 flex flex-col items-center gap-3 px-6 py-10 text-center">
      {busy ? (
        <span
          className="tint-bg tint-fg inline-flex size-16 items-center justify-center rounded-full"
          style={toneStyle("orange")}
        >
          <PhoneCall size={30} aria-hidden />
        </span>
      ) : (
        <SuccessCheck size={64} label="Request received" />
      )}
      <h1 className="mt-2 text-title1">
        {busy ? "We couldn't take that just now" : "Thanks, we got it!"}
      </h1>
      <p className="max-w-[40ch] text-body text-label-2">
        {busy
          ? "We're receiving a lot of requests. Please call us so we don't miss you."
          : `We'll call you back within ${settings.company.lead_response_minutes} minutes during business hours.`}
      </p>
      {phone && (
        <a
          href={`tel:${phone}`}
          // buttonClass() output, inlined: importing Button.tsx pulls next/link's client chunk
          className={`btn pressable btn-lg mt-3 select-none ${busy ? "btn-primary" : "btn-secondary"}`}
        >
          <PhoneCall size={18} aria-hidden /> Call {formatPhoneDisplay(phone)}
        </a>
      )}
    </div>
  );
}
