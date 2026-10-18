import "server-only";
import { Banknote, FileSignature, Landmark, Wallet } from "lucide-react";
import Link from "next/link";
import { getJobForUser } from "@/features/jobs/api";
import { getCurrentUser } from "@/lib/auth/current";
import { personHref } from "@/lib/links";
import { formatBps, formatMoney } from "@/lib/money";
import { isEnabled } from "@/lib/settings";
import { formatDateKey } from "@/lib/time";
import { KeyValueList } from "@/ui/components/KeyValueList";
import { ListRow, ListSection } from "@/ui/components/List";
import { Pill } from "@/ui/components/StatusPill";
import { TextLink } from "@/ui/components/TextLink";
import { getCustodyBalances, getJobFinancials, getPeriodEarnings } from "./api";
import { CashCountForm } from "./components/CashCountForm";
import { Trace } from "./components/Trace";
import { WhyAmount } from "./components/WhyAmount";
import type {
  CashCheckSectionProps,
  CashOnHandPillProps,
  JobEarningsPanelProps,
  MyEarningsCardProps,
  TechCompSectionProps,
} from "./contracts";
import { getPayOverviewFor, techCompSummary } from "./queries";
import { custodyFor } from "./server/custody";

// Server UI slots produced by B6 (BUILD_PLAN §5.1). Each takes ids, resolves the viewer
// itself, enforces perms + row scope and returns null when hidden or `payroll` is off.

const m = (c: number) => formatMoney(c);
const signed = (c: number) => (c > 0 ? `+${m(c)}` : m(c));

/** S40 — Job financials (jobs.view_financials) or the viewer's own earnings line with the trace. */
export async function JobEarningsPanel({ jobId }: JobEarningsPanelProps) {
  const user = await getCurrentUser();
  if (!user || !(await isEnabled("payroll"))) return null;
  if (
    !user.perms.has("jobs.view_financials") &&
    !user.perms.has("payroll.view_own")
  )
    return null;
  if (!(await getJobForUser(jobId, user))) return null;
  const f = await getJobFinancials(jobId, user);
  if (!f) return null;
  const full = !!f.company;
  return (
    <ListSection
      header={full ? "Job P&L and earnings" : "Your earnings"}
      footer={
        f.locked
          ? "Locked in an approved pay statement: later changes become adjustments."
          : `Plan ${f.planKey} v${f.planVersion}`
      }
    >
      {f.earnings.map((e) => (
        <ListRow
          key={e.userId}
          icon={<Wallet size={18} aria-hidden />}
          iconTone="green"
          multiline
          // The amount is the "why" button, so only the name is a link.
          title={
            full ? (
              <TextLink href={personHref(user, e.userId)}>{e.name}</TextLink>
            ) : (
              "This job"
            )
          }
          subtitle={[
            `${formatBps(e.rateBps)}${e.splitBps !== 10000 ? ` × ${formatBps(e.splitBps)} split` : ""}`,
            e.commissionCents ? `commission ${m(e.commissionCents)}` : null,
            e.tipCents ? `tip ${m(e.tipCents)}` : null,
            e.reimbursementCents
              ? `parts back ${m(e.reimbursementCents)}`
              : null,
            e.cashHeldCents ? `cash ${m(e.cashHeldCents)}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          detail={
            <WhyAmount title={`Why ${m(e.netCents)}?`} steps={e.trace}>
              <span className="num font-semibold">{signed(e.netCents)}</span>
            </WhyAmount>
          }
        />
      ))}
      {f.company && (
        <div className="px-4 py-3">
          <Trace steps={f.company.trace} />
        </div>
      )}
    </ListSection>
  );
}

/** S41 — Cash custody pill linking to the hand-in flow on /pay. */
export async function CashOnHandPill({ userId }: CashOnHandPillProps) {
  const user = await getCurrentUser();
  if (!user || !(await isEnabled("payroll"))) return null;
  if (
    user.id !== userId &&
    !user.perms.has("payroll.view_all") &&
    !user.perms.has("cash.receive")
  )
    return null;
  const c = (await getCustodyBalances([userId]))[userId];
  if (!c || c.heldCents <= 0) return null;
  const days = c.oldestAt
    ? Math.floor((Date.now() - c.oldestAt.getTime()) / 86_400_000)
    : 0;
  return (
    <Link
      href={user.id === userId ? "/pay#cash" : "/pay/settlements?view=cash"}
      className="pressable inline-flex min-h-11 items-center"
      aria-label={`Cash on hand ${m(c.heldCents)}`}
    >
      <Pill tone={days > 3 ? "red" : "orange"} dot>
        <Banknote size={14} aria-hidden className="mr-1 inline" />
        {m(c.heldCents)} cash
      </Pill>
    </Link>
  );
}

/** S42 — Live period earnings, pending reimbursements and statements to acknowledge. */
export async function MyEarningsCard({ userId }: MyEarningsCardProps) {
  const user = await getCurrentUser();
  if (!user || !(await isEnabled("payroll"))) return null;
  if (user.id !== userId && !user.perms.has("payroll.view_all")) return null;
  if (!user.perms.has("payroll.view_own")) return null;
  const [pe, extra] = await Promise.all([
    getPeriodEarnings(userId),
    getPayOverviewFor(userId),
  ]);
  return (
    <Link
      href={user.id === userId ? "/pay" : "/pay/settlements"}
      className="list-card pressable flex flex-col gap-2 p-4"
    >
      <span className="text-footnote font-semibold uppercase tracking-wide text-label-2">
        {pe.startsOn ? `Pay · week of ${formatDateKey(pe.startsOn)}` : "Pay"}
      </span>
      <span
        className={`num text-title1 font-bold ${pe.netCents < 0 ? "text-danger" : ""}`}
      >
        {m(pe.netCents)}
      </span>
      <span className="flex flex-wrap gap-1.5">
        {extra.pendingReimbursementCents > 0 && (
          <Pill size="sm" tone="orange">
            {m(extra.pendingReimbursementCents)} receipts pending
          </Pill>
        )}
        {extra.toAck > 0 && (
          <Pill size="sm" tone="blue">
            {extra.toAck} statement{extra.toAck === 1 ? "" : "s"} to review
          </Pill>
        )}
        {extra.agreementRequired && (
          <Pill size="sm" tone="indigo">
            Sign pay agreement
          </Pill>
        )}
      </span>
    </Link>
  );
}

/** S43 — Plan, overrides, agreement and bank status (last 4 only with payroll.payout). */
export async function TechCompSection({ userId }: TechCompSectionProps) {
  const user = await getCurrentUser();
  if (!user || !(await isEnabled("payroll"))) return null;
  const admin =
    user.perms.has("comp_plans.manage") || user.perms.has("payroll.view_all");
  if (!admin && user.id !== userId) return null;
  const s = await techCompSummary(userId);
  if (!s) return null;
  const o = s.tp.overrides;
  const cashText =
    s.tp.workerType === "w2" ||
    (o.tech_keeps_cash ?? s.tp.plan.cash.tech_keeps_cash) === false
      ? "Hands in all cash"
      : (o.cash_settlement ?? s.tp.plan.cash.settlement) === "net_in_payout"
        ? "Keeps cash, deducted from pay"
        : "Keeps cash, hands it in separately";
  return (
    <ListSection
      header="Pay"
      trailing={
        user.perms.has("comp_plans.manage") ? (
          <Link
            href="/settings/commission"
            className="text-subhead text-accent-text"
          >
            Edit
          </Link>
        ) : null
      }
    >
      <KeyValueList
        items={[
          { label: "Plan", value: `${s.tp.planName} v${s.tp.planVersion}` },
          {
            label: "Rate",
            value:
              o.rate_bps != null
                ? `${formatBps(o.rate_bps)} (personal)`
                : formatBps(s.tp.plan.rate_bps),
          },
          ...Object.entries(o.by_service_type ?? {}).map(([id, b]) => ({
            label: s.serviceNames[id] ?? "Service",
            value: formatBps(b),
          })),
          {
            label: "Worker type",
            value:
              s.tp.workerType === "w2" ? "W-2 employee" : "1099 contractor",
          },
          { label: "Cash", value: cashText },
        ]}
      />
      <ListRow
        icon={<FileSignature size={18} aria-hidden />}
        iconTone={s.agreement?.required ? "orange" : "green"}
        title="Agreement"
        detail={
          s.agreement?.required
            ? s.agreement.signedVersion
              ? `Signed v${s.agreement.signedVersion}, needs v${s.agreement.planVersion}`
              : "Not signed"
            : `Signed v${s.agreement?.signedVersion ?? "—"}`
        }
      />
      <ListRow
        icon={<Landmark size={18} aria-hidden />}
        iconTone={s.bank.hold ? "red" : s.bank.hasBank ? "green" : "gray"}
        title="Direct deposit"
        detail={
          !s.bank.hasBank
            ? "Not set up"
            : user.perms.has("payroll.payout") || user.id === userId
              ? `••${s.bank.last4}${s.bank.hold ? " · on hold" : ""}`
              : s.bank.hold
                ? "On file · on hold"
                : "On file"
        }
      />
    </ListSection>
  );
}

/** S44 — System cash and checks held vs a declared count (on /today/finish). */
export async function CashCheckSection({ userId }: CashCheckSectionProps) {
  const user = await getCurrentUser();
  if (!user || user.id !== userId || !(await isEnabled("payroll"))) return null;
  if (!user.perms.has("cash.remit_own")) return null;
  const c = (await custodyFor([userId]))[userId];
  const held = c?.heldCents ?? 0;
  return (
    <ListSection
      header="Cash & checks"
      footer={
        held > 0
          ? "Count what's in the truck. Checks are always handed in."
          : undefined
      }
    >
      <ListRow
        icon={<Banknote size={18} aria-hidden />}
        iconTone={held > 0 ? "orange" : "green"}
        title={
          held > 0 ? `${m(held)} on record` : "No cash or checks on record"
        }
        subtitle={
          held > 0
            ? `Cash ${m(c?.cashHeldCents ?? 0)} · checks ${m(c?.checksHeldCents ?? 0)}`
            : undefined
        }
        href={held > 0 ? "/pay#cash" : undefined}
      />
      {held > 0 && <CashCountForm systemCents={held} />}
    </ListSection>
  );
}
