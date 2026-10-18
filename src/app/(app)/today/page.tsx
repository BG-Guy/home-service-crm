import type { Metadata } from "next";
import { Suspense } from "react";
import { HeaderActions } from "@/app/(app)/_components/HeaderActions";
import { OpsToday } from "@/features/insights/slots";
import { JobRow } from "@/features/jobs/components/JobRow";
import { listMyDay } from "@/features/jobs/queries";
import { MyDay } from "@/features/tech/components/MyDay";
import { requireUser } from "@/lib/auth/current";
import { getCompanyTimezone } from "@/lib/settings";
import { dateKey, formatDateKey, zonedParts } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { ListSection } from "@/ui/components/List";
import { LargeTitleHeader } from "@/ui/components/NavBar";
import { SkeletonPage } from "@/ui/components/Skeleton";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Today" };

function greeting(hour: number): string {
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** /today: the tech's My Day, or the office/admin Ops Today (B8 S54). */
export default async function TodayPage() {
  const user = await requireUser();
  const tz = await getCompanyTimezone();
  const now = new Date();
  const day = dateKey(now, tz);
  const subtitle = formatDateKey(day, "en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const tech = user.baseRole === "tech";

  if (tech) {
    return (
      <PageTransition>
        <LargeTitleHeader
          title={`${greeting(zonedParts(now, tz).hour)}, ${user.firstName}`}
          subtitle={subtitle}
          trailing={<HeaderActions />}
        />
        <Page>
          <MyDay user={user} day={day} tz={tz} />
        </Page>
      </PageTransition>
    );
  }

  const mine = user.perms.has("jobs.view_own")
    ? (await listMyDay(user, day)).today
    : [];
  return (
    <PageTransition>
      <LargeTitleHeader
        title="Today"
        subtitle={subtitle}
        trailing={<HeaderActions />}
      />
      <Page wide>
        <div className="flex flex-col gap-[var(--section-gap)]">
          {mine.length > 0 && (
            <ListSection header="Your jobs today">
              {mine.map((j) => (
                <JobRow key={j.id} job={j} tz={tz} showDate={false} />
              ))}
            </ListSection>
          )}
          <Suspense fallback={<SkeletonPage stats={4} rows={4} />}>
            <OpsToday />
          </Suspense>
        </div>
      </Page>
    </PageTransition>
  );
}
