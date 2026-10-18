import { AlertTriangle, CircleCheck, CreditCard, Undo2 } from "lucide-react";
import type { Metadata } from "next";
import { HeaderActions } from "@/app/(app)/_components/HeaderActions";
import { MarkRefundPaidButton } from "@/features/payments/components/PaymentActions";
import { UrlTabs } from "@/features/payments/components/UrlTabs";
import { VerifyList } from "@/features/payments/components/VerifyList";
import {
  getPaymentsSummary,
  getReconciliation,
  listPayments,
  listRefunds,
  type PaymentsTab,
} from "@/features/payments/queries";
import { requireUser } from "@/lib/auth/current";
import { formatMoney } from "@/lib/money";
import { getCompanyTimezone, getSettings } from "@/lib/settings";
import { formatDate, formatDateKey, formatDateTime } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { Button } from "@/ui/components/Button";
import { Chip, ChipRow } from "@/ui/components/Chip";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListRow, ListSection } from "@/ui/components/List";
import { MoneyText } from "@/ui/components/MoneyText";
import { LargeTitleHeader } from "@/ui/components/NavBar";
import { StatCard } from "@/ui/components/StatCard";
import { StatusPill } from "@/ui/components/StatusPill";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Payments" };

const TABS: PaymentsTab[] = ["all", "unverified", "reconciliation", "refunds"];
const METHODS = ["card", "cash", "check", "zelle", "venmo", "other"];
const METHOD_LABEL: Record<string, string> = {
  card: "Card",
  cash: "Cash",
  check: "Check",
  zelle: "Zelle",
  venmo: "Venmo",
  other: "Other",
};

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) || undefined;

function href(sp: SP, patch: Record<string, string | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const x = one(v);
    if (x && k !== "cursor") q.set(k, x);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v) q.set(k, v);
    else q.delete(k);
  }
  const s = q.toString();
  return s ? `/payments?${s}` : "/payments";
}

// /payments (SPEC M09, BUILD_PLAN §9 B4): ledger, unverified manual payments with
// Verify, reconciliation (card settlements vs payouts, flagged items) and refunds.
export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const user = await requireUser("payments.view_all");
  const sp = await searchParams;
  const tabRaw = one(sp.tab) as PaymentsTab | undefined;
  const tab: PaymentsTab = tabRaw && TABS.includes(tabRaw) ? tabRaw : "all";
  const method = one(sp.method);
  const [summary, tz, s] = await Promise.all([
    getPaymentsSummary(),
    getCompanyTimezone(),
    getSettings(),
  ]);

  return (
    <PageTransition>
      <LargeTitleHeader title="Payments" trailing={<HeaderActions />}>
        <UrlTabs<PaymentsTab>
          label="Payments view"
          value={tab}
          segments={[
            { value: "all", label: "All" },
            {
              value: "unverified",
              label: summary.unverifiedCount
                ? `Verify ${summary.unverifiedCount}`
                : "Verify",
            },
            { value: "reconciliation", label: "Reconcile" },
            {
              value: "refunds",
              label: summary.refundsDue
                ? `Refunds ${summary.refundsDue}`
                : "Refunds",
            },
          ]}
        />
      </LargeTitleHeader>
      <Page className="flex flex-col gap-[var(--section-gap)]">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard
            label="Today"
            value={<MoneyText cents={summary.todayCents} compactWhole />}
          />
          <StatCard
            label="Last 7 days"
            value={<MoneyText cents={summary.weekCents} compactWhole />}
          />
          <StatCard
            label="Unverified"
            value={summary.unverifiedCount}
            footnote={
              summary.unverifiedStale
                ? `${summary.unverifiedStale} older than ${s.payments.unverified_alert_days} days`
                : "All recent"
            }
            href="/payments?tab=unverified"
          />
          <StatCard
            label="Card fees this month"
            value={
              <MoneyText cents={summary.cardFeesMonthCents} compactWhole />
            }
          />
        </div>

        {tab === "all" && <AllTab sp={sp} tz={tz} method={method} />}
        {tab === "unverified" && (
          <UnverifiedTab
            tz={tz}
            canVerify={user.perms.has("payments.verify_manual")}
            days={s.payments.unverified_alert_days}
          />
        )}
        {tab === "reconciliation" && <ReconTab />}
        {tab === "refunds" && (
          <RefundsTab tz={tz} canRefund={user.perms.has("payments.refund")} />
        )}
      </Page>
    </PageTransition>
  );
}

async function AllTab({
  sp,
  tz,
  method,
}: {
  sp: SP;
  tz: string;
  method: string | undefined;
}) {
  const { rows, nextCursor } = await listPayments({
    tab: "all",
    method,
    tech: one(sp.tech),
    from: one(sp.from),
    to: one(sp.to),
    cursor: one(sp.cursor),
  });
  return (
    <>
      <ChipRow label="Filter by method">
        <Chip href={href(sp, { method: undefined })} selected={!method} replace>
          All methods
        </Chip>
        {METHODS.map((m) => (
          <Chip
            key={m}
            href={href(sp, { method: m })}
            selected={method === m}
            replace
          >
            {METHOD_LABEL[m]}
          </Chip>
        ))}
      </ChipRow>
      {rows.length === 0 ? (
        <div className="list-card">
          <EmptyState
            icon={<CreditCard size={44} strokeWidth={1.6} />}
            title="No payments"
            message={
              method
                ? `No ${METHOD_LABEL[method]?.toLowerCase() ?? method} payments in this range.`
                : "Payments collected in the field and online show up here."
            }
          />
        </div>
      ) : (
        <ListSection header={one(sp.cursor) ? "Earlier" : "Recent"}>
          {rows.map((p) => (
            <ListRow
              key={p.id}
              title={
                <>
                  {p.customerName}
                  {p.kind === "deposit" ? " · deposit" : ""}
                </>
              }
              subtitle={`${p.methodLabel}${p.reference ? ` #${p.reference}` : ""} · ${formatDateTime(p.at, tz)}${p.jobNumber ? ` · ${p.jobNumber}` : ""}${p.collectedByName ? ` · ${p.collectedByName}` : ""}`}
              detail={
                <span className="flex flex-col items-end gap-0.5">
                  <MoneyText
                    cents={p.amountCents + p.tipCents}
                    className="font-semibold text-label"
                  />
                  {(p.needsVerify || p.status !== "succeeded") && (
                    <StatusPill
                      kind="payment"
                      status={p.needsVerify ? "unverified" : p.status}
                      size="sm"
                    />
                  )}
                </span>
              }
              href={p.jobId ? `/jobs/${p.jobId}?tab=invoice` : undefined}
            />
          ))}
        </ListSection>
      )}
      {nextCursor && (
        <Button
          variant="gray"
          href={href(sp, { cursor: nextCursor })}
          className="self-center"
        >
          Show earlier payments
        </Button>
      )}
    </>
  );
}

async function UnverifiedTab({
  tz,
  canVerify,
  days,
}: {
  tz: string;
  canVerify: boolean;
  days: number;
}) {
  const { rows } = await listPayments({ tab: "unverified" });
  if (rows.length === 0)
    return (
      <div className="list-card">
        <EmptyState
          icon={<CircleCheck size={44} strokeWidth={1.6} />}
          title="All verified"
          message="Every cash, check, Zelle and Venmo payment has been matched in the bank."
        />
      </div>
    );
  return (
    <section className="flex flex-col gap-2">
      <p className="px-4 text-footnote text-label-2">
        Check each payment against the bank or the Zelle/Venmo app before
        marking it verified. Screenshots can be faked. Items older than {days}{" "}
        days are flagged.
      </p>
      <VerifyList
        rows={rows}
        canVerify={canVerify}
        dates={Object.fromEntries(
          rows.map((r) => [r.id, formatDate(r.at, tz)]),
        )}
      />
    </section>
  );
}

async function ReconTab() {
  const { days, issues } = await getReconciliation(14);
  return (
    <>
      <ListSection
        header="Needs attention"
        footer="Card payments without a processor reference or fee, invoices marked paid that don't add up, stale unverified manual payments and uncaptured card holds."
      >
        {issues.length === 0 ? (
          <ListRow
            icon={<CircleCheck size={17} />}
            iconTone="green"
            title="Everything matches"
          />
        ) : (
          issues.map((i, n) => (
            <ListRow
              // biome-ignore lint/suspicious/noArrayIndexKey: issues have no id
              key={n}
              icon={<AlertTriangle size={17} />}
              iconTone="orange"
              title={i.label}
              subtitle={i.detail}
              detail={<MoneyText cents={i.amountCents} />}
              href={i.href}
              multiline
            />
          ))
        )}
      </ListSection>
      <ListSection
        header="Card settlements, last 14 days"
        footer="Expected payout = card payments − processor fees − refunds. Compare each day with the deposit in your bank."
      >
        {days.length === 0 ? (
          <ListRow title="No card payments in this window" />
        ) : (
          days.map((d) => (
            <ListRow
              key={d.day}
              title={formatDateKey(d.day, "en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
              subtitle={`${d.count} payment${d.count === 1 ? "" : "s"} · ${formatMoney(d.grossCents)} gross · ${formatMoney(d.feeCents)} fees${d.refundCents ? ` · ${formatMoney(d.refundCents)} refunded` : ""}${d.missingFee ? ` · ${d.missingFee} fee estimate${d.missingFee === 1 ? "" : "s"}` : ""}`}
              detail={
                <MoneyText
                  cents={d.netCents}
                  className="font-semibold text-label"
                />
              }
              multiline
            />
          ))
        )}
      </ListSection>
    </>
  );
}

async function RefundsTab({
  tz,
  canRefund,
}: {
  tz: string;
  canRefund: boolean;
}) {
  const rows = await listRefunds();
  if (rows.length === 0)
    return (
      <div className="list-card">
        <EmptyState
          icon={<Undo2 size={44} strokeWidth={1.6} />}
          title="No refunds"
          message="Refunds and promised refunds show up here, with reminders before they're late."
        />
      </div>
    );
  const open = rows.filter((r) => ["scheduled", "pending"].includes(r.status));
  const done = rows.filter((r) => !["scheduled", "pending"].includes(r.status));
  const row = (r: (typeof rows)[number]) => (
    <div key={r.id} className="list-row flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-body">
          {r.customerName}
          {r.jobNumber ? ` · ${r.jobNumber}` : ""}
        </p>
        <p className="truncate text-footnote text-label-2">
          {r.reason === "dispute_lost" ? "Lost dispute" : r.reason} ·{" "}
          {r.methodLabel}
          {r.dueAt
            ? ` · ${r.overdue ? "was due" : "due"} ${formatDate(r.dueAt, tz)}`
            : ` · ${formatDate(r.completedAt ?? r.createdAt, tz)}`}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <MoneyText cents={r.amountCents} className="font-semibold" />
        {r.overdue ? (
          <StatusPill kind="refund" status="failed" label="Overdue" size="sm" />
        ) : (
          <StatusPill kind="refund" status={r.status} size="sm" />
        )}
      </div>
      {canRefund && ["scheduled", "pending"].includes(r.status) && (
        <MarkRefundPaidButton refundId={r.id} />
      )}
    </div>
  );
  return (
    <>
      {open.length > 0 && (
        <ListSection
          header="Promised and pending"
          footer="Pay these back by the original method on time: a late refund is the top cause of 'credit not processed' disputes."
        >
          {open.map(row)}
        </ListSection>
      )}
      {done.length > 0 && (
        <ListSection header="Completed">{done.map(row)}</ListSection>
      )}
    </>
  );
}
