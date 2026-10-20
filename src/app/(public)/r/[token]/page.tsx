import { Clock } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { RatingCard } from "@/features/reviews/components/RatingCard";
import { recordReviewClick } from "@/features/reviews/service";
import { safeHttpsUrl } from "@/features/reviews/url";
import { clientIpFromHeaders } from "@/lib/client-ip";
import { processEventsSoon } from "@/lib/events";
import { rateLimit } from "@/lib/ratelimit";
import { findCompany, getSettings, isEnabled } from "@/lib/settings";
import { resolvePublicToken } from "@/lib/tokens";
import { EmptyState } from "@/ui/components/EmptyState";

export const metadata: Metadata = {
  title: "How did we do?",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

// /r/[token] (SPEC M14): logs the click (job, tech, time, UA) then either 302s to the
// Google review link or shows the optional 1–5 page. Every rating sees Google; ≤ 3
// also sees the owner-call offer. Yelp is never a target.
export default async function RTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const [{ token }, h] = await Promise.all([params, headers()]);
  // Trusted-proxy rule (QA T5-13): never the client-written leftmost hop.
  const ip = clientIpFromHeaders(h);
  const [settings, company, on] = await Promise.all([
    getSettings(),
    findCompany(),
    isEnabled("reviews"),
  ]);
  const rl = await rateLimit({
    key: `portal:${ip ?? "unknown"}`,
    limit: 60,
    windowSec: 60,
  });
  const tok =
    on && rl.ok
      ? await resolvePublicToken("review", token, {
          path: "/r",
          action: "clicked",
          ip,
          userAgent: h.get("user-agent"),
        })
      : null;
  // Redirect target from settings: https only (QA T5-17).
  const google = safeHttpsUrl(settings.reviews.google_url);
  const name = settings.branding.app_name || company?.name || "us";

  if (!tok)
    return (
      <div className="card mt-4">
        <EmptyState
          icon={<Clock size={44} strokeWidth={1.5} />}
          title={
            rl.ok ? "This link has expired" : "Please try again in a minute"
          }
          message={
            google
              ? "You can still leave a review on Google — thank you!"
              : `Thanks for choosing ${name}.`
          }
          action={
            google ? (
              <a
                href={google}
                rel="noopener noreferrer"
                className="text-accent-text"
              >
                Open Google reviews
              </a>
            ) : undefined
          }
        />
      </div>
    );

  const rr = await db.transaction((tx) => recordReviewClick(tx, tok));
  await processEventsSoon();

  if (!settings.reviews.internal_rating_page && google) redirect(google);

  return (
    <div className="mt-4">
      <RatingCard
        token={token}
        googleUrl={google}
        companyName={name}
        initialRating={rr?.rating ?? null}
      />
    </div>
  );
}
