import {
  Banknote,
  BarChart3,
  FileSpreadsheet,
  Landmark,
  Receipt,
  ShieldAlert,
  Users,
} from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HeaderActions } from "@/app/(app)/_components/HeaderActions";
import { ConfirmRemittanceButtons } from "@/features/payroll/components/PayActions";
import { SegmentLinks } from "@/features/payroll/components/SegmentLinks";
import {
  ClosePeriodButton,
  NachaExportButton,
} from "@/features/payroll/components/SettlementAdmin";
import {
  getPayrollReports,
  listPayable,
  listPayPeriods,
  listSettlementsForAdmin,
} from "@/features/payroll/queries";
import { requireUser } from "@/lib/auth/current";
import { personHref } from "@/lib/links";
import { formatMoney } from "@/lib/money";
import { getCompanyTimezone, getSettings, isEnabled } from "@/lib/settings";
import { dateKey, formatDateKey, formatDateTime } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { Button } from "@/ui/components/Button";
import { Chip, ChipRow } from "@/ui/components/Chip";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListRow, ListSection } from "@/ui/components/List";
import { LargeTitleHeader } from "@/ui/components/NavBar";
import { StatCard } from "@/ui/components/StatCard";
import { Pill, StatusPill } from "@/ui/components/StatusPill";
import { TextLink } from "@/ui/components/TextLink";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Payroll" };

const m = (c: number) => formatMoney(c);
type View = "statements" | "cash" | "reports";
const STATUSES = ["tech_review", "approved", "paid", "locked"] as const;
const STATUS_LABEL: Record<string, string> = {
  tech_review: "In review",
  approved: "Approved",
  paid: "Paid",
  locked: "Locked",
};

export default async function SettlementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser("payroll.view_all");
  if (!(await isEnabled("payroll"))) notFound();
  const sp = await searchParams;
  const view: View =
    sp.view === "cash" || sp.view === "reports" ? sp.view : "statements";
  const periods = await listPayPeriods();
  const tz = await getCompanyTimezone();
  const today = dateKey(new Date(), tz);
  const periodId = typeof sp.period === "string" ? sp.period : null;
  const status =
    typeof sp.status === "string" &&
    (STATUSES as readonly string[]).includes(sp.status)
      ? sp.status
      : null;
  const settings = await getSettings();
  const q = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const next: Record<string, string | null> = {
      view: view === "statements" ? null : view,
      period: periodId,
      status,
      ...patch,
    };
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    return `/pay/settlements${p.size ? `?${p}` : ""}`;
  };
  const dueToClose = periods.filter(
    (p) => p.status === "open" && p.endsOn < today,
  );

  let body: React.ReactNode = null;
  if (view === "statements") {
    const rows = await listSettlementsForAdmin({ periodId, status });
    const payable = user.perms.has("payroll.payout") ? await listPayable() : [];
    body = (
      <>
        <div className="flex flex-col gap-2">
          <ChipRow label="Pay period">
            <Chip href={q({ period: null })} replace selected={!periodId}>
              All
            </Chip>
            {periods.slice(0, 10).map((p) => (
              <Chip
                key={p.id}
                href={q({ period: p.id })}
                replace
                selected={periodId === p.id}
              >
                {formatDateKey(p.startsOn).replace(/, \d{4}$/, "")}
                {p.status === "open" ? " · open" : ""}
              </Chip>
            ))}
          </ChipRow>
          <ChipRow label="Status">
            <Chip href={q({ status: null })} replace selected={!status}>
              Any status
            </Chip>
            {STATUSES.map((s) => (
              <Chip
                key={s}
                href={q({ status: s })}
                replace
                selected={status === s}
              >
                {STATUS_LABEL[s]}
              </Chip>
            ))}
          </ChipRow>
        </div>
        {dueToClose.length > 0 && (
          <ListSection
            header="Ready to close"
            footer={`Periods close automatically ${settings.payroll.close_delay_hours} h after they end.`}
          >
            {dueToClose.map((p) => (
              <ListRow
                key={p.id}
                title={`${formatDateKey(p.startsOn)} – ${formatDateKey(p.endsOn)}`}
                accessory={
                  user.perms.has("payroll.manage") ? (
                    <ClosePeriodButton
                      payPeriodId={p.id}
                      label={`week of ${formatDateKey(p.startsOn)}`}
                    />
                  ) : (
                    "none"
                  )
                }
              />
            ))}
          </ListSection>
        )}
        {user.perms.has("payroll.payout") && payable.length > 0 && (
          <section className="list-card flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-headline">
                {m(payable.reduce((a, p) => a + p.owedCents, 0))} approved and
                unpaid
              </p>
              <p className="text-subhead text-label-2">
                {payable.length} statement{payable.length === 1 ? "" : "s"} ·
                record each payout, or build one direct-deposit file.
              </p>
            </div>
            <NachaExportButton
              enabled={settings.payroll.nacha_enabled}
              candidates={payable.map((p) => ({
                id: p.id,
                name: p.name,
                owedCents: p.owedCents,
                hasBank: p.hasBank,
                bankHold: p.bankHold,
              }))}
            />
          </section>
        )}
        {rows.length === 0 ? (
          <div className="list-card">
            <EmptyState
              icon={<Users size={44} strokeWidth={1.5} />}
              title="No statements here"
              message="Statements are drafted for every tech when a pay period closes."
            />
          </div>
        ) : (
          <ListSection
            trailing={
              <Button
                href={`/pay/settlements/export${periodId ? `?period=${periodId}` : ""}`}
                size="sm"
                variant="plain"
                icon={<FileSpreadsheet size={16} aria-hidden />}
              >
                CSV for Gusto / ADP
              </Button>
            }
          >
            {rows.map((r) => (
              <ListRow
                key={r.id}
                href={`/pay/settlements/${r.id}`}
                multiline
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.name}</span>
                    <span className="text-footnote text-label-2">
                      {r.workerType === "w2" ? "W-2" : "1099"}
                    </span>
                  </span>
                }
                subtitle={
                  <span className="flex flex-wrap items-center gap-1.5">
                    <StatusPill kind="settlement" status={r.status} size="sm" />
                    <span>{formatDateKey(r.startsOn)}</span>
                    {r.openFlags > 0 && (
                      <Pill size="sm" tone="red">
                        {r.openFlags} flag{r.openFlags === 1 ? "" : "s"}
                      </Pill>
                    )}
                    {r.pendingReviewCount > 0 && (
                      <Pill size="sm" tone="orange">
                        {r.pendingReviewCount} to review
                      </Pill>
                    )}
                    {!r.acknowledged && r.status !== "draft" && (
                      <Pill size="sm" tone="gray">
                        Not acknowledged
                      </Pill>
                    )}
                    {r.bankHold && (
                      <Pill size="sm" tone="red">
                        Bank changed
                      </Pill>
                    )}
                  </span>
                }
                detail={
                  <span className="flex flex-col items-end">
                    <span
                      className={`num font-semibold ${r.closingCents < 0 ? "text-danger" : "text-label"}`}
                    >
                      {m(r.closingCents)}
                    </span>
                    {r.owedCents > 0 && r.status === "approved" && (
                      <span className="text-footnote text-warning">
                        owed {m(r.owedCents)}
                      </span>
                    )}
                  </span>
                }
              />
            ))}
          </ListSection>
        )}
      </>
    );
  } else {
    const rep = await getPayrollReports();
    body =
      view === "cash" ? (
        <>
          <ListSection
            header="Cash & checks held by techs"
            footer="Custody = cash and checks collected − confirmed hand-ins − cash already deducted from pay."
          >
            {rep.cash.length === 0 ? (
              <ListRow
                icon={<Banknote size={18} aria-hidden />}
                iconTone="green"
                title="Nobody is holding cash"
              />
            ) : (
              rep.cash.map((c) => {
                const days = c.oldestAt
                  ? Math.floor(
                      (Date.now() - new Date(c.oldestAt).getTime()) /
                        86_400_000,
                    )
                  : 0;
                return (
                  <ListRow
                    key={c.userId}
                    icon={<Banknote size={18} aria-hidden />}
                    iconTone={days > 3 ? "red" : "orange"}
                    title={c.name}
                    subtitle={`Cash ${m(c.cashHeldCents ?? 0)} · checks ${m(c.checksHeldCents ?? 0)}${days ? ` · oldest ${days} d` : ""}`}
                    detail={
                      <span className="num font-semibold">
                        {m(c.heldCents ?? 0)}
                      </span>
                    }
                    href={personHref(user, c.userId) ?? undefined}
                  />
                );
              })
            )}
          </ListSection>
          <ListSection header="Hand-ins to confirm">
            {rep.pendingRemits.length === 0 ? (
              <ListRow title="Nothing waiting" />
            ) : (
              rep.pendingRemits.map((r) => (
                <ListRow
                  key={r.id}
                  // The confirm buttons are the accessory: only the name links.
                  title={
                    <>
                      <TextLink href={personHref(user, r.userId)}>
                        {r.name}
                      </TextLink>
                      {` · ${m(r.amount)}`}
                    </>
                  }
                  subtitle={`${r.method === "bank_deposit" ? "Bank deposit" : "Handed in"} · ${formatDateTime(r.createdAt, tz)}${r.proof ? " · slip attached" : ""}`}
                  accessory={
                    user.perms.has("cash.receive") ? (
                      <ConfirmRemittanceButtons remittanceId={r.id} />
                    ) : (
                      "none"
                    )
                  }
                />
              ))
            )}
          </ListSection>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              label={`Wages ${rep.year}`}
              value={m(rep.perTech.reduce((a, t) => a + t.wagesCents, 0))}
              icon={<BarChart3 size={18} aria-hidden />}
            />
            <StatCard
              label="Reimbursed"
              value={m(
                rep.perTech.reduce((a, t) => a + t.reimbursementsCents, 0),
              )}
              icon={<Receipt size={18} aria-hidden />}
            />
            <StatCard
              label="Paid out"
              value={m(rep.perTech.reduce((a, t) => a + t.paidCents, 0))}
              icon={<Landmark size={18} aria-hidden />}
            />
            <StatCard
              label="Chargeback holds"
              value={m(rep.holds.reduce((a, h) => a + h.outstandingCents, 0))}
              icon={<ShieldAlert size={18} aria-hidden />}
            />
          </div>
          <ListSection header={`Per tech, ${rep.year} to date`}>
            {rep.perTech.map((t) => (
              <ListRow
                key={t.userId}
                title={t.name}
                subtitle={`${t.workerType === "w2" ? "W-2" : "1099"} · reimbursed ${m(t.reimbursementsCents)} · paid ${m(t.paidCents)}`}
                detail={<span className="num">{m(t.wagesCents)}</span>}
                href={personHref(user, t.userId) ?? undefined}
              />
            ))}
          </ListSection>
          <ListSection
            header={`1099 contractors at or over ${m(rep.threshold1099Cents)}`}
            footer="Wages only (reimbursements under an accountable plan are excluded). Confirm with your accountant."
          >
            {rep.over1099.length === 0 ? (
              <ListRow title="None yet this year" />
            ) : (
              rep.over1099.map((t) => (
                <ListRow
                  key={t.userId}
                  title={t.name}
                  detail={<span className="num">{m(t.wagesCents)}</span>}
                  href={personHref(user, t.userId) ?? undefined}
                />
              ))
            )}
          </ListSection>
          <ListSection header="Open chargeback holds">
            {rep.holds.length === 0 ? (
              <ListRow title="No open holds" />
            ) : (
              rep.holds.map((h) => (
                <ListRow
                  key={`${h.disputeId}-${h.userId}`}
                  title={`${h.name} · ${h.jobNumber ?? "job"}`}
                  href={`/disputes/${h.disputeId}`}
                  detail={
                    <span className="num text-danger">
                      −{m(h.outstandingCents)}
                    </span>
                  }
                />
              ))
            )}
          </ListSection>
          <ListSection header="Pending reimbursements">
            {rep.pendingParts.length === 0 ? (
              <ListRow title="None" />
            ) : (
              rep.pendingParts.map((p) => (
                <ListRow
                  key={p.id}
                  title={`${p.user ?? "Tech"} · ${p.vendor ?? p.category}`}
                  href="/approvals?kind=part_purchase"
                  detail={m(p.total)}
                />
              ))
            )}
          </ListSection>
          <ListSection header="Job P&L (latest)">
            {rep.pnl.map((j) => (
              <ListRow
                key={j.jobId}
                href={`/jobs/${j.jobId}`}
                title={`${j.number} · ${j.title}`}
                subtitle={`Revenue ${m(j.revenueCents)} · parts ${m(j.partsCents)} · fees ${m(j.feesCents)}${j.locked ? " · locked" : ""}`}
                detail={
                  <span
                    className={`num ${j.companyNetCents < 0 ? "text-danger" : ""}`}
                  >
                    {m(j.companyNetCents)}
                  </span>
                }
              />
            ))}
          </ListSection>
        </>
      );
  }

  return (
    <PageTransition>
      <LargeTitleHeader title="Payroll" trailing={<HeaderActions />} />
      <Page wide>
        <div className="flex flex-col gap-[var(--section-gap)]">
          <SegmentLinks
            param="view"
            value={view}
            label="Payroll view"
            clear={["status"]}
            segments={[
              { value: "statements", label: "Statements" },
              { value: "cash", label: "Cash" },
              { value: "reports", label: "Reports" },
            ]}
          />
          {body}
        </div>
      </Page>
    </PageTransition>
  );
}
