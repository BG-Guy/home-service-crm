import "server-only";
import { Receipt } from "lucide-react";
import { assertJobAccess } from "@/features/jobs/api";
import { getCurrentUser } from "@/lib/auth/current";
import { docStage, stageStyle } from "@/lib/stage-colors";
import { formatDate } from "@/lib/time";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListRow, ListSection } from "@/ui/components/List";
import { MoneyText } from "@/ui/components/MoneyText";
import { StatusPill } from "@/ui/components/StatusPill";
import { defaultTaxBps, getInvoiceForJob } from "./api";
import { LinesTable, TotalsBlock } from "./components/InvoiceDocument";
import {
  LazyCreateInvoiceButton as CreateInvoiceButton,
  LazyDraftLines as DraftLines,
  LazyInvoicePayBar as InvoicePayBar,
} from "./components/islands";
import type { EditorLine } from "./components/LineEditor";
import type { JobInvoicePanelProps } from "./contracts";
import { loadInvoiceDoc } from "./doc";
import { invoiceTotalRows } from "./money-lines";
import { customerShortName } from "./screen-copy";
import { latestPaymentId } from "./screen-data";

// Server UI slots produced by B3 (BUILD_PLAN §5.1). Each checks its own permission
// and row scope and returns null when the viewer may not see it.

async function canSeeJob(jobId: string) {
  const user = await getCurrentUser();
  if (!user || !user.perms.has("invoices.view")) return null;
  try {
    await assertJobAccess(user, jobId, "read");
  } catch {
    return null;
  }
  return user;
}

/**
 * S11 — Invoice summary, lines and totals for the job's Invoice tab, with ONE main
 * action (Quote to Paid I1): "Get paid" (it issues a draft first) or "Send receipt"
 * once paid. Everything else (send, revise, photos, print) is on the full invoice,
 * one tap away on the summary row.
 */
export async function JobInvoicePanel({ jobId }: JobInvoicePanelProps) {
  const user = await canSeeJob(jobId);
  if (!user) return null;
  const canCreate = user.perms.has("invoices.create");
  const summary = await getInvoiceForJob(jobId);
  if (!summary) {
    return (
      <ListSection header="Invoice">
        <EmptyState
          compact
          icon={<Receipt size={40} />}
          title="No invoice yet"
          message="It's issued automatically when the job is completed with items on it. Start it now to add lines as you go."
          action={canCreate ? <CreateInvoiceButton jobId={jobId} /> : null}
        />
      </ListSection>
    );
  }
  const [doc, taxBps, paymentId] = await Promise.all([
    loadInvoiceDoc(summary.id),
    defaultTaxBps(),
    latestPaymentId(summary.id),
  ]);
  if (!doc) return null;
  const inv = doc.invoice;
  const draft = inv.status === "draft";
  const closed = inv.status === "void" || inv.status === "uncollectible";
  const canCollect =
    user.perms.has("payments.collect") ||
    user.perms.has("payments.record_manual");
  const open =
    (inv.status === "issued" || inv.status === "partially_paid") &&
    inv.balanceCents > 0;
  const showCost =
    user.baseRole !== "tech" || user.perms.has("jobs.view_financials");
  const lines: EditorLine[] = doc.lines.map((l) => ({
    id: l.id,
    type: l.type as EditorLine["type"],
    pricebookItemId: l.pricebookItemId,
    name: l.name,
    description: l.description,
    qty: l.qty,
    unitPriceCents: l.unitPriceCents,
    unitCostCents: l.unitCostCents,
    discountCents: l.discountCents,
    taxable: l.taxable,
    partSource: l.partSource as EditorLine["partSource"],
    warrantyDays: l.warrantyDays,
    manufacturerWarrantyMonths: l.manufacturerWarrantyMonths,
    serial: l.serial,
    isServiceFee: l.isServiceFee,
    isUpsell: l.isUpsell,
    totalCents: l.totalCents,
  }));
  return (
    <div
      className="space-y-4"
      style={stageStyle(docStage("invoice", inv.status))}
    >
      <ListSection header="Invoice">
        <ListRow
          href={`/invoices/${inv.id}`}
          title={
            <span className="flex items-center gap-2">
              <span>{inv.number}</span>
              <StatusPill
                kind="invoice"
                status={inv.overdue ? "overdue" : inv.status}
                size="sm"
              />
            </span>
          }
          subtitle={
            draft
              ? doc.lines.length === 0
                ? "Draft · no items yet. Add items, then get paid."
                : "Draft · Get paid or Send issues it"
              : [
                  inv.issuedAt
                    ? `Issued ${formatDate(inv.issuedAt, doc.timezone)}`
                    : null,
                  inv.dueAt && inv.balanceCents > 0
                    ? `due ${formatDate(inv.dueAt, doc.timezone)}`
                    : null,
                  inv.version > 1 ? `v${inv.version}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
          }
          detail={
            // Open: the balance due. Draft, paid, void: the total (the pill says which).
            open ? (
              <span className="flex flex-col items-end">
                <MoneyText cents={inv.balanceCents} className="text-label" />
                <span className="text-caption text-label-2">due</span>
              </span>
            ) : (
              <MoneyText cents={inv.totalCents} className="text-label" />
            )
          }
          multiline
        />
      </ListSection>

      {canCollect && !closed ? (
        <InvoicePayBar
          layout="panel"
          invoiceId={inv.id}
          jobId={jobId}
          number={inv.number}
          status={inv.status}
          balanceCents={inv.balanceCents}
          hasLines={doc.lines.length > 0}
          canCollect={canCollect}
          canSend={canCreate}
          customerFirstName={customerShortName(doc.customer)}
          latestPaymentId={paymentId}
        />
      ) : null}

      {draft && canCreate ? (
        <DraftLines
          invoiceId={inv.id}
          lines={lines}
          taxBps={taxBps}
          taxExempt={doc.customer.taxExempt}
          allowDiscount={user.perms.has("estimates.discount")}
          showCost={showCost}
        />
      ) : (
        <div className="rounded-card bg-card p-4 shadow-card">
          <LinesTable lines={doc.lines} />
          <TotalsBlock
            className="mt-3"
            rows={invoiceTotalRows(inv, doc.credits, {
              taxExempt: doc.customer.taxExempt,
            })}
            grand={{ label: "Balance due", cents: inv.balanceCents }}
            tips={doc.tips}
          />
        </div>
      )}
    </div>
  );
}

export { CustomerInvoicesPanel } from "./customer-slots";
