import "server-only";
import { desc, eq } from "drizzle-orm";
import { FileText, Plus } from "lucide-react";
import { db } from "@/db";
import { changeOrders } from "@/db/schema";
import { assertJobAccess } from "@/features/jobs/api";
import { getCurrentUser } from "@/lib/auth/current";
import { formatMoney } from "@/lib/money";
import { getCompanyTimezone, isEnabled } from "@/lib/settings";
import { formatDate } from "@/lib/time";
import { Banner } from "@/ui/components/Banner";
import { Button } from "@/ui/components/Button";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListRow, ListSection } from "@/ui/components/List";
import { MoneyText } from "@/ui/components/MoneyText";
import { StatusPill } from "@/ui/components/StatusPill";
import { getChangeOrderStatus } from "./api";
import { LazyNewChangeOrderButton as NewChangeOrderButton } from "./components/islands";
import type { JobEstimatePanelProps } from "./contracts";
import { listEstimatesForViewer } from "./queries";

// Server UI slots produced by B3 (BUILD_PLAN §5.1). Each checks the viewer, the row
// scope and the `estimates` flag, and returns null when it shouldn't show.

/** S10 — Estimates and change orders for the job (B2 job Estimate tab). */
export async function JobEstimatePanel({ jobId }: JobEstimatePanelProps) {
  const user = await getCurrentUser();
  if (!user || !user.perms.has("estimates.view")) return null;
  if (!(await isEnabled("estimates"))) return null;
  try {
    await assertJobAccess(user, jobId, "read");
  } catch {
    return null;
  }
  const [rows, cos, coStatus, tz] = await Promise.all([
    listEstimatesForViewer(user, { jobId }, 20),
    db
      .select()
      .from(changeOrders)
      .where(eq(changeOrders.jobId, jobId))
      .orderBy(desc(changeOrders.createdAt)),
    getChangeOrderStatus(jobId),
    getCompanyTimezone(),
  ]);
  const canCreate = user.perms.has("estimates.create");
  const approved = rows.some((r) => r.status === "approved");
  return (
    <div className="space-y-4">
      {coStatus.required ? (
        <Banner tone="warning" title="Change order needed">
          The job is now {formatMoney(coStatus.currentTotalCents)}, above the{" "}
          {formatMoney(coStatus.signedTotalCents ?? 0)} the customer signed for.
          Get a signed change order before finishing.
        </Banner>
      ) : null}
      <ListSection
        header="Estimates"
        trailing={
          canCreate && rows.length > 0 ? (
            <Button
              href={`/estimates/new?jobId=${jobId}`}
              variant="plain"
              size="sm"
              icon={<Plus size={16} aria-hidden />}
            >
              New
            </Button>
          ) : null
        }
      >
        {rows.length === 0 ? (
          <EmptyState
            compact
            icon={<FileText size={40} />}
            title="No estimate yet"
            message="Build good / better / best options and have the customer sign before you start."
            action={
              canCreate ? (
                <Button href={`/estimates/new?jobId=${jobId}`} variant="tinted">
                  New estimate
                </Button>
              ) : null
            }
          />
        ) : (
          rows.map((r) => (
            <ListRow
              key={r.id}
              href={`/estimates/${r.id}`}
              title={
                <span className="flex items-center gap-2">
                  <span>{r.number}</span>
                  <StatusPill kind="estimate" status={r.status} size="sm" />
                </span>
              }
              subtitle={[
                r.title,
                r.optionCount > 1 ? `${r.optionCount} options` : null,
                r.sentAt ? `Sent ${formatDate(r.sentAt, tz)}` : "Not sent",
              ]
                .filter(Boolean)
                .join(" · ")}
              detail={<MoneyText cents={r.totalCents} className="text-label" />}
            />
          ))
        )}
      </ListSection>
      {approved || cos.length > 0 ? (
        <ListSection
          header="Change orders"
          footer={
            coStatus.signedTotalCents != null
              ? `Signed ${formatMoney(coStatus.signedTotalCents)} · job now ${formatMoney(coStatus.currentTotalCents)}`
              : undefined
          }
          trailing={
            canCreate && approved ? (
              <NewChangeOrderButton jobId={jobId} />
            ) : null
          }
        >
          {cos.length === 0 ? (
            <p className="px-4 py-3 text-subhead text-label-2">
              Extra work beyond the signed estimate needs a change order.
            </p>
          ) : (
            cos.map((c) => (
              <ListRow
                key={c.id}
                href={`/estimates/co/${c.id}`}
                title={
                  <span className="flex items-center gap-2">
                    <span>{c.number}</span>
                    <StatusPill
                      kind="changeOrder"
                      status={c.status}
                      size="sm"
                    />
                  </span>
                }
                subtitle={c.reason}
                detail={<MoneyText cents={c.deltaCents} signed />}
              />
            ))
          )}
        </ListSection>
      ) : null}
    </div>
  );
}

export { CustomerEstimatesPanel } from "./customer-slots";
