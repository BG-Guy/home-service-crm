import { Download } from "lucide-react";
import Link from "next/link";
import { getCustodyBalances } from "@/features/payroll/api";
import { listUsers } from "@/features/team/api";
import { FleetSummaryCard } from "@/features/vehicles/slots";
import { isEnabled } from "@/lib/settings";
import { formatDateKey, formatRelative } from "@/lib/time";
import type { SessionUser } from "@/lib/types";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import {
  BarChart,
  DonutChart,
  LineChart,
  Sparkline,
} from "@/ui/components/charts";
import { ListRow, ListSection } from "@/ui/components/List";
import { MoneyText } from "@/ui/components/MoneyText";
import {
  getAdminKpis,
  getAnomalies,
  getArAging,
  getCancelBreakdown,
  getDisputeStats,
  getLeadSourceRoi,
  getRevenueSeries,
  getTechLeaderboard,
  getUnsoldEstimates,
} from "../kpis";
import { AGING_BUCKETS } from "../math";
import { type Period, periodQuery, rangeQuery } from "../period";
import { AnomalyCard } from "./AnomalyCard";
import {
  Block,
  Card,
  DASH,
  delta,
  KpiGrid,
  minutes,
  money,
  pct,
  plural,
  StatCard,
} from "./bits";
import { Leaderboard } from "./Leaderboard";
import { SourceRoi } from "./SourceRoi";

const CANCEL_LABELS: Record<string, string> = {
  customer_cancelled: "Customer cancelled",
  customer_no_show: "No-show",
  no_access: "No access",
  price: "Price",
  duplicate: "Duplicate",
  tech_unavailable: "Tech unavailable",
  weather: "Weather",
  other: "Other",
};

/** Admin dashboard (SPEC M20): every KPI with Δ vs the previous period and drill-downs. */
export async function AdminDashboard({
  user,
  period,
  tz,
}: {
  user: SessionUser;
  period: Period;
  tz: string;
}) {
  const now = new Date();
  const rq = rangeQuery(period);
  const [
    k,
    kp,
    series,
    ar,
    unsold,
    disputes,
    cancels,
    roi,
    board,
    anomalies,
    techs,
  ] = await Promise.all([
    getAdminKpis(period),
    getAdminKpis(period.prev),
    getRevenueSeries(period, tz),
    getArAging(now),
    getUnsoldEstimates(now),
    getDisputeStats(now),
    getCancelBreakdown(period),
    getLeadSourceRoi(period),
    user.perms.has("insights.view_team")
      ? getTechLeaderboard(period)
      : Promise.resolve([]),
    getAnomalies(now, tz),
    listUsers().then((u) => u.filter((x) => x.baseRole === "tech")),
  ]);
  const fleetOn = await isEnabled("vehicles");
  const custody = techs.length
    ? await getCustodyBalances(techs.map((t) => t.id)).catch(
        () => ({}) as Record<string, never>,
      )
    : {};
  const held = techs
    .map((t) => ({
      t,
      c: (
        custody as Record<string, { heldCents: number; oldestAt: Date | null }>
      )[t.id],
    }))
    .filter((x) => (x.c?.heldCents ?? 0) > 0)
    .sort((a, b) => (b.c?.heldCents ?? 0) - (a.c?.heldCents ?? 0));
  const heldTotal = held.reduce((a, x) => a + (x.c?.heldCents ?? 0), 0);
  const cmp = period.compareLabel;
  const showSeries = series.length > 1;
  const disputeAlert = (disputes.rate30 ?? 0) >= 0.0075;
  const canExport = user.perms.has("reports.export");
  const pq = periodQuery(period);

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {disputeAlert && (
        <Banner tone="error" title="Dispute rate above 0.75%">
          {pct(disputes.rate30, 2)} of card payments in the last 30 days were
          disputed. Card networks start monitoring programs near 1%.{" "}
          <Link href="/disputes" className="font-semibold underline">
            Review disputes
          </Link>
        </Banner>
      )}

      <Block
        title="Money"
        trailing={
          canExport ? (
            <Button
              variant="plain"
              size="sm"
              href={`/insights/export?report=kpis&${pq}`}
              transition="none"
              prefetch={false}
              icon={<Download aria-hidden size={15} />}
            >
              CSV
            </Button>
          ) : undefined
        }
      >
        <KpiGrid>
          <StatCard
            className="col-span-2"
            label="Collected revenue"
            value={<MoneyText cents={k.collectedCents} compactWhole />}
            delta={delta(k.collectedCents, kp.collectedCents, cmp)}
            footnote={
              k.refundedCents
                ? `After ${money(k.refundedCents)} refunds · tips excluded`
                : "Tips excluded"
            }
            chart={
              showSeries ? (
                <Sparkline
                  values={series.map((s) => s.cents)}
                  label={`Collected revenue per day, ${period.label}`}
                  tone="green"
                />
              ) : undefined
            }
            href={`/payments?${rq}`}
          />
          <StatCard
            label="Invoiced revenue"
            value={<MoneyText cents={k.invoicedCents} compactWhole />}
            delta={delta(k.invoicedCents, kp.invoicedCents, cmp)}
            footnote="Before tax, after discounts"
            href={`/invoices?${rq}`}
          />
          <StatCard
            label="Avg ticket"
            value={
              k.avgTicketCents == null ? (
                DASH
              ) : (
                <MoneyText cents={k.avgTicketCents} compactWhole />
              )
            }
            delta={delta(k.avgTicketCents, kp.avgTicketCents, cmp)}
            href={`/invoices?${rq}`}
          />
          <StatCard
            label="Jobs completed"
            value={k.jobsCompleted}
            delta={delta(k.jobsCompleted, kp.jobsCompleted, cmp)}
            href={`/jobs?status=completed,closed&${rq}`}
          />
          <StatCard
            label="Gross margin"
            value={pct(k.grossMarginPct)}
            delta={delta(k.grossMarginPct, kp.grossMarginPct, cmp, {
              rate: true,
            })}
            footnote="After parts, fees, commission, reimbursements"
            href={`/jobs?status=completed,closed&${rq}`}
          />
          <StatCard
            label="Company net per job"
            value={
              k.companyNetPerJobCents == null ? (
                DASH
              ) : (
                <MoneyText cents={k.companyNetPerJobCents} compactWhole />
              )
            }
            delta={delta(
              k.companyNetPerJobCents,
              kp.companyNetPerJobCents,
              cmp,
            )}
            href={`/jobs?status=completed,closed&${rq}`}
          />
          <StatCard
            label="Payroll cost"
            value={pct(k.payrollCostPct)}
            delta={delta(k.payrollCostPct, kp.payrollCostPct, cmp, {
              rate: true,
              goodWhen: "down",
            })}
            footnote={`${money(k.techEarningsCents)} commission, spiffs, top-ups`}
            href="/pay/settlements"
          />
        </KpiGrid>
      </Block>

      {showSeries && (
        <Block title="Collected per day">
          <Card>
            <LineChart
              title={`Collected revenue per day, ${period.label}`}
              labels={series.map((s) =>
                formatDateKey(s.day, "en-US", {
                  month: "short",
                  day: "numeric",
                }),
              )}
              series={[
                {
                  name: "Collected",
                  values: series.map((s) => s.cents),
                  tone: "green",
                },
              ]}
              format="money"
              area
            />
          </Card>
        </Block>
      )}

      <Block title="Receivables">
        <div className="grid gap-3 lg:grid-cols-2">
          <StatCard
            label="AR outstanding"
            value={<MoneyText cents={ar.totalCents} compactWhole />}
            footnote={`${ar.count} open invoice${ar.count === 1 ? "" : "s"}${ar.overdueCount ? ` · ${money(ar.overdueCents)} overdue` : ""}`}
            href="/invoices?status=issued,partially_paid"
          />
          <Card>
            <BarChart
              title="AR aging (days since issued)"
              format="money"
              orientation="horizontal"
              data={AGING_BUCKETS.map((b) => ({
                label: `${b} days`,
                value: ar.buckets[b].cents,
                tone:
                  b === "0-30"
                    ? "blue"
                    : b === "31-60"
                      ? "yellow"
                      : b === "61-90"
                        ? "orange"
                        : "red",
              }))}
            />
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-footnote">
              {AGING_BUCKETS.map((b) => (
                <Link
                  key={b}
                  href={`/invoices?aging=${b}`}
                  className="text-accent-text"
                >
                  {b} ({ar.buckets[b].count})
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </Block>

      <Block title="Sales">
        <KpiGrid>
          <StatCard
            label="Estimate close rate"
            value={pct(k.closeRate)}
            delta={delta(k.closeRate, kp.closeRate, cmp, { rate: true })}
            footnote={`${k.estimatesApproved} of ${k.estimatesDecided} decided`}
            href={`/estimates?${rq}`}
          />
          <StatCard
            label="Unsold estimates"
            value={<MoneyText cents={unsold.cents} compactWhole />}
            footnote={`${unsold.count} open · best option`}
            href="/estimates?unsold=1"
          />
          <StatCard
            label="Lead → booked"
            value={pct(k.leadBookedRate)}
            delta={delta(k.leadBookedRate, kp.leadBookedRate, cmp, {
              rate: true,
            })}
            footnote={`${k.leadsBooked} of ${plural(k.leads, "lead")}`}
            href={`/leads?${rq}`}
          />
          <StatCard
            label="Median speed to lead"
            value={minutes(k.medianSpeedMin)}
            delta={delta(k.medianSpeedMin, kp.medianSpeedMin, cmp, {
              goodWhen: "down",
            })}
            footnote={`${pct(k.contacted5Rate)} contacted < 5 min`}
            href={`/leads?filter=breached&${rq}`}
          />
        </KpiGrid>
      </Block>

      <Block title="Lead sources">
        <SourceRoi
          rows={roi}
          rq={rq}
          exportHref={
            canExport ? `/insights/export?report=sources&${pq}` : null
          }
        />
      </Block>

      <Block title="Quality">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <KpiGrid className="sm:grid-cols-2 xl:grid-cols-3">
            <StatCard
              label="Callback rate"
              value={pct(k.callbackRate, 1)}
              delta={delta(k.callbackRate, kp.callbackRate, cmp, {
                rate: true,
                goodWhen: "down",
              })}
              footnote={`${plural(k.callbacks, "callback")} · target ≈ 2%`}
              href={`/jobs?callback=1&${rq}`}
            />
            <StatCard
              label="Cancellation rate"
              value={pct(k.cancelRate, 1)}
              delta={delta(k.cancelRate, kp.cancelRate, cmp, {
                rate: true,
                goodWhen: "down",
              })}
              footnote={`${k.cancelled} of ${k.jobsScheduled} scheduled`}
              href={`/jobs?status=cancelled&${rq}`}
            />
            <StatCard
              label="Cancelled after arrival"
              value={k.cancelledAfterArrival}
              delta={delta(
                k.cancelledAfterArrival,
                kp.cancelledAfterArrival,
                cmp,
                { goodWhen: "down" },
              )}
              href={`/jobs?cancelledAfterArrival=1&${rq}`}
            />
            <StatCard
              label="Customer no-shows"
              value={pct(k.noShowRate, 1)}
              footnote={`${k.noShows} no-show${k.noShows === 1 ? "" : "s"}`}
              href={`/jobs?status=cancelled&${rq}`}
            />
            <StatCard
              label="Review link clicks"
              value={pct(k.reviewClickRate)}
              delta={delta(k.reviewClickRate, kp.reviewClickRate, cmp, {
                rate: true,
              })}
              footnote={`${k.reviewsClicked} of ${plural(k.reviewsSent, "request")}`}
              href={`/reviews?${rq}`}
            />
          </KpiGrid>
          {cancels.length > 0 && (
            <Card>
              <h3 className="mb-3 text-subhead font-semibold">
                Cancellations by reason
              </h3>
              <DonutChart
                title="Cancellations by reason"
                // The legend drops under the ring when the card is narrow, so
                // reason names never truncate.
                className="justify-center [&>ul]:min-w-[12rem]"
                segments={foldTop(
                  cancels.map((c) => ({
                    label: CANCEL_LABELS[c.reason] ?? c.reason,
                    value: c.count,
                  })),
                )}
              />
            </Card>
          )}
        </div>
      </Block>

      <Block title="Risk">
        <KpiGrid>
          <StatCard
            label="Dispute rate · 30 d"
            value={pct(disputes.rate30, 2)}
            footnote={`${disputes.disputes30} of ${disputes.cardPayments30} card payments · alert at 0.75%`}
            href="/disputes"
          />
          <StatCard
            label="Dispute rate · 90 d"
            value={pct(disputes.rate90, 2)}
            footnote={`${disputes.disputes90} of ${disputes.cardPayments90} card payments`}
            href="/disputes"
          />
          <StatCard
            label="Dispute win rate"
            value={pct(disputes.winRate)}
            footnote={`${disputes.won} won of ${disputes.closed} closed · ${disputes.open} open`}
            href="/disputes"
          />
          <StatCard
            label="Cash held by techs"
            value={<MoneyText cents={heldTotal} compactWhole />}
            footnote={
              held.length
                ? `${held.length} tech${held.length === 1 ? "" : "s"} holding`
                : "Nothing outstanding"
            }
            href={`/payments?method=cash&${rq}`}
          />
        </KpiGrid>
        {held.length > 0 && (
          <ListSection className="mt-3">
            {held.map(({ t, c }) => (
              <ListRow
                key={t.id}
                title={t.name}
                subtitle={
                  c?.oldestAt
                    ? `Oldest ${formatRelative(
                        Math.min(new Date(c.oldestAt).getTime(), now.getTime()),
                        now,
                      )}`
                    : undefined
                }
                detail={<MoneyText cents={c?.heldCents ?? 0} />}
                href={`/team/${t.id}`}
              />
            ))}
          </ListSection>
        )}
      </Block>

      {fleetOn && (
        <Block title="Fleet">
          <FleetSummaryCard from={period.fromKey} to={period.toKey} />
        </Block>
      )}

      {board.length > 0 && (
        <Block
          id="leaderboard"
          title="Tech leaderboard"
          trailing={
            canExport ? (
              <Link
                href={`/insights/export?report=leaderboard&${pq}`}
                prefetch={false}
                className="text-accent-text"
              >
                CSV
              </Link>
            ) : undefined
          }
        >
          <Leaderboard rows={board} rq={rq} />
        </Block>
      )}

      <Block title={`Anomaly report · last ${anomalies.windowDays} days`}>
        <AnomalyCard items={anomalies.items} />
      </Block>
    </div>
  );
}

function foldTop<T extends { label: string; value: number }>(
  rows: T[],
  max = 5,
) {
  if (rows.length <= max) return rows;
  const top = rows.slice(0, max - 1);
  const rest = rows.slice(max - 1).reduce((a, r) => a + r.value, 0);
  return [...top, { label: "Other", value: rest }];
}
