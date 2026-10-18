import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HeaderActions } from "@/app/(app)/_components/HeaderActions";
import {
  type DisputeAnalytics,
  type DisputeListRow,
  type EfwRow,
  getDisputeAnalytics,
  listDisputes,
  listEarlyFraudWarnings,
  type RateCell,
} from "@/features/disputes/queries";
import { UrlTabs } from "@/features/payments/components/UrlTabs";
import { requireUser } from "@/lib/auth/current";
import { type LinkViewer, personHref } from "@/lib/links";
import { getCompanyTimezone, isEnabled } from "@/lib/settings";
import { formatDate } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListRow, ListSection } from "@/ui/components/List";
import { MoneyText } from "@/ui/components/MoneyText";
import { LargeTitleHeader } from "@/ui/components/NavBar";
import { ReadinessRing } from "@/ui/components/Score";
import { Pill, StatusPill } from "@/ui/components/StatusPill";
import { cx } from "@/ui/cx";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Disputes" };

type Filter = "open" | "closed" | "all";

const pct = (bps: number | null) =>
  bps == null ? "—" : `${(bps / 100).toFixed(2)}%`;

function countdown(r: DisputeListRow) {
  if (r.submittedAt)
    return (
      <Pill tone="blue" size="sm">
        Submitted
      </Pill>
    );
  if (r.hoursLeft == null) return null;
  if (r.hoursLeft < 0)
    return (
      <Pill tone="red" size="sm">
        Past due
      </Pill>
    );
  const days = Math.floor(r.hoursLeft / 24);
  const label = days >= 1 ? `${days}d left` : `${r.hoursLeft}h left`;
  return (
    <Pill tone={r.hoursLeft < 72 ? "red" : "orange"} size="sm">
      {label}
    </Pill>
  );
}

// /disputes (SPEC M10): open disputes with due-date countdowns, plus analytics: the
// dispute rate against the 0.75 % card-network line, by tech, service, source, entry
// mode and reason, and the win rate by readiness band.
export default async function DisputesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser("disputes.view");
  if (!(await isEnabled("chargeback_protection"))) notFound();
  const sp = await searchParams;
  const raw = Array.isArray(sp.status) ? sp.status[0] : sp.status;
  const filter: Filter = raw === "closed" || raw === "all" ? raw : "open";
  const [rows, a, tz, efw] = await Promise.all([
    listDisputes(filter),
    getDisputeAnalytics(90),
    getCompanyTimezone(),
    listEarlyFraudWarnings(),
  ]);

  return (
    <PageTransition>
      <LargeTitleHeader title="Disputes" trailing={<HeaderActions />}>
        <UrlTabs<Filter>
          param="status"
          label="Show disputes"
          value={filter}
          segments={[
            { value: "open", label: "Open" },
            { value: "closed", label: "Closed" },
            { value: "all", label: "All" },
          ]}
        />
      </LargeTitleHeader>
      <Page className="flex flex-col gap-[var(--section-gap)]">
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-6">
          <div className="flex flex-col gap-[var(--section-gap)]">
            {filter === "open" && efw.length > 0 && (
              <EarlyWarnings rows={efw} tz={tz} />
            )}
            {rows.length === 0 ? (
              <div className="list-card">
                <EmptyState
                  icon={<ShieldCheck size={44} strokeWidth={1.6} />}
                  title={filter === "open" ? "No open disputes" : "No disputes"}
                  message="When a customer disputes a card charge, it shows up here with a countdown and a ready-made evidence pack."
                />
              </div>
            ) : (
              <ListSection
                header={
                  filter === "open" ? "Respond before the deadline" : "Disputes"
                }
              >
                {rows.map((r) => (
                  <ListRow
                    key={r.id}
                    href={`/disputes/${r.id}`}
                    leading={
                      <ReadinessRing score={r.readinessAtOpen} size={36} />
                    }
                    title={
                      <span className="flex items-center gap-2">
                        <span className="truncate">{r.customerName}</span>
                        {countdown(r)}
                      </span>
                    }
                    subtitle={`${r.categoryLabel}${r.jobNumber ? ` · ${r.jobNumber}` : ""}${r.dueBy ? ` · due ${formatDate(r.dueBy, tz)}` : ""}`}
                    detail={
                      <span className="flex flex-col items-end gap-0.5">
                        <MoneyText
                          cents={r.amountCents}
                          className="font-semibold text-label"
                        />
                        {filter !== "open" && (
                          <StatusPill
                            kind="dispute"
                            status={r.status}
                            size="sm"
                          />
                        )}
                      </span>
                    }
                  />
                ))}
              </ListSection>
            )}
          </div>
          <Analytics a={a} viewer={user} />
        </div>
      </Page>
    </PageTransition>
  );
}

function RateMeter({ a }: { a: DisputeAnalytics }) {
  const max = Math.max(a.thresholdBps * 2, a.rateBps ?? 0);
  const at = (b: number) => `${Math.min(100, (b / max) * 100)}%`;
  const over = (a.rateBps ?? 0) >= a.thresholdBps;
  return (
    <div className="flex flex-col gap-3 rounded-card bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-footnote uppercase text-label-2">
            Dispute rate · {a.windowDays} days
          </p>
          <p
            className={cx(
              "num text-title1 font-bold",
              over ? "text-danger" : "text-label",
            )}
          >
            {pct(a.rateBps)}
          </p>
        </div>
        <p className="text-right text-footnote text-label-2">
          {a.disputes} of {a.cardPayments} card payments
          <br />
          30 days: {pct(a.rate30Bps)}
        </p>
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: a styled bar with a threshold marker; <meter> can't draw the marker */}
      <div
        className="relative h-2.5 rounded-pill bg-fill-2"
        role="meter"
        aria-label="Dispute rate"
        aria-valuemin={0}
        aria-valuemax={max / 100}
        aria-valuenow={(a.rateBps ?? 0) / 100}
        aria-valuetext={`${pct(a.rateBps)}, limit ${pct(a.thresholdBps)}`}
      >
        <div
          className={cx(
            "h-full rounded-pill transition-[width] duration-500",
            over ? "bg-danger" : "bg-success",
          )}
          style={{ width: at(a.rateBps ?? 0) }}
        />
        <div
          className="absolute -top-1 h-[18px] w-0.5 rounded bg-label"
          style={{ left: at(a.thresholdBps) }}
          aria-hidden
        />
      </div>
      <p className="text-footnote text-label-2">
        {over
          ? `Above the ${pct(a.thresholdBps)} line card networks watch. Review the breakdowns below.`
          : `Below the ${pct(a.thresholdBps)} line card networks watch.`}
      </p>
    </div>
  );
}

function Breakdown({
  title,
  cells,
  hrefFor,
}: {
  title: string;
  cells: RateCell[];
  /** Where a cell leads (by its key); null keeps it plain. */
  hrefFor?: (key: string) => string | null;
}) {
  const top = cells.filter((c) => c.payments > 0).slice(0, 5);
  if (top.length === 0) return null;
  return (
    <ListSection header={title}>
      {top.map((c) => (
        <ListRow
          key={c.key}
          title={c.label}
          subtitle={`${c.disputes} dispute${c.disputes === 1 ? "" : "s"} · ${c.payments} payments`}
          detail={pct(c.rateBps)}
          href={hrefFor?.(c.key) ?? undefined}
        />
      ))}
    </ListSection>
  );
}

function Analytics({ a, viewer }: { a: DisputeAnalytics; viewer: LinkViewer }) {
  return (
    <aside
      aria-label="Dispute analytics"
      className="mt-[var(--section-gap)] flex flex-col gap-[var(--section-gap)] lg:mt-0"
    >
      <RateMeter a={a} />
      <ListSection
        header="Win rate by readiness"
        footer="Jobs documented well (photos, signatures, receipts) win more disputes."
      >
        {a.winByReadiness.map((b) => (
          <ListRow
            key={b.band}
            title={`Readiness ${b.label}`}
            subtitle={`${b.won} won · ${b.lost} lost`}
            detail={b.winRate == null ? "—" : `${Math.round(b.winRate * 100)}%`}
          />
        ))}
      </ListSection>
      {a.byReason.length > 0 && (
        <ListSection header="By reason">
          {a.byReason.map((r) => (
            <ListRow key={r.key} title={r.label} detail={r.count} />
          ))}
        </ListSection>
      )}
      <Breakdown
        title="By tech"
        cells={a.byTech}
        // "none" groups online payments and jobs without a lead tech.
        hrefFor={(key) => (key === "none" ? null : personHref(viewer, key))}
      />
      <Breakdown title="By entry mode" cells={a.byEntryMode} />
      <Breakdown title="By service" cells={a.byService} />
      <Breakdown title="By lead source" cells={a.bySource} />
    </aside>
  );
}

function EarlyWarnings({ rows, tz }: { rows: EfwRow[]; tz: string }) {
  return (
    <ListSection
      header="Early fraud warnings"
      footer="The card network reported possible fraud before any dispute. When the charge is small, refunding now costs less than the dispute fee and keeps your dispute rate down."
    >
      {rows.map((r) => (
        <ListRow
          key={r.paymentId}
          href={r.jobId ? `/jobs/${r.jobId}?tab=invoice` : undefined}
          title={
            <span className="flex items-center gap-2">
              <span className="truncate">{r.customerName}</span>
              {r.suggestRefund ? (
                <Pill tone="orange" size="sm">
                  Refund suggested
                </Pill>
              ) : r.refunded ? (
                <Pill tone="gray" size="sm">
                  Refunded
                </Pill>
              ) : r.disputed ? (
                <Pill tone="red" size="sm">
                  Disputed
                </Pill>
              ) : null}
            </span>
          }
          subtitle={`${formatDate(r.at, tz)}${r.jobNumber ? ` · ${r.jobNumber}` : ""}${r.fraudType ? ` · ${r.fraudType.replace(/_/g, " ")}` : ""}`}
          detail={
            <MoneyText
              cents={r.amountCents}
              className="font-semibold text-label"
            />
          }
        />
      ))}
    </ListSection>
  );
}
