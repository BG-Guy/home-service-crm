import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PushedScreen } from "@/features/messaging/components/PushedScreen";
import { ReviewSettingsForm } from "@/features/reviews/components/ReviewSettingsForm";
import { requireUser } from "@/lib/auth/current";
import { getSettings, isEnabled } from "@/lib/settings";

export const metadata: Metadata = { title: "Reviews" };

// Settings → Reviews (SPEC M14): Google link + test, timing, reminder, rating page,
// consent basis ⚖️ and the no-charge-callback rule.
export default async function SettingsReviewsPage() {
  await requireUser("settings.manage");
  if (!(await isEnabled("reviews"))) notFound();
  const s = await getSettings();
  return (
    <PushedScreen
      title="Reviews"
      intro="After a paid job, customers get one request for a Google review (plus one reminder)."
    >
      <ReviewSettingsForm initial={s.reviews} />
    </PushedScreen>
  );
}
