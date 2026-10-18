import type { Metadata } from "next";
import { CustomerCard } from "@/features/customers/slots";
import { defaultTaxBps } from "@/features/invoices/api";
import {
  DraftLines,
  InvoiceActionBar,
  ReceiptLinkButton,
} from "@/features/invoices/components/InvoiceControls";
import { InvoiceDocument } from "@/features/invoices/components/InvoiceDocument";
import { InvoicePhotosForm } from "@/features/invoices/components/InvoicePhotosForm";
import type { EditorLine } from "@/features/invoices/components/LineEditor";
import { loadInvoiceForViewer } from "@/features/invoices/page-data";
import { InvoicePhotoGrid } from "@/features/media/slots";
import { JobPaymentsPanel } from "@/features/payments/slots";
import { CollectPaymentButton } from "@/features/payments/slots.client";
import { getEntityTags } from "@/features/settings/api";
import { TagEditor } from "@/features/settings/slots.client";
import { requireUser } from "@/lib/auth/current";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/time";
import { Page } from "@/ui/components/AppShell";
import { Banner } from "@/ui/components/Banner";
import { ListGroup, ListRow, ListSection } from "@/ui/components/List";
import { MoneyText } from "@/ui/components/MoneyText";
import { NavBar } from "@/ui/components/NavBar";
import { StatusPill } from "@/ui/components/StatusPill";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Invoice" };

// Invoice detail (SPEC M08; BUILD_PLAN §9 B3): draft editing, issue, revise (snapshot,
// hash, diff, reason), void / write-off, credit notes, photos (S25 + show_photos),
// payments (S16, S19), send/resend, print. Desktop: document left, actions right.
export default async function InvoicesIdPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser("invoices.view");
  const doc = await loadInvoiceForViewer(user, id);
  const inv = doc.invoice;
  const tz = doc.timezone;
  const [taxBps, tagMap] = await Promise.all([
    defaultTaxBps(),
    getEntityTags([{ type: "invoice", id: inv.id }]).catch(() => ({})),
  ]);
  const draft = inv.status === "draft";
  const open =
    (inv.status === "issued" || inv.status === "partially_paid") &&
    inv.balanceCents > 0;
  const canCreate = user.perms.has("invoices.create");
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
  const payments = doc.credits.filter(
    (c) => c.paymentId && c.kind !== "refund",
  );
  const revisedAfterPayment = doc.revisions.some((r) => r.afterPayment);
  const statusKey = inv.overdue ? "overdue" : inv.status;

  return (
    <PageTransition>
      <NavBar
        title={inv.number}
        back={
          doc.job
            ? { href: `/jobs/${doc.job.id}?tab=invoice`, label: doc.job.number }
            : { href: "/invoices", label: "Invoices" }
        }
      />
      <Page className="pt-4">
        {/* Print shows only the document (QA T4-08): app panels carry print:hidden. */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start print:block">
          <div className="min-w-0 space-y-6">
            {/* Hero */}
            <section className="flex flex-wrap items-end justify-between gap-3 px-1 print:hidden">
              <div>
                <StatusPill kind="invoice" status={statusKey} />
                <p className="mt-2 text-footnote text-label-2">
                  {inv.status === "void"
                    ? "Voided"
                    : draft
                      ? "Draft total"
                      : "Balance due"}
                </p>
                <MoneyText
                  cents={draft ? inv.totalCents : inv.balanceCents}
                  className="text-large-title font-bold"
                />
                <p className="text-subhead text-label-2">
                  {doc.customer.displayName}
                  {inv.dueAt && !draft
                    ? ` · due ${formatDate(inv.dueAt, tz)}`
                    : ""}
                  {inv.version > 1 ? ` · v${inv.version}` : ""}
                </p>
              </div>
            </section>

            <div className="print:hidden">
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
                collect={
                  open ? (
                    <CollectPaymentButton
                      invoiceId={inv.id}
                      jobId={doc.job?.id}
                      size="lg"
                      label="Collect payment"
                    />
                  ) : null
                }
                lines={lines}
                notes={inv.notes}
                warrantyText={inv.warrantyText}
                taxBps={taxBps}
                taxExempt={doc.customer.taxExempt}
                allowDiscount={user.perms.has("estimates.discount")}
                showCost={showCost}
                hasPayments={payments.length > 0}
              />
            </div>

            {revisedAfterPayment ? (
              <Banner
                tone="warning"
                title="Revised after payment"
                className="print:hidden"
              >
                This invoice changed after a payment was recorded. It is flagged
                on the anomaly report.
              </Banner>
            ) : null}

            {draft && canCreate ? (
              <ListGroup className="print:hidden">
                <DraftLines
                  invoiceId={inv.id}
                  lines={lines}
                  taxBps={taxBps}
                  taxExempt={doc.customer.taxExempt}
                  allowDiscount={user.perms.has("estimates.discount")}
                  showCost={showCost}
                />
                {doc.credits.length > 0 ? (
                  <ListSection
                    header="Deposits applied"
                    footer="Applied to the balance when the invoice is issued."
                  >
                    {doc.credits.map((c) => (
                      <ListRow
                        key={c.id}
                        title={c.label}
                        detail={formatMoney(-c.amountCents)}
                      />
                    ))}
                  </ListSection>
                ) : null}
              </ListGroup>
            ) : null}
            {draft && canCreate ? (
              <InvoiceDocument doc={doc} className="hidden print:block" />
            ) : (
              <InvoiceDocument
                doc={doc}
                photos={
                  inv.showPhotos ? (
                    <InvoicePhotoGrid invoiceId={inv.id} variant="invoice" />
                  ) : null
                }
              />
            )}
          </div>

          <aside className="min-w-0 space-y-6 print:hidden">
            <CustomerCard
              customerId={doc.customer.id}
              jobId={doc.job?.id}
              variant="compact"
            />

            {doc.job ? <JobPaymentsPanel jobId={doc.job.id} /> : null}

            {payments.length > 0 ? (
              <ListSection header="Receipts">
                {payments.map((p) => (
                  <ListRow
                    key={p.id}
                    title={p.label}
                    subtitle={formatDateTime(p.at, tz)}
                    detail={formatMoney(p.amountCents + p.tipCents)}
                    accessory={
                      p.paymentId ? (
                        <ReceiptLinkButton
                          invoiceId={inv.id}
                          paymentId={p.paymentId}
                        />
                      ) : null
                    }
                    multiline
                  />
                ))}
              </ListSection>
            ) : null}

            {doc.job && canCreate && inv.status !== "void" ? (
              <InvoicePhotosForm
                invoiceId={inv.id}
                jobId={doc.job.id}
                showPhotos={inv.showPhotos}
                selected={inv.photoMediaIds}
                locked={!draft}
              />
            ) : null}

            {doc.revisions.length > 0 ? (
              <ListSection
                header="Versions"
                footer="Each issued version is stored with a SHA-256 fingerprint and can't be changed."
              >
                {doc.revisions.map((r) => (
                  <ListRow
                    key={r.version}
                    title={`v${r.version} · ${r.reason === "issued" ? "Issued" : (r.reason ?? "Revised")}`}
                    subtitle={`${formatDateTime(r.createdAt, tz)}${r.byName ? ` · ${r.byName}` : ""} · ${r.sha256.slice(0, 12)}`}
                    detail={
                      r.afterPayment ? (
                        <span className="text-warning">After payment</span>
                      ) : undefined
                    }
                    multiline
                  />
                ))}
              </ListSection>
            ) : null}

            <ListSection header="Tags">
              <div className="px-4 py-3">
                <TagEditor
                  entityType="invoice"
                  entityId={inv.id}
                  initial={(tagMap as Record<string, never[]>)[inv.id] ?? []}
                  readOnly={!canCreate}
                />
              </div>
            </ListSection>
          </aside>
        </div>
      </Page>
    </PageTransition>
  );
}
