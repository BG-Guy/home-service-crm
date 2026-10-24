import type { Metadata } from "next";
import { CustomerCard } from "@/features/customers/slots";
import { DEFAULT_ESIGN_CONSENT } from "@/features/estimates/api";
import { defaultTaxBps } from "@/features/invoices/api";
import {
  InvoiceBalanceCard,
  InvoicePhotosCard,
  InvoiceSignaturesCard,
  InvoiceWorkCard,
} from "@/features/invoices/components/InvoiceCards";
import { InvoiceDocument } from "@/features/invoices/components/InvoiceDocument";
import {
  LazyDraftLines as DraftLines,
  LazyInvoiceMoreActions as InvoiceMoreActions,
  LazyInvoicePayBar as InvoicePayBar,
  LazyPreviewButton as PreviewButton,
  LazyReceiptButton as ReceiptButton,
} from "@/features/invoices/components/islands";
import type { EditorLine } from "@/features/invoices/components/LineEditor";
import { loadInvoiceForViewer } from "@/features/invoices/page-data";
import { customerShortName, qtyName } from "@/features/invoices/screen-copy";
import { loadInvoiceScreenData } from "@/features/invoices/screen-data";
import { InvoicePhotoGrid } from "@/features/media/slots";
import { JobPaymentsPanel } from "@/features/payments/slots";
import { getEntityTags } from "@/features/settings/api";
import { TagEditor } from "@/features/settings/slots.client";
import { requireUser } from "@/lib/auth/current";
import { formatMoney } from "@/lib/money";
import { getCurrentPolicy } from "@/lib/policies";
import { docStage, stageStyle } from "@/lib/stage-colors";
import { formatDateTime } from "@/lib/time";
import { DetailLayout, Page } from "@/ui/components/AppShell";
import { Banner } from "@/ui/components/Banner";
import { BottomBar } from "@/ui/components/BottomBar";
import { ListRow, ListSection } from "@/ui/components/List";
import { MoneyText } from "@/ui/components/MoneyText";
import { NavBar } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Invoice" };

/** Job states where the customer can sign off the work (sign-off on the invoice). */
const SIGN_OFF_JOB_STATUSES = new Set(["in_progress", "on_hold", "completed"]);

// Invoice detail (SPEC M08; Quote to Paid Part I): section cards on phones (Balance,
// Work, Photos, Signatures, then Payments, customer, versions, tags), the bar's
// "Send" + "Get paid" (Get paid issues a draft first) or "Send receipt" once paid,
// and "Preview" as the customer. Desktop (≥ 1024 px) shows the document itself in
// place of the compact Work card; the rail carries the bar and the side cards.
// The whole page wears its money stage's color (invoice blue, paid green).
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
  const [taxBps, tagMap, data, esign] = await Promise.all([
    defaultTaxBps(),
    getEntityTags([{ type: "invoice", id: inv.id }]).catch(() => ({})),
    loadInvoiceScreenData(doc),
    doc.job ? getCurrentPolicy("esign_consent").catch(() => null) : null,
  ]);
  const has = (p: string) => user.perms.has(p as never);
  const draft = inv.status === "draft";
  const closed = inv.status === "void" || inv.status === "uncollectible";
  const canCreate = has("invoices.create");
  const canCollect = has("payments.collect") || has("payments.record_manual");
  const showCost = user.baseRole !== "tech" || has("jobs.view_financials");
  const firstName = customerShortName(doc.customer);
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
  const sharedProps = {
    invoiceId: inv.id,
    number: inv.number,
    status: inv.status,
    balanceCents: inv.balanceCents,
    hasLines: doc.lines.length > 0,
    canCreate,
    canRevise: has("invoices.revise"),
    canVoid: has("invoices.void"),
    printHref: `/invoices/${inv.id}/print`,
    lines,
    notes: inv.notes,
    warrantyText: inv.warrantyText,
    taxBps,
    taxExempt: doc.customer.taxExempt,
    allowDiscount: has("estimates.discount"),
    showCost,
    hasPayments: payments.length > 0,
  };
  const paid = inv.status === "paid";
  const barShown =
    !closed &&
    (paid
      ? (canCollect && !!data.latestPaymentId) || canCreate
      : canCollect || canCreate);
  const signOff =
    doc.job &&
    SIGN_OFF_JOB_STATUSES.has(doc.job.status) &&
    (has("jobs.status_own") || has("jobs.status_any"))
      ? {
          customerName: doc.customer.displayName,
          consentText: esign?.body ?? DEFAULT_ESIGN_CONSENT,
          summaryLines: [
            `${doc.job.number} — work completed`,
            doc.customer.displayName,
            ...doc.lines
              .filter((l) => !l.isOptional || l.isSelected)
              .map(
                (l) =>
                  `${qtyName(l.qty, l.name)} — ${formatMoney(l.totalCents)}`,
              ),
            ...(doc.lines.length
              ? [`Total ${formatMoney(inv.totalCents)}`]
              : []),
          ],
        }
      : null;
  const photos = <InvoicePhotoGrid invoiceId={inv.id} variant="invoice" />;

  return (
    <PageTransition>
      <div style={stageStyle(docStage("invoice", inv.status))}>
        <NavBar
          title={inv.number}
          back={
            doc.job
              ? {
                  href: `/jobs/${doc.job.id}?tab=invoice`,
                  label: doc.job.number,
                }
              : { href: "/invoices", label: "Invoices" }
          }
          trailing={
            closed ? undefined : (
              <PreviewButton invoiceId={inv.id} customerFirstName={firstName} />
            )
          }
        />
        <Page className="pt-4">
          {/* Print shows only the document (QA T4-08): app panels carry print:hidden. */}
          <DetailLayout
            railLabel="Invoice summary"
            bar={
              barShown ? (
                <BottomBar
                  label="Invoice actions"
                  className="print:hidden"
                  summary={
                    <InvoicePayBar
                      invoiceId={inv.id}
                      jobId={doc.job?.id ?? null}
                      number={inv.number}
                      status={inv.status}
                      balanceCents={inv.balanceCents}
                      hasLines={doc.lines.length > 0}
                      canCollect={canCollect}
                      canSend={canCreate}
                      customerFirstName={firstName}
                      latestPaymentId={data.latestPaymentId}
                    />
                  }
                />
              ) : undefined
            }
            rail={
              <div className="contents print:hidden">
                {doc.job ? (
                  <JobPaymentsPanel jobId={doc.job.id} hideCollect />
                ) : null}

                {payments.length > 0 ? (
                  <ListSection header="Receipts">
                    {payments.map((p) => (
                      <ListRow
                        key={p.id}
                        title={p.label}
                        subtitle={formatDateTime(p.at, tz)}
                        detail={
                          <MoneyText
                            cents={p.amountCents + p.tipCents}
                            className="text-label"
                          />
                        }
                        accessory={
                          p.paymentId ? (
                            <ReceiptButton paymentId={p.paymentId} />
                          ) : null
                        }
                        multiline
                      />
                    ))}
                  </ListSection>
                ) : null}

                <CustomerCard
                  customerId={doc.customer.id}
                  jobId={doc.job?.id}
                  variant="compact"
                />

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
                      initial={
                        (tagMap as Record<string, never[]>)[inv.id] ?? []
                      }
                      readOnly={!canCreate}
                    />
                  </div>
                </ListSection>

                <InvoiceMoreActions {...sharedProps} />
              </div>
            }
          >
            <InvoiceBalanceCard
              doc={doc}
              data={data}
              canOpenEstimate={has("estimates.view")}
            />

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
              <section
                aria-label="Work"
                className="flex flex-col gap-[var(--section-gap)] print:hidden"
              >
                <DraftLines
                  invoiceId={inv.id}
                  lines={lines}
                  taxBps={taxBps}
                  taxExempt={doc.customer.taxExempt}
                  allowDiscount={has("estimates.discount")}
                  showCost={showCost}
                />
                {doc.credits.length > 0 ? (
                  <ListSection
                    header="Deposits applied"
                    footer="They come off the balance when the invoice is issued."
                  >
                    {doc.credits.map((c) => (
                      <ListRow
                        key={c.id}
                        title={c.label}
                        detail={`−${formatMoney(c.amountCents)}`}
                      />
                    ))}
                  </ListSection>
                ) : null}
              </section>
            ) : (
              <>
                <InvoiceWorkCard doc={doc} className="lg:hidden" />
                {/* Desktop and print: the paper itself, in the Work card's place. */}
                <InvoiceDocument
                  doc={doc}
                  photos={photos}
                  className="hidden lg:block print:block"
                />
              </>
            )}

            {doc.job && !data.photos.blocked ? (
              <InvoicePhotosCard
                invoiceId={inv.id}
                jobId={doc.job.id}
                photos={data.photos}
                canEdit={canCreate && !closed}
                issued={!draft}
              />
            ) : null}

            {doc.job ? (
              <InvoiceSignaturesCard
                data={data}
                jobId={doc.job.id}
                tz={tz}
                signOff={signOff}
              />
            ) : null}

            {/* A draft being edited prints as the paper (shown only in print). */}
            {draft && canCreate ? (
              <InvoiceDocument
                doc={doc}
                photos={photos}
                className="hidden print:block"
              />
            ) : null}
          </DetailLayout>
        </Page>
      </div>
    </PageTransition>
  );
}
