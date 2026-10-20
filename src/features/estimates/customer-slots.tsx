import "server-only";
import { assertCustomerAccess } from "@/features/customers/api";
import { getCurrentUser } from "@/lib/auth/current";
import { formatMoney } from "@/lib/money";
import { getCompanyTimezone, isEnabled } from "@/lib/settings";
import { formatDate } from "@/lib/time";
import { Button } from "@/ui/components/Button";
import { ListRow, ListSection } from "@/ui/components/List";
import { MoneyText } from "@/ui/components/MoneyText";
import { StatusPill } from "@/ui/components/StatusPill";
import type { CustomerEstimatesPanelProps } from "./contracts";
import { listEstimatesForViewer } from "./queries";

// The customer-page estimate slot, in its own module so the customer page doesn't
// pull the job estimate panel's client islands into its bundle. Re-exported from ./slots.

/** S12 — Open and unsold estimates on the customer page. */
export async function CustomerEstimatesPanel({
  customerId,
}: CustomerEstimatesPanelProps) {
  const user = await getCurrentUser();
  if (!user || !user.perms.has("estimates.view")) return null;
  if (!(await isEnabled("estimates"))) return null;
  try {
    await assertCustomerAccess(user, customerId, "read");
  } catch {
    return null;
  }
  const [rows, tz] = await Promise.all([
    listEstimatesForViewer(user, { customerId }, 20),
    getCompanyTimezone(),
  ]);
  const open = rows.filter((r) =>
    ["draft", "sent", "viewed"].includes(r.status),
  );
  const shown = open.length > 0 ? open : rows.slice(0, 3);
  if (shown.length === 0) return null;
  return (
    <ListSection
      variant="title"
      header={open.length > 0 ? "Open estimates" : "Estimates"}
      trailing={
        user.perms.has("estimates.create") ? (
          <Button
            href={`/estimates/new?customerId=${customerId}`}
            variant="plain"
            size="sm"
          >
            New
          </Button>
        ) : null
      }
      footer={
        open.length > 0
          ? `${formatMoney(open.reduce((a, r) => a + r.totalCents, 0))} waiting on a decision.`
          : undefined
      }
    >
      {shown.map((r) => (
        <ListRow
          key={r.id}
          href={`/estimates/${r.id}`}
          title={
            <span className="flex items-center gap-2">
              <span className="truncate">{r.title ?? r.number}</span>
              <StatusPill kind="estimate" status={r.status} size="sm" />
            </span>
          }
          subtitle={[
            r.number,
            r.sentAt ? `Sent ${formatDate(r.sentAt, tz)}` : "Draft",
          ].join(" · ")}
          detail={<MoneyText cents={r.totalCents} className="text-label" />}
        />
      ))}
    </ListSection>
  );
}
