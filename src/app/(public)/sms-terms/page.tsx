import type { Metadata } from "next";
import Link from "next/link";
import { PolicyPage } from "@/app/(public)/_components/PolicyPage";
import { SmsProgramDetails } from "@/features/messaging/components/SmsProgramDetails";

export const metadata: Metadata = { title: "SMS terms" };

// SMS terms (SPEC M12): the published policy text plus the generated program details
// (sender, message types, frequency, STOP/HELP, opt-in, no sharing of opt-in data).
export default function SmsTermsPage() {
  return (
    <>
      <PolicyPage kind="sms_terms" />
      <SmsProgramDetails />
      <p className="mt-4 px-1 text-footnote text-label-2">
        See also our{" "}
        <Link href="/privacy" className="text-accent-text">
          privacy policy
        </Link>
        .
      </p>
    </>
  );
}
