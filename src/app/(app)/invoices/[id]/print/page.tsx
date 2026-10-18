import type { Metadata } from "next";
import { db } from "@/db";
import { InvoiceDocument } from "@/features/invoices/components/InvoiceDocument";
import { PrintBar } from "@/features/invoices/components/PrintBar";
import { loadInvoiceForViewer } from "@/features/invoices/page-data";
import { InvoicePhotoGrid } from "@/features/media/slots";
import { mintPayLink } from "@/features/portal/links";
import { requireUser } from "@/lib/auth/current";

export const metadata: Metadata = { title: "Print invoice" };

// Printable invoice (SPEC M08, §12.5): Letter, 12 pt, photos 2-up (S26), pay QR to a
// /p/ link that stays valid for the paper's life. "Download PDF" = the print dialog.
export default async function InvoicesIdPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ auto?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const user = await requireUser("invoices.view");
  const doc = await loadInvoiceForViewer(user, id);
  const inv = doc.invoice;
  const open =
    (inv.status === "issued" || inv.status === "partially_paid") &&
    inv.balanceCents > 0;
  const payUrl = open
    ? await db.transaction((tx) =>
        mintPayLink(
          tx,
          {
            id: inv.id,
            customerId: doc.customer.id,
            jobId: doc.job?.id ?? null,
            dueAt: inv.dueAt,
          },
          { forPaper: true },
        ),
      )
    : null;
  return (
    <>
      <PrintBar
        backHref={`/invoices/${inv.id}`}
        backLabel="Invoice"
        title={inv.number}
        autoPrint={sp.auto === "1"}
      />
      <div className="mx-auto max-w-[var(--content-max)] px-[var(--gutter)] py-4 print:max-w-none print:p-0">
        <InvoiceDocument
          doc={doc}
          payUrl={payUrl}
          photos={
            inv.showPhotos ? (
              <InvoicePhotoGrid invoiceId={inv.id} variant="invoice" />
            ) : null
          }
        />
      </div>
    </>
  );
}
