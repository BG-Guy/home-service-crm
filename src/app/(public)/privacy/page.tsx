import type { Metadata } from "next";
import Link from "next/link";
import { PolicyPage } from "@/app/(public)/_components/PolicyPage";

export const metadata: Metadata = { title: "Privacy policy" };

// Privacy policy (SPEC M12): the current published version, plus the mobile-data
// clause carriers require for text-message programs.
export default function PrivacyPage() {
  return (
    <>
      <PolicyPage kind="privacy" />
      <article className="list-card mt-4 px-5 py-6">
        <h2 className="text-title3 font-semibold">Mobile information</h2>
        <p className="mt-2 text-body">
          No mobile information will be shared with third parties or affiliates
          for marketing or promotional purposes. Text-message opt-in data and
          consent are never shared with anyone. Information may be shared with
          the providers that deliver our texts and emails, only to deliver them.
        </p>
        <p className="mt-3 text-body">
          Text-message details, including how to opt out:{" "}
          <Link href="/sms-terms" className="text-accent-text">
            SMS terms
          </Link>
          .
        </p>
      </article>
    </>
  );
}
