import type { Metadata } from "next";
import { type ReactNode, Suspense } from "react";
import { JobRow } from "@/features/jobs/components/JobRow";
import { listLeftOpen } from "@/features/jobs/queries";
import { UnreceiptedPartsSection } from "@/features/parts/slots";
import { CashCheckSection } from "@/features/payroll/slots";
import { ClockCard } from "@/features/tech/components/islands";
import { OutboxRow } from "@/features/tech/components/OutboxRow";
import { SyncStatusCard } from "@/features/tech/components/SyncStatusCard";
import { getOpenEntry } from "@/features/time/queries";
import { EndOdometerSection } from "@/features/vehicles/slots";
import { requireUser } from "@/lib/auth/current";
import { getCompanyTimezone } from "@/lib/settings";
import { dateKey } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { ListSection } from "@/ui/components/List";
import { NavBar } from "@/ui/components/NavBar";
import { SkeletonCard } from "@/ui/components/Skeleton";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Finish my day" };

/** One step: an iOS section header over its content (slot steps bring their own). */
function Step({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2 empty:hidden">
      {title && (
        <h2 className="px-4 text-subhead font-semibold text-label-2">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

/** "Finish my day" (BUILD_PLAN §5.3): sync → texts → open jobs → cash → receipts → odometer → clock out. */
export default async function TodayFinishPage() {
  const user = await requireUser("time.clock_self");
  const tz = await getCompanyTimezone();
  const [left, open] = await Promise.all([
    listLeftOpen(user),
    getOpenEntry(user.id),
  ]);
  const today = dateKey(new Date(), tz);
  return (
    <PageTransition>
      <NavBar title="Finish my day" back={{ href: "/today", label: "Today" }} />
      <Page className="pt-4 pb-16">
        <div className="mx-auto flex max-w-[640px] flex-col gap-[var(--section-gap)]">
          <Step title="Sync this phone">
            <div className="card overflow-hidden">
              <SyncStatusCard />
            </div>
          </Step>
          <Step title="Customer texts to send">
            <div className="card overflow-hidden">
              <Suspense fallback={<SkeletonCard lines={1} />}>
                <OutboxRow user={user} />
              </Suspense>
            </div>
          </Step>
          <Step title="Jobs still open">
            {left.length === 0 ? (
              <div className="card px-4 py-3 text-subhead text-label-2">
                No jobs left on the way or in progress.
              </div>
            ) : (
              <ListSection footer="Complete each job or put it on hold.">
                {left.map((j) => (
                  <JobRow key={j.id} job={j} tz={tz} />
                ))}
              </ListSection>
            )}
          </Step>
          <Step>
            <Suspense fallback={<SkeletonCard lines={2} />}>
              <CashCheckSection userId={user.id} />
            </Suspense>
          </Step>
          <Step>
            <Suspense fallback={<SkeletonCard lines={2} />}>
              <UnreceiptedPartsSection userId={user.id} date={today} />
            </Suspense>
          </Step>
          <Step>
            <Suspense fallback={<SkeletonCard lines={1} />}>
              <EndOdometerSection userId={user.id} />
            </Suspense>
          </Step>
          <Step title="Clock out">
            <ClockCard
              mode="out"
              open={
                open
                  ? {
                      id: open.id,
                      clockInAt: open.clockInAt,
                      breakMinutes: open.breakMinutes,
                    }
                  : null
              }
              tz={tz}
              vehicle={null}
              requireOdometer={false}
              canClock
              openJobs={left.length}
            />
          </Step>
        </div>
      </Page>
    </PageTransition>
  );
}
