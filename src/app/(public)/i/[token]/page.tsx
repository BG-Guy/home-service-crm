import type { Metadata } from "next";
import { InvoiceDocument } from "@/features/invoices/components/InvoiceDocument";
import { loadInvoiceDoc, paymentMethodLabel } from "@/features/invoices/doc";
import { InvoicePhotoGrid } from "@/features/media/slots";
import { getPaymentReceiptData } from "@/features/payments/api";
import { payInvoiceFromPortal } from "@/features/portal/actions";
import { LazyReceiptFlag } from "@/features/portal/components/LazyReceiptFlag";
import {
  PortalExpired,
  PortalFooter,
} from "@/features/portal/components/PortalChrome";
import { PrintButton } from "@/features/portal/components/PrintButton";
import { openPortalToken } from "@/features/portal/token";
import { isUuid } from "@/lib/ids";
import { formatMoney } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { formatDate, formatDateTime } from "@/lib/time";
import { Button } from "@/ui/components/Button";
import { KeyValueList } from "@/ui/components/KeyValueList";
import { SuccessCheck } from "@/ui/components/SuccessCheck";
import { cx } from "@/ui/cx";

/** Card entry modes worth showing; cash/check/p2p repeat the method, so they're omitted. */
const ENTRY_LABEL: Record<string, string> = {
  tap: "Tap to pay",
  chip: "Chip",
  swipe: "Swipe",
  keyed: "Card number entered",
  online: "Online",
  wallet: "Mobile wallet",
};

export const metadata: Metadata = {
  title: "Your invoice",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

// /i/[token] (SPEC M08, M23): view, print and pay the invoice. `?receipt={payment}`
// opens that payment's receipt with "Wrong amount? / I didn't pay this" (S28).
export default async function ITokenPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ receipt?: string }>;
}) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const tok = await openPortalToken("invoice", token, "/i/[token]");
  if (!tok || tok.entityType !== "invoice")
    return <PortalExpired what="invoice link" />;
  const doc = await loadInvoiceDoc(tok.entityId);
  if (!doc || doc.invoice.status === "draft")
    return <PortalExpired what="invoice" />;
  const inv = doc.invoice;
  const tz = doc.timezone;

  // ----- receipt view
  if (sp.receipt && isUuid(sp.receipt)) {
    const r = await getPaymentReceiptData(sp.receipt).catch(() => null);
    if (r && r.invoiceId === inv.id) {
      const settings = await getSettings();
      // Customer-facing labels, never raw enums (QA T4-33).
      const method =
        r.method === "card"
          ? r.methodLabel
          : paymentMethodLabel({ method: r.method });
      const entry = r.entryMode ? ENTRY_LABEL[r.entryMode] : undefined;
      return (
        <div className="space-y-5 pt-2">
          <section className="card flex flex-col items-center px-6 py-8 text-center">
            <SuccessCheck size={64} label="Paid" />
            <p className="num mt-4 text-subhead font-semibold text-label-2">
              Receipt · {inv.number}
            </p>
            <h1 className="num mt-1 text-[44px] font-bold leading-[1.05] tracking-[-0.03em]">
              {formatMoney(r.amountCents + r.tipCents)}
            </h1>
            <p className="mt-1 text-subhead text-label-2">
              Paid · {method} · {formatDateTime(r.at, tz)}
            </p>
          </section>
          <KeyValueList
            items={[
              { label: "Amount", value: formatMoney(r.amountCents) },
              ...(r.tipCents > 0
                ? [{ label: "Tip", value: formatMoney(r.tipCents) }]
                : []),
              { label: "Paid with", value: method },
              ...(entry ? [{ label: "How", value: entry }] : []),
              ...(r.authCode
                ? [{ label: "Auth code", value: r.authCode }]
                : []),
              ...(r.jobNumber ? [{ label: "Job", value: r.jobNumber }] : []),
              ...(r.collectedByName
                ? [{ label: "Collected by", value: r.collectedByName }]
                : []),
              {
                label: "Remaining balance",
                value: formatMoney(r.remainingBalanceCents ?? inv.balanceCents),
              },
            ]}
          />
          {settings.invoices.photos_on_receipt ? (
            <InvoicePhotoGrid
              invoiceId={inv.id}
              variant="receipt"
              tokenId={tok.id}
            />
          ) : null}
          <div className="flex flex-wrap justify-center gap-2 print:hidden">
            <Button href={`/i/${token}`} variant="secondary">
              View invoice
            </Button>
            <PrintButton label="Save receipt" />
          </div>
          <section className="card px-5 py-4 print:hidden">
            <p className="text-subhead text-label-2">
              Something wrong with this payment? Tell us right away and a
              manager will call you.
            </p>
            <div className="mt-2 -ml-3">
              <LazyReceiptFlag token={token} paymentId={r.paymentId} />
            </div>
          </section>
          <PortalFooter />
        </div>
      );
    }
  }

  const open =
    (inv.status === "issued" || inv.status === "partially_paid") &&
    inv.balanceCents > 0;
  return (
    <div className="space-y-5 pt-2">
      <section className="card px-5 pb-5 pt-6 print:hidden">
        {open ? (
          <>
            <p
              className={cx(
                "text-subhead font-semibold",
                inv.overdue ? "text-danger" : "text-label-2",
              )}
            >
              {inv.overdue ? "Past due" : "Amount due"}
              {inv.dueAt ? ` · ${formatDate(inv.dueAt, tz)}` : ""}
            </p>
            <h1 className="num mt-1 text-[44px] font-bold leading-[1.05] tracking-[-0.03em]">
              {formatMoney(inv.balanceCents)}
            </h1>
            <p className="mt-1 text-subhead text-label-2">
              Invoice {inv.number}
            </p>
            <form action={payInvoiceFromPortal} className="mt-5">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="from" value="i" />
              <Button type="submit" size="lg" block>
                Pay {formatMoney(inv.balanceCents)}
              </Button>
            </form>
          </>
        ) : (
          <div className="flex items-center gap-4">
            {inv.status === "void" || inv.status === "uncollectible" ? null : (
              <SuccessCheck size={48} label="Paid" />
            )}
            <div className="min-w-0">
              <h1 className="text-title3">
                {inv.status === "void"
                  ? "This invoice was cancelled"
                  : inv.status === "uncollectible"
                    ? "This invoice is closed"
                    : "Paid in full, thank you!"}
              </h1>
              <p className="num text-subhead text-label-2">
                Invoice {inv.number} · {formatMoney(inv.totalCents)}
              </p>
            </div>
          </div>
        )}
        <div className="mt-3 flex justify-center">
          <PrintButton variant="plain" size="sm" />
        </div>
      </section>

      <InvoiceDocument
        doc={doc}
        photos={
          inv.showPhotos ? (
            <InvoicePhotoGrid
              invoiceId={inv.id}
              variant="portal"
              tokenId={tok.id}
            />
          ) : null
        }
      />
      <PortalFooter />
    </div>
  );
}
