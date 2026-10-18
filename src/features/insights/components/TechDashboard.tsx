import {
  Banknote,
  CalendarCheck,
  Navigation,
  Receipt,
  Trophy,
} from "lucide-react";
import { MyEarningsCard } from "@/features/payroll/slots";
import { ToolCustodyRow } from "@/features/tools/slots";
import { AssignedVehicleRow } from "@/features/vehicles/slots";
import { isEnabled } from "@/lib/settings";
import { formatRelative, formatTime, formatTimeRange } from "@/lib/time";
import type { SessionUser } from "@/lib/types";
import { ProgressRing } from "@/ui/components/charts";
import { ListRow, ListSection } from "@/ui/components/List";
import { MoneyText } from "@/ui/components/MoneyText";
import { getTechStats } from "../ops";
import { type Period, rangeText } from "../period";
import { Block, DASH, KpiGrid, pct, plural, StatCard } from "./bits";

/** Tech "My Stats" (SPEC M20 tech dashboard). Only ever the viewer's own numbers. */
export async function TechDashboard({
  user,
  period,
  tz,
}: {
  user: SessionUser;
  period: Period;
  tz: string;
}) {
  const [s, prev, reviewsOn] = await Promise.all([
    getTechStats(user, period),
    getTechStats(user, period.prev),
    isEnabled("reviews"),
  ]);
  const next = s.today.next;
  // The tiles open the jobs (or review requests) behind each number.
  const range = `from=${period.fromKey}&to=${period.toKey}`;
  const jobsOn =
    user.perms.has("jobs.view_all") || user.perms.has("jobs.view_own");
  const completedJobs = jobsOn
    ? `/jobs?mine=1&status=completed,closed&${range}`
    : undefined;
  const progress = s.today.total ? s.today.done / s.today.total : 0;
  const cmp = period.compareLabel;
  const d = (
    cur: number | null,
    p: number | null,
    rate = false,
    goodWhen: "up" | "down" = "up",
  ) => {
    if (cur == null || p == null) return undefined;
    const v = rate
      ? cur - p
      : p === 0
        ? cur === 0
          ? 0
          : null
        : (cur - p) / Math.abs(p);
    if (v == null) return undefined;
    return {
      value: v,
      format: rate
        ? (x: number) => `${(x * 100).toFixed(1)} pts`
        : ("percent" as const),
      goodWhen,
      label: cmp,
    };
  };
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <ListSection header="Today">
        <ListRow
          leading={
            <ProgressRing
              value={progress}
              label="Jobs done today"
              size={36}
              stroke={4}
              tone="green"
            >
              <span className="num text-caption font-semibold">
                {s.today.done}
              </span>
            </ProgressRing>
          }
          title={`${s.today.done} of ${s.today.total} job${s.today.total === 1 ? "" : "s"} done`}
          subtitle={
            s.today.total === 0 ? "Nothing on your schedule today" : undefined
          }
          href="/today"
        />
        {next && (
          <ListRow
            icon={<Navigation size={17} aria-hidden />}
            iconTone="blue"
            title={next.customer ?? next.title ?? next.number}
            subtitle={`Next · ${
              next.windowStart && next.windowEnd
                ? formatTimeRange(next.windowStart, next.windowEnd, tz)
                : next.windowStart
                  ? formatTime(next.windowStart, tz)
                  : next.number
            }`}
            href={`/jobs/${next.id}`}
          />
        )}
      </ListSection>

      <MyEarningsCard userId={user.id} />

      <Block title={`My stats · ${period.label}`}>
        <KpiGrid>
          <StatCard
            label="Jobs completed"
            value={s.completed}
            delta={d(s.completed, prev.completed)}
            href={completedJobs}
          />
          <StatCard
            label="Avg ticket"
            value={
              s.avgTicketCents == null ? (
                DASH
              ) : (
                <MoneyText cents={s.avgTicketCents} compactWhole />
              )
            }
            delta={d(s.avgTicketCents, prev.avgTicketCents)}
            href={completedJobs}
          />
          <StatCard
            label="Close rate"
            value={pct(s.closeRate)}
            delta={d(s.closeRate, prev.closeRate, true)}
            href={`/estimates?tech=${user.id}&from=${period.fromKey}&to=${period.toKey}`}
          />
          <StatCard
            label="Callback rate"
            value={pct(s.callbackRate, 1)}
            delta={d(s.callbackRate, prev.callbackRate, true, "down")}
            footnote={plural(s.callbacks, "callback")}
            // Past and upcoming callback visits on your jobs in the period.
            href={
              jobsOn ? `/jobs?mine=1&callback=1&view=all&${range}` : undefined
            }
          />
          <StatCard
            label="Review clicks"
            value={s.reviewClicks}
            footnote={`of ${plural(s.reviewsSent, "request")} sent`}
            href={
              reviewsOn && user.perms.has("reviews.view")
                ? `/reviews?tech=${user.id}&${range}`
                : undefined
            }
          />
          {s.periodEarningsCents != null && (
            <StatCard
              label="Earned this pay period"
              value={<MoneyText cents={s.periodEarningsCents} compactWhole />}
              href="/pay"
            />
          )}
        </KpiGrid>
        {s.rank && (
          <div className="mt-3 flex items-center gap-3 rounded-card bg-card px-4 py-3">
            <Trophy
              aria-hidden
              size={20}
              className="text-[var(--sys-yellow)]"
            />
            <span className="text-body">
              #{s.rank.position} of {plural(s.rank.of, "tech")} by revenue
            </span>
          </div>
        )}
      </Block>

      <ListSection header="Money with me">
        <ListRow
          icon={<Banknote size={17} aria-hidden />}
          iconTone="green"
          title="Cash and checks on hand"
          subtitle={
            s.cashOldestAt
              ? `Oldest collected ${formatRelative(
                  Math.min(new Date(s.cashOldestAt).getTime(), Date.now()),
                )}`
              : "Nothing to hand in"
          }
          detail={<MoneyText cents={s.cashHeldCents} />}
          href="/pay"
        />
        <ListRow
          icon={<Receipt size={17} aria-hidden />}
          iconTone="orange"
          title="Pending reimbursements"
          subtitle={
            s.pendingReimbursements
              ? `${s.pendingReimbursements} receipt${s.pendingReimbursements === 1 ? "" : "s"} waiting for approval`
              : "All receipts reviewed"
          }
          detail={<MoneyText cents={s.pendingReimbursementsCents} />}
          href="/parts?tab=mine"
        />
      </ListSection>

      {(user.usesCompanyVehicle || user.usesCompanyTools) && (
        <ListSection header="Vehicle and tools">
          {user.usesCompanyVehicle && (
            <AssignedVehicleRow key="vehicle" userId={user.id} />
          )}
          {user.usesCompanyTools && (
            <ToolCustodyRow key="tools" userId={user.id} />
          )}
        </ListSection>
      )}
      <p className="flex items-center justify-center gap-1.5 px-4 text-center text-footnote text-label-3">
        <CalendarCheck aria-hidden size={14} />
        {rangeText(period.fromKey, period.toKey)}
      </p>
    </div>
  );
}
