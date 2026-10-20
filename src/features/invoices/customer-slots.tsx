import "server-only";
import { assertCustomerAccess } from "@/features/customers/api";
import { getCurrentUser } from "@/lib/auth/current";
import { formatMoney } from "@/lib/money";
import { getCompanyTimezone } from "@/lib/settings";
import { formatDate } from "@/lib/time";
import { Button } from "@/ui/components/Button";
import { ListRow, ListSection } from "@/ui/components/List";
import { MoneyText } from "@/ui/components/MoneyText";
import { StatusPill } from "@/ui/components/StatusPill";
import type { CustomerInvoicesPanelProps } from "./contracts";
import { listCustomerInvoices } from "./queries";

// The customer-page invoice slot, in its own module so the customer page doesn't
// pull the job invoice panel's client islands (line editor, photo picker) into its
// bundle. Re-exported from ./slots.

/** S13 — Open invoices, balance and a statement link on the customer page. */
export async function CustomerInvoicesPanel({
  customerId,
}: CustomerInvoicesPanelProps) {
  const user = await getCurrentUser();
  if (!user || !user.perms.has("invoices.view")) return null;
  try {
    await assertCustomerAccess(user, customerId, "read");
  } catch {
    return null;
  }
  const [rows, tz] = await Promise.all([
    listCustomerInvoices(customerId, user),
    getCompanyTimezone(),
  ]);
  if (rows.length === 0) return null;
  const open = rows.filter((r) => r.balanceCents > 0);
  const due = open.reduce((a, r) => a + r.balanceCents, 0);
  return (
    <ListSection
      variant="title"
      header="Invoices"
      trailing={
        open.length > 0 ? (
          <Button
            href={`/invoices/statement/${customerId}`}
            variant="plain"
            size="sm"
          >
            Statement
          </Button>
        ) : null
      }
      footer={
        due > 0
          ? `${formatMoney(due)} open across ${open.length} invoice${open.length === 1 ? "" : "s"}.`
          : "Nothing owed."
      }
    >
      {rows.map((r) => (
        <ListRow
          key={r.id}
          href={`/invoices/${r.id}`}
          title={
            <span className="flex items-center gap-2">
              <span>{r.number}</span>
              <StatusPill
                kind="invoice"
                status={r.overdue ? "overdue" : r.status}
                size="sm"
              />
            </span>
          }
          subtitle={[
            r.jobNumber,
            r.issuedAt ? formatDate(r.issuedAt, tz) : "Draft",
          ]
            .filter(Boolean)
            .join(" · ")}
          detail={
            <MoneyText
              cents={r.balanceCents > 0 ? r.balanceCents : r.totalCents}
              className={r.balanceCents > 0 ? "text-label" : undefined}
            />
          }
        />
      ))}
    </ListSection>
  );
}
