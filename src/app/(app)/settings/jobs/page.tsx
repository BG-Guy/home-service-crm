import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { db } from "@/db";
import { counters } from "@/db/schema";
import { JobSettingsForm } from "@/features/jobs/components/JobSettingsForm";
import { requireUser } from "@/lib/auth/current";
import { getSettings } from "@/lib/settings";
import { Page } from "@/ui/components/AppShell";
import { NavBar } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Jobs & scheduling" };

/** Settings → Jobs & scheduling (BUILD_PLAN §3.4 `jobs` namespace). */
export default async function SettingsJobsPage() {
  await requireUser("settings.manage");
  const [s, [counter]] = await Promise.all([
    getSettings(),
    db
      .select({ prefix: counters.prefix })
      .from(counters)
      .where(eq(counters.key, "job"))
      .limit(1),
  ]);
  const j = s.jobs;
  return (
    <PageTransition>
      <NavBar
        title="Jobs & scheduling"
        back={{ href: "/settings", label: "Settings" }}
      />
      <Page className="pt-4">
        <div className="mx-auto max-w-[680px]">
          <p className="mb-4 px-1 text-subhead text-label-2">
            Arrival windows, confirmations, cancellation fees and job numbering.
          </p>
          <JobSettingsForm
            initial={{
              arrival_radius_m: j.arrival_radius_m,
              window_lengths_min: j.window_lengths_min,
              default_window_min: j.default_window_min,
              unconfirmed_flag_time: j.unconfirmed_flag_time,
              late_cancel_hours: j.cancellation_policy.late_cancel_hours,
              late_cancel_fee_cents:
                j.cancellation_policy.late_cancel_fee_cents,
              no_show_fee_cents: j.cancellation_policy.no_show_fee_cents,
              service_call_fee_cents: j.service_call_fee_cents,
              service_call_fee_credited: j.service_call_fee_credited,
              callback_no_charge: j.callback_no_charge,
              warranty_claim_due_days: j.warranty_claim_due_days,
              board_start_hour: j.board_start_hour,
              board_end_hour: j.board_end_hour,
              job_prefix: (counter?.prefix ?? "J-").replace(/-$/, "") || "J",
            }}
          />
        </div>
      </Page>
    </PageTransition>
  );
}
