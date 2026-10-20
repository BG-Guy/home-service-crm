import "server-only";
import { CreditCard } from "lucide-react";
import { assertCustomerAccess } from "@/features/customers/api";
import { getCurrentUser } from "@/lib/auth/current";
import { formatMoney } from "@/lib/money";
import { getCompanyTimezone } from "@/lib/settings";
import { formatDate } from "@/lib/time";
import type { SessionUser } from "@/lib/types";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListRow, ListSection } from "@/ui/components/List";
import { MoneyText } from "@/ui/components/MoneyText";
import { StatusPill } from "@/ui/components/StatusPill";
import type { CustomerPaymentsPanelProps, PaymentListRow } from "./contracts";
import { getCustomerPayments } from "./queries";
import { RecordPaymentButton } from "./slots.client";

// The customer-page payment slot, in its own module so the customer page doesn't
// pull the job payment panel's client islands (refund, verify, deposit actions)
// into its bundle. Re-exported from ./slots.

const canSeeMoney = (u: SessionUser) =>
  u.perms.has("payments.view_all") ||
  u.perms.has("payments.collect") ||
  u.perms.has("payments.record_manual");

function paymentStatus(p: PaymentListRow) {
  return p.needsVerify ? "unverified" : p.status;
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
  const openBalance = data.openInvoices.reduce((s, i) => s + i.balanceCents, 0);
  return (
    <ListSection
      variant="title"
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
            href={p.jobId ? `/jobs/${p.jobId}?tab=invoice` : undefined}
          />
        ))
      )}
    </ListSection>
  );
}
