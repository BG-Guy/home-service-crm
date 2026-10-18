import "server-only";
import { desc, eq } from "drizzle-orm";
import { CreditCard, Wallet } from "lucide-react";
import { hasCardProcessor, processorReady } from "@/adapters/payments";
import { db } from "@/db";
import { depositRequests, payments } from "@/db/schema";
import { assertCustomerAccess } from "@/features/customers/api";
import { assertJobAccess } from "@/features/jobs/api";
import { getCurrentUser } from "@/lib/auth/current";
import { type LinkViewer, personHref } from "@/lib/links";
import { formatMoney } from "@/lib/money";
import { getCompanyTimezone, isEnabled } from "@/lib/settings";
import { formatDate, formatDateTime } from "@/lib/time";
import type { SessionUser } from "@/lib/types";
import { Banner } from "@/ui/components/Banner";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListRow, ListSection } from "@/ui/components/List";
import { MoneyText } from "@/ui/components/MoneyText";
import { Pill, StatusPill } from "@/ui/components/StatusPill";
import { TextLink } from "@/ui/components/TextLink";
import {
  DepositActions,
  MarkRefundPaidButton,
  RefundButton,
  RequestDepositButton,
  VerifyButton,
} from "./components/PaymentActions";
import type {
  CustomerPaymentsPanelProps,
  DepositChipProps,
  JobPaymentsPanelProps,
  PaymentListRow,
} from "./contracts";
import { DEPOSIT_JOB_STATUSES } from "./internal";
import { paymentHref, paymentLinkAccess } from "./links";
import { getCustomerPayments, getJobPaymentsPanel } from "./queries";
import { CollectPaymentButton, RecordPaymentButton } from "./slots.client";

// Server UI slots produced by B4 (BUILD_PLAN §5.1). Each checks its own permission,
// row scope and feature flag and returns null when the viewer may not see it.

const MODE_LABEL: Record<string, string> = {
  capture: "card",
  hold: "card hold",
  card_on_file: "card on file",
  manual: "cash / Zelle / check",
};

/**
 * QA2: the office may ask for a deposit while the job hasn't started (or is on hold
 * for a special-order part, SPEC M05) and has no ISSUED invoice. A draft invoice (the
 * lead's quoted line, approved estimate lines) doesn't count: the deposit is applied
 * to it when it's issued. Mirrors the server check in actions.ts requestDeposit.
 */
function depositRequestable(
  jobStatus: string,
  invoiceStatus: string | null,
): boolean {
  return (
    DEPOSIT_JOB_STATUSES.has(jobStatus) &&
    (invoiceStatus == null || invoiceStatus === "draft")
  );
}

const canSeeMoney = (u: SessionUser) =>
  u.perms.has("payments.view_all") ||
  u.perms.has("payments.collect") ||
  u.perms.has("payments.record_manual");

function paymentStatus(p: PaymentListRow) {
  return p.needsVerify ? "unverified" : p.status;
}

function PaymentRow({
  p,
  tz,
  canRefund,
  canVerify,
  cardRefundReady,
  viewer,
}: {
  p: PaymentListRow;
  tz: string;
  canRefund: boolean;
  canVerify: boolean;
  /** The card processor is connected (else only a promised refund is offered). */
  cardRefundReady: boolean;
  /** For the collector's link (`personHref`). */
  viewer: LinkViewer;
}) {
  const left = p.amountCents + p.tipCents - p.refundedCents;
  const refundable =
    canRefund &&
    left > 0 &&
    ["succeeded", "partially_refunded"].includes(p.status);
  return (
    <div className="list-row flex flex-col gap-2 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-body font-medium">
            {p.kind === "deposit"
              ? "Deposit · "
              : p.kind === "tip_only"
                ? "Tip · "
                : ""}
            {p.methodLabel}
          </p>
          <p className="text-footnote text-label-2">
            {formatDateTime(p.at, tz)}
            {p.collectedByName ? (
              <>
                {" · "}
                <TextLink href={personHref(viewer, p.collectedByUserId)}>
                  {p.collectedByName}
                </TextLink>
              </>
            ) : null}
            {p.reference ? ` · #${p.reference}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <MoneyText
            cents={p.amountCents + p.tipCents}
            className="text-body font-semibold"
          />
          <StatusPill kind="payment" status={paymentStatus(p)} size="sm" />
        </div>
      </div>
      {(p.tipCents > 0 || p.refundedCents > 0) && (
        <p className="text-footnote text-label-2">
          {p.tipCents > 0 ? `Includes ${formatMoney(p.tipCents)} tip. ` : ""}
          {p.refundedCents > 0
            ? `${formatMoney(p.refundedCents)} refunded.`
            : ""}
        </p>
      )}
      {(refundable || (canVerify && p.needsVerify)) && (
        <div className="flex flex-wrap gap-2">
          {canVerify && p.needsVerify && <VerifyButton paymentIds={[p.id]} />}
          {refundable && (
            <RefundButton
              paymentId={p.id}
              maxCents={left}
              methodLabel={p.methodLabel}
              manual={p.provider === "manual"}
              processorReady={p.provider === "manual" || cardRefundReady}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** S16 — Payments, deposits, refunds, verify state and a Collect button (job Invoice tab). */
export async function JobPaymentsPanel({ jobId }: JobPaymentsPanelProps) {
  const user = await getCurrentUser();
  if (!user || !canSeeMoney(user)) return null;
  let data: Awaited<ReturnType<typeof getJobPaymentsPanel>>;
  try {
    data = await getJobPaymentsPanel(jobId, user);
  } catch {
    return null;
  }
  const [tz, depositsOn] = await Promise.all([
    getCompanyTimezone(),
    isEnabled("deposits"),
  ]);
  const canRefund = user.perms.has("payments.refund");
  const canVerify = user.perms.has("payments.verify_manual");
  const cardRefundReady =
    canRefund && data.payments.some((p) => p.provider !== "manual")
      ? await processorReady("stripe")
      : false;
  const canCollect =
    user.perms.has("payments.collect") ||
    user.perms.has("payments.record_manual");
  const openDeposit = data.deposits.find((d) =>
    ["required", "requested"].includes(d.status),
  );
  const due =
    (data.invoice?.balanceCents ?? 0) > 0 ||
    !!openDeposit ||
    (!data.invoice && data.payments.length === 0);
  const deposits = depositsOn ? data.deposits : [];
  const openRefunds = data.refunds.filter((r) =>
    ["scheduled", "pending"].includes(r.status),
  );
  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {data.invoice && (
        <ListSection header="Balance">
          <ListRow
            title="Invoice total"
            detail={<MoneyText cents={data.invoice.totalCents} />}
          />
          {/* Paid = payments net of refunds; credit notes apart (QA2), so
              total − paid − credits = balance due, like the invoice totals. */}
          <ListRow
            title="Paid"
            detail={<MoneyText cents={data.invoice.paidNetCents} />}
          />
          {data.invoice.creditedCents > 0 && (
            <ListRow
              title="Credits"
              detail={<MoneyText cents={-data.invoice.creditedCents} />}
            />
          )}
          <ListRow
            title={<span className="font-semibold">Balance due</span>}
            detail={
              <MoneyText
                cents={Math.max(0, data.invoice.balanceCents)}
                className="font-semibold text-label"
              />
            }
          />
        </ListSection>
      )}

      {deposits.length > 0 && (
        <ListSection
          header="Deposits"
          footer={
            hasCardProcessor()
              ? undefined
              : "No card processor: deposits are collected by cash, check or Zelle."
          }
        >
          {deposits.map((d) => {
            const open = ["required", "requested"].includes(d.status);
            return (
              <div
                key={d.id}
                className="list-row flex flex-col gap-2 px-4 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-body font-medium">
                      Deposit <MoneyText cents={d.amountCents} />
                    </p>
                    <p className="text-footnote text-label-2">
                      {d.paidAt
                        ? `Paid ${formatDate(d.paidAt, tz)}`
                        : d.dueAt && open
                          ? `Due ${formatDateTime(d.dueAt, tz)} · by ${MODE_LABEL[d.mode] ?? d.mode}`
                          : `By ${MODE_LABEL[d.mode] ?? d.mode}`}
                      {d.specialOrderPoAt
                        ? ` · part ordered ${formatDate(d.specialOrderPoAt, tz)} (non-refundable)`
                        : ""}
                      {d.waiveReason ? ` · waived: ${d.waiveReason}` : ""}
                    </p>
                  </div>
                  <StatusPill kind="deposit" status={d.status} size="sm" />
                </div>
                {d.capWarning && user.baseRole !== "tech" && (
                  <Banner tone="legal">{d.capWarning}</Banner>
                )}
                {open && user.baseRole !== "tech" && (
                  <DepositActions
                    depositRequestId={d.id}
                    amountCents={d.amountCents}
                    canSend={user.perms.has("payments.collect")}
                    canWaive={user.perms.has("deposits.waive")}
                  />
                )}
              </div>
            );
          })}
        </ListSection>
      )}

      <ListSection
        header="Payments"
        trailing={
          depositsOn &&
          !openDeposit &&
          user.baseRole !== "tech" &&
          user.perms.has("payments.collect") &&
          depositRequestable(data.job.status, data.invoice?.status ?? null) ? (
            <RequestDepositButton
              jobId={jobId}
              cardLinks={hasCardProcessor()}
            />
          ) : undefined
        }
      >
        {data.payments.length === 0 ? (
          <EmptyState
            compact
            icon={<Wallet size={36} strokeWidth={1.6} />}
            title="No payments yet"
            message={
              data.invoice
                ? "Collect the balance when the work is done."
                : "Payments and deposits for this job show up here."
            }
          />
        ) : (
          data.payments.map((p) => (
            <PaymentRow
              key={p.id}
              p={p}
              tz={tz}
              canRefund={canRefund}
              canVerify={canVerify}
              cardRefundReady={cardRefundReady}
              viewer={user}
            />
          ))
        )}
      </ListSection>

      {openRefunds.length > 0 && (
        <ListSection header="Refunds in progress">
          {openRefunds.map((r) => (
            <div
              key={r.id}
              className="list-row flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-body">
                  <MoneyText cents={r.amountCents} /> · {r.reason}
                </p>
                <p className="text-footnote text-label-2">
                  {r.dueAt
                    ? `Promised by ${formatDate(r.dueAt, tz)}`
                    : "Pending"}
                </p>
              </div>
              {canRefund && <MarkRefundPaidButton refundId={r.id} />}
            </div>
          ))}
        </ListSection>
      )}

      {canCollect && due && data.job.status !== "cancelled" && (
        <CollectPaymentButton
          jobId={jobId}
          invoiceId={data.invoice?.id}
          size="lg"
          fullWidth
          label={
            data.invoice && data.invoice.balanceCents > 0
              ? `Collect ${formatMoney(data.invoice.balanceCents)}`
              : openDeposit
                ? `Collect ${formatMoney(openDeposit.amountCents)} deposit`
                : "Collect payment"
          }
        />
      )}
    </div>
  );
}

/** S17 — Customer payment history and Record payment (customer detail). */
export async function CustomerPaymentsPanel({
  customerId,
}: CustomerPaymentsPanelProps) {
  const user = await getCurrentUser();
  if (!user || !canSeeMoney(user)) return null;
  try {
    await assertCustomerAccess(user, customerId, "read");
  } catch {
    return null;
  }
  if (!user.perms.has("payments.view_all") && user.baseRole === "tech")
    return null;
  const [data, tz] = await Promise.all([
    getCustomerPayments(customerId),
    getCompanyTimezone(),
  ]);
  const linkAccess = paymentLinkAccess(user.perms);
  const openBalance = data.openInvoices.reduce((s, i) => s + i.balanceCents, 0);
  return (
    <ListSection
      header="Payments"
      footer={
        openBalance > 0
          ? `${formatMoney(openBalance)} open across ${data.openInvoices.length} invoice${data.openInvoices.length === 1 ? "" : "s"}.`
          : undefined
      }
      trailing={
        user.perms.has("payments.record_manual") &&
        data.openInvoices.length > 0 ? (
          <RecordPaymentButton customerId={customerId} />
        ) : undefined
      }
    >
      {data.payments.length === 0 ? (
        <EmptyState
          compact
          icon={<CreditCard size={36} strokeWidth={1.6} />}
          title="No payments yet"
        />
      ) : (
        data.payments.slice(0, 10).map((p) => (
          <ListRow
            key={p.id}
            title={
              <>
                <MoneyText cents={p.amountCents + p.tipCents} /> ·{" "}
                {p.methodLabel}
              </>
            }
            subtitle={`${formatDate(p.at, tz)}${p.jobNumber ? ` · Job ${p.jobNumber}` : ""}${p.invoiceNumber ? ` · ${p.invoiceNumber}` : ""}`}
            detail={
              <StatusPill kind="payment" status={paymentStatus(p)} size="sm" />
            }
            // Job → invoice (the customer is this page already).
            href={
              paymentHref(p, { ...linkAccess, customers: false }) ?? undefined
            }
          />
        ))
      )}
    </ListSection>
  );
}

/** S18 — "Deposit required $X" or "Deposit $X paid {date}" (job header). */
export async function DepositChip({ jobId }: DepositChipProps) {
  const user = await getCurrentUser();
  if (!user) return null;
  if (!(await isEnabled("deposits"))) return null;
  try {
    await assertJobAccess(user, jobId, "read");
  } catch {
    return null;
  }
  const [d] = await db
    .select({ d: depositRequests, paidAt: payments.succeededAt })
    .from(depositRequests)
    .leftJoin(payments, eq(payments.id, depositRequests.paymentId))
    .where(eq(depositRequests.jobId, jobId))
    .orderBy(desc(depositRequests.createdAt))
    .limit(1);
  if (!d) return null;
  const s = d.d.status;
  if (s === "required" || s === "requested")
    return (
      <Pill tone="orange">Deposit required {formatMoney(d.d.amountCents)}</Pill>
    );
  if (s === "held")
    return (
      <Pill tone="teal">Deposit {formatMoney(d.d.amountCents)} on hold</Pill>
    );
  if (s === "paid" || s === "applied") {
    const tz = await getCompanyTimezone();
    return (
      <Pill tone="green">
        Deposit {formatMoney(d.d.amountCents)} paid
        {d.paidAt ? ` ${formatDate(d.paidAt, tz)}` : ""}
      </Pill>
    );
  }
  return null;
}
