import type { Metadata } from "next";
import { AdminDashboard } from "@/features/insights/components/AdminDashboard";
import { Block } from "@/features/insights/components/bits";
import { Leaderboard } from "@/features/insights/components/Leaderboard";
import { OpsBoard } from "@/features/insights/components/OpsBoard";
import { PeriodBar } from "@/features/insights/components/PeriodBar";
import { SetupChecklistCard } from "@/features/insights/components/SetupChecklistCard";
import { TechDashboard } from "@/features/insights/components/TechDashboard";
import { getTechLeaderboard } from "@/features/insights/kpis";
import { rangeQuery, resolvePeriod } from "@/features/insights/period";
import { getSetupChecklist } from "@/features/insights/setup";
import { UrlSegmented } from "@/features/settings/components/UrlSegmented";
import { getCurrentUser, requireAnyPerm } from "@/lib/auth/current";
import { getCompanyTimezone, getSettings } from "@/lib/settings";
import { dateKey, formatInTz } from "@/lib/time";
import type { SessionUser } from "@/lib/types";
import { Page } from "@/ui/components/AppShell";
import { EmptyState } from "@/ui/components/EmptyState";
import { LargeTitleHeader } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";
import { HeaderActions } from "../_components/HeaderActions";

type View = "business" | "ops" | "me";

/** The dashboards this viewer can switch between, the default first. */
function viewsFor(user: SessionUser): View[] {
  const views: View[] = [];
  if (user.perms.has("insights.view_financials")) views.push("business");
  if (
    user.perms.has("insights.view_ops") ||
    user.perms.has("insights.view_team")
  )
    views.push("ops");
  if (user.perms.has("insights.view_own") && user.baseRole === "tech")
    views.push("me");
  if (views.length === 0) views.push("me");
  return views;
}

const pickView = (views: View[], requested: string | undefined): View =>
  views.includes(requested as View) ? (requested as View) : (views[0] as View);

/** Admins reach this page from the "Home" tab (SPEC §13), so it keeps that name. */
const titleFor = (user: SessionUser, view: View) =>
  view === "me" ? "My stats" : user.baseRole === "admin" ? "Home" : "Insights";

// The tab title matches the large title and the tab/sidebar label (QA2 office).
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}): Promise<Metadata> {
  const user = await getCurrentUser();
  if (!user) return { title: "Insights" };
  const sp = await searchParams;
  return { title: titleFor(user, pickView(viewsFor(user), sp.view)) };
}

// Insights (SPEC M20; BUILD_PLAN §9 B8): three role variants — admin "Business"
// (financial KPIs), office "Ops" (today's board + team leaderboard), tech "My stats".
// `?view=` switches when a viewer holds more than one; `?period=&from=&to=` per Appendix A.
export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    period?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const user = await requireAnyPerm([
    "insights.view_own",
    "insights.view_ops",
    "insights.view_financials",
    "insights.view_team",
  ]);
  const sp = await searchParams;
  const views = viewsFor(user);
  const view = pickView(views, sp.view);

  const [tz, settings] = await Promise.all([
    getCompanyTimezone(),
    getSettings(),
  ]);
  const now = new Date();
  const period = resolvePeriod(sp, now, tz, {
    weekStartsOn: settings.insights.week_starts_on,
  });
  // The ops board is live "today" data; only its team block follows a period, so
  // the selector sits on that block instead of the header (QA2 T3-05).
  const showTeam = view === "ops" && user.perms.has("insights.view_team");
  const headerPeriod = view !== "ops";
  const setup =
    view === "business" && user.perms.has("settings.manage")
      ? await getSetupChecklist(user.id)
      : null;
  const board = showTeam ? await getTechLeaderboard(period) : null;
  const todayKey = dateKey(now, tz);
  const periodBar = (
    <PeriodBar
      period={period.key}
      fromKey={period.fromKey}
      toKey={period.toKey}
      todayKey={todayKey}
    />
  );

  const labels: Record<View, string> = {
    business: "Business",
    ops: "Today",
    me: "My stats",
  };
  return (
    <PageTransition>
      <LargeTitleHeader
        title={titleFor(user, view)}
        subtitle={
          headerPeriod
            ? `${period.label} · ${period.compareLabel.replace(/^vs /, "compared with ")}`
            : formatInTz(now, tz, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })
        }
        trailing={<HeaderActions />}
      >
        <div className="flex flex-col gap-2">
          {views.length > 1 && (
            <UrlSegmented
              param="view"
              value={view}
              defaultValue={views[0]}
              label="Dashboard"
              segments={views.map((v) => ({ value: v, label: labels[v] }))}
            />
          )}
          {headerPeriod && periodBar}
        </div>
      </LargeTitleHeader>
      <Page wide className="pt-3 lg:max-w-[1200px]">
        {setup && !setup.dismissed && setup.done < setup.total && (
          <div className="mb-[var(--section-gap)]">
            <SetupChecklistCard checklist={setup} canEdit />
          </div>
        )}
        {view === "business" && (
          <AdminDashboard user={user} period={period} tz={tz} />
        )}
        {view === "ops" && (
          <div className="flex flex-col gap-[var(--section-gap)]">
            <OpsBoard user={user} />
            {showTeam && board && (
              <Block id="leaderboard" title={`Team · ${period.label}`}>
                <div className="flex flex-col gap-3">
                  {periodBar}
                  {board.length > 0 ? (
                    <Leaderboard
                      rows={board}
                      rq={rangeQuery(period)}
                      viewer={user}
                    />
                  ) : (
                    <EmptyState
                      compact
                      title="No technicians yet"
                      message="Invite techs from Team to compare their jobs and revenue here."
                    />
                  )}
                </div>
              </Block>
            )}
          </div>
        )}
        {view === "me" && <TechDashboard user={user} period={period} tz={tz} />}
      </Page>
    </PageTransition>
  );
}
