import "server-only";
import { Receipt } from "lucide-react";
import { assertJobAccess } from "@/features/jobs/api";
import { getCurrentUser } from "@/lib/auth/current";
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
  LazyInvoiceActionBar as InvoiceActionBar,
  LazyInvoicePhotosForm as InvoicePhotosForm,
} from "./components/islands";
import type { EditorLine } from "./components/LineEditor";
import type { JobInvoicePanelProps } from "./contracts";
import { loadInvoiceDoc } from "./doc";
import { invoiceTotalRows } from "./money-lines";

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

/** S11 — Invoice summary, lines, totals, status and actions for the job's Invoice tab. */
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
  const [doc, taxBps] = await Promise.all([
    loadInvoiceDoc(summary.id),
    defaultTaxBps(),
  ]);
  if (!doc) return null;
  const inv = doc.invoice;
  const draft = inv.status === "draft";
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
  const credits = doc.credits.filter((c) => c.kind !== "tip_only");
  return (
    <div className="space-y-4">
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
                ? "Draft · no items yet. Add items, then issue it."
                : "Draft · editable until issued"
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

      <InvoiceActionBar
        invoiceId={inv.id}
        number={inv.number}
        status={inv.status}
        balanceCents={inv.balanceCents}
        hasLines={doc.lines.length > 0}
        canCreate={canCreate}
        canRevise={user.perms.has("invoices.revise")}
        canVoid={user.perms.has("invoices.void")}
        printHref={`/invoices/${inv.id}/print`}
        lines={lines}
        notes={inv.notes}
        warrantyText={inv.warrantyText}
        taxBps={taxBps}
        taxExempt={doc.customer.taxExempt}
        allowDiscount={user.perms.has("estimates.discount")}
        showCost={showCost}
        hasPayments={credits.some((c) => c.paymentId)}
      />

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

      {canCreate && inv.status !== "void" ? (
        <InvoicePhotosForm
          invoiceId={inv.id}
          jobId={jobId}
          showPhotos={inv.showPhotos}
          selected={inv.photoMediaIds}
          locked={!draft}
        />
      ) : null}
    </div>
  );
}

export { CustomerInvoicesPanel } from "./customer-slots";
