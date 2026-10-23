import {
  Banknote,
  FileSignature,
  FileText,
  Landmark,
  Receipt,
  ShieldAlert,
} from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HeaderActions } from "@/app/(app)/_components/HeaderActions";
import {
  ConfirmRemittanceButtons,
  RemitCashButton,
  WhyAmount,
} from "@/features/payroll/components/islands";
import { getPayOverview, LEDGER_TYPE_LABEL } from "@/features/payroll/queries";
import { requireUser } from "@/lib/auth/current";
import { formatMoney } from "@/lib/money";
import { isEnabled } from "@/lib/settings";
import { formatDateKey } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { ListRow, ListSection } from "@/ui/components/List";
import { MoneyText } from "@/ui/components/MoneyText";
import { LargeTitleHeader } from "@/ui/components/NavBar";
import { Pill } from "@/ui/components/StatusPill";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Pay" };

const m = (c: number) => formatMoney(c);
const signed = (c: number) => (c > 0 ? `+${m(c)}` : m(c));

export default async function PayPage() {
  await requireUser("payroll.view_own");
  if (!(await isEnabled("payroll"))) notFound();
  const o = await getPayOverview();
  const b = o.byType;
  const wages =
    (b.commission ?? 0) +
    (b.spiff ?? 0) +
    (b.tip ?? 0) +
    (b.guarantee_topup ?? 0) +
    (b.ot_topup ?? 0);
  const reimb =
    (b.reimbursement_parts ?? 0) +
    (b.reimbursement_expense ?? 0) +
    (b.reimbursement_mileage ?? 0);
  const cashNetted = (b.cash_held ?? 0) + (b.cash_remitted ?? 0);
  const held = o.custody?.heldCents ?? 0;
  const oldestDays = o.custody?.oldestAt
    ? Math.floor(
        (Date.now() - new Date(o.custody.oldestAt).getTime()) / 86_400_000,
      )
    : 0;
  const overLimit =
    !!o.cash &&
    (held > o.cash.maxHeldCents ||
      (held > 0 && oldestDays > o.cash.remitWithinDays));
  const netting = o.cash?.settlement === "net_in_payout";

  return (
    <PageTransition>
      <LargeTitleHeader
        title="Pay"
        subtitle={
          o.period
            ? `Week of ${formatDateKey(o.period.startsOn)} – ${formatDateKey(o.period.endsOn)}`
            : undefined
        }
        trailing={<HeaderActions own="receipt" />}
      />
      <Page>
        <div className="flex flex-col gap-[var(--section-gap)]">
          {o.agreement?.required && (
            <Banner
              tone="legal"
              title={
                o.agreement.signedVersion
                  ? "Your pay plan changed"
                  : "Sign your pay agreement"
              }
              action={
                <Button href="/pay/agreement" size="sm" variant="tinted">
                  Review
                </Button>
              }
            >
              Read how your commission is calculated, with examples at your
              rate, and e-sign it.
            </Banner>
          )}
          {o.toAck.length > 0 && (
            <Banner
              tone="info"
              title={`${o.toAck.length} statement${o.toAck.length === 1 ? "" : "s"} to review`}
              action={
                <Button
                  href={`/pay/statements/${o.toAck[0]?.id}`}
                  size="sm"
                  variant="tinted"
                >
                  Open
                </Button>
              }
            >
              Check each line and acknowledge it, or flag anything that looks
              wrong within 48 hours.
            </Banner>
          )}

          <section
            className="card flex flex-col gap-4 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--accent)_8%,transparent),transparent_70%)] p-[var(--card-pad)]"
            aria-labelledby="period-h"
          >
            <div>
              <h2
                id="period-h"
                className="text-subhead font-medium text-label-2"
              >
                So far this period
              </h2>
              <MoneyText
                cents={o.netCents}
                className="mt-1 block text-large-title font-bold"
                colorize
              />
              <p className="mt-1 text-footnote text-label-2">
                {o.planName ? `${o.planName} · ` : ""}
                {o.workerType === "w2" ? "W-2" : "1099"}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Earnings" value={m(wages)} />
              <Stat label="Reimbursements" value={m(reimb)} />
              {netting ? (
                <Stat label="Cash kept" value={m(cashNetted)} />
              ) : (
                <Stat label="Adjustments" value={signed(b.adjustment ?? 0)} />
              )}
              <Stat label="Jobs" value={String(o.jobLines.length)} />
            </div>
            <p className="text-footnote text-label-2">
              Year to date: {m(o.ytd.wagesCents)} earned, {m(o.ytd.paidCents)}{" "}
              paid
            </p>
          </section>

          <ListSection
            variant="title"
            header="Jobs this period"
            footer={
              o.jobLines.length
                ? "Tap an amount to see how it was calculated."
                : undefined
            }
          >
            {o.jobLines.length === 0 ? (
              <ListRow
                title="No paid jobs yet this period"
                subtitle="Jobs count once they're completed and paid."
              />
            ) : (
              o.jobLines.map((j) => (
                <ListRow
                  key={j.jobId}
                  multiline
                  title={`${j.jobNumber} · ${j.title}`}
                  subtitle={
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span>
                        {j.city ?? ""}
                        {j.commissionCents
                          ? ` · commission ${m(j.commissionCents)}`
                          : ""}
                        {j.tipCents ? ` · tip ${m(j.tipCents)}` : ""}
                      </span>
                      {j.pendingReimbursement && (
                        <Pill size="sm" tone="orange">
                          Receipt pending
                        </Pill>
                      )}
                    </span>
                  }
                  detail={
                    <WhyAmount
                      title={`Why ${m(j.postedCents)}?`}
                      steps={j.trace}
                    >
                      <span className="num font-semibold">
                        {signed(j.postedCents)}
                      </span>
                    </WhyAmount>
                  }
                />
              ))
            )}
          </ListSection>

          {o.otherLines.length > 0 && (
            <ListSection variant="title" header="Other lines">
              {o.otherLines.map((l) => (
                <ListRow
                  key={l.id}
                  title={l.memo ?? LEDGER_TYPE_LABEL[l.type] ?? l.type}
                  subtitle={`${LEDGER_TYPE_LABEL[l.type] ?? l.type} · ${formatDateKey(l.effectiveDate)}`}
                  detail={
                    <span
                      className={`num ${l.amountCents < 0 ? "text-danger" : ""}`}
                    >
                      {signed(l.amountCents)}
                    </span>
                  }
                />
              ))}
            </ListSection>
          )}
          {o.pendingReviewLines.length > 0 && (
            <ListSection
              variant="title"
              header="Under review"
              footer="These lines count only after an admin reviews them."
            >
              {o.pendingReviewLines.map((l) => (
                <ListRow
                  key={l.id}
                  icon={<ShieldAlert size={18} aria-hidden />}
                  iconTone="orange"
                  title={l.memo ?? l.type}
                  detail={<span className="num">{signed(l.amountCents)}</span>}
                />
              ))}
            </ListSection>
          )}

          <ListSection
            variant="title"
            header="Cash on hand"
            id="cash"
            footer={
              netting
                ? "Cash you keep is deducted from your pay. Checks are always handed in."
                : `Hand in cash and checks within ${o.cash?.remitWithinDays ?? 3} days.`
            }
          >
            <ListRow
              icon={<Banknote size={18} aria-hidden />}
              iconTone={overLimit ? "red" : held > 0 ? "orange" : "green"}
              title={held > 0 ? `${m(held)} with you` : "Nothing to hand in"}
              subtitle={
                held > 0
                  ? `Cash ${m(o.custody?.cashHeldCents ?? 0)} · checks ${m(o.custody?.checksHeldCents ?? 0)}${oldestDays ? ` · oldest ${oldestDays} day${oldestDays === 1 ? "" : "s"}` : ""}`
                  : undefined
              }
              accessory={
                held > 0 && o.user.perms.has("cash.remit_own") ? (
                  <RemitCashButton
                    heldCents={held}
                    maxCents={
                      held - o.pendingRemit.reduce((a, r) => a + r.amount, 0)
                    }
                    label="Hand in"
                    variant="tinted"
                  />
                ) : (
                  "none"
                )
              }
            />
            {o.pendingRemit.map((r) => (
              <ListRow
                key={r.id}
                title={`${m(r.amount)} ${r.method === "bank_deposit" ? "deposited" : "handed in"}`}
                subtitle="Waiting for the office to confirm"
                detail={
                  <Pill size="sm" tone="orange">
                    Pending
                  </Pill>
                }
              />
            ))}
          </ListSection>

          {o.toConfirm.length > 0 && (
            <ListSection
              variant="title"
              header="Hand-ins to confirm"
              footer="Confirm only after you've counted the cash or seen the deposit."
            >
              {o.toConfirm.map((r) => (
                <ListRow
                  key={r.id}
                  icon={<Banknote size={18} aria-hidden />}
                  iconTone="orange"
                  title={`${r.name} · ${m(r.amount)}`}
                  subtitle={
                    r.method === "bank_deposit" ? "Bank deposit" : "Handed in"
                  }
                  accessory={<ConfirmRemittanceButtons remittanceId={r.id} />}
                />
              ))}
            </ListSection>
          )}

          {o.pendingParts.length > 0 && (
            <ListSection variant="title" header="Receipts waiting for approval">
              {o.pendingParts.map((p) => (
                <ListRow
                  key={p.id}
                  icon={<Receipt size={18} aria-hidden />}
                  iconTone="orange"
                  title={p.vendor ?? "Receipt"}
                  href="/parts"
                  detail={m(p.total)}
                />
              ))}
            </ListSection>
          )}

          <ListSection variant="title" header="Statements and setup">
            <ListRow
              icon={<FileText size={18} aria-hidden />}
              iconTone="blue"
              title="Statements"
              href="/pay/statements"
              badge={o.toAck.length || undefined}
            />
            <ListRow
              icon={<Landmark size={18} aria-hidden />}
              iconTone="green"
              title="Direct deposit"
              detail={o.bank?.last4 ? `••${o.bank.last4}` : "Not set up"}
              href="/pay/bank"
            />
            <ListRow
              icon={<FileSignature size={18} aria-hidden />}
              iconTone="indigo"
              title="Pay agreement"
              detail={
                o.agreement?.required
                  ? "Needs signature"
                  : o.agreement
                    ? `Signed v${o.agreement.signedVersion}`
                    : undefined
              }
              href="/pay/agreement"
            />
          </ListSection>
        </div>
      </Page>
    </PageTransition>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[14px] bg-card-2 px-3 py-2.5">
      <p className="truncate text-footnote text-label-2">{label}</p>
      <p className="num whitespace-nowrap text-headline">{value}</p>
    </div>
  );
}
