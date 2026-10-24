import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { estimates, payments, signatures } from "@/db/schema";
import { getMediaUrls, invoicePhotoState } from "@/features/media/api";
import type { InvoiceDoc } from "./doc";
import { invoicePhotoLabel } from "./photo-labels";
import { creditTotals } from "./screen-copy";

// Read model for the invoice screen's section cards (Quote to Paid, Part I): the
// approved estimate behind the invoice (number, option, signed total, signature), the
// customer's sign-off on the job, the deposit applied, the photos on the invoice and
// the latest payment (for "Send receipt"). The caller authorized the invoice first
// (loadInvoiceForViewer); everything here belongs to the same job.

export interface SignatureView {
  id: string;
  signerName: string;
  signedAt: Date;
  channel: string;
  imageUrl: string | null;
}

export interface InvoicePhotoView {
  id: string;
  thumbUrl: string;
  url: string;
  label: ReturnType<typeof invoicePhotoLabel>;
  caption: string | null;
}

export interface InvoiceScreenData {
  /** The job's approved estimate (the latest), with what the customer signed. */
  estimate: {
    id: string;
    number: string;
    optionLabel: string | null;
    signedTotalCents: number | null;
    signature: SignatureView | null;
  } | null;
  /** The customer's "work is done" sign-off on the job (latest). */
  completion: SignatureView | null;
  /** Deposits applied to this invoice, net of their refunds (positive cents). */
  depositCents: number;
  /** Other payments on this invoice, net of their refunds (positive cents). */
  paidCents: number;
  /** Credit notes on this invoice (positive cents). */
  creditCents: number;
  photos: {
    /** Why photos can't go on invoices at all, or null. */
    blocked: string | null;
    items: InvoicePhotoView[];
    /** Job photos that could be picked. */
    available: number;
  };
  /** The newest completed payment on the invoice ("Send receipt" on a paid invoice). */
  latestPaymentId: string | null;
}

/** The newest completed payment on an invoice ("Send receipt"), or null. */
export async function latestPaymentId(
  invoiceId: string,
): Promise<string | null> {
  const [p] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.invoiceId, invoiceId),
        inArray(payments.status, ["succeeded", "partially_refunded"]),
      ),
    )
    .orderBy(desc(payments.succeededAt))
    .limit(1);
  return p?.id ?? null;
}

type Snapshot = {
  option?: { label?: string | null } | null;
  totals?: { totalCents?: number | null } | null;
} | null;

export async function loadInvoiceScreenData(
  doc: InvoiceDoc,
): Promise<InvoiceScreenData> {
  const inv = doc.invoice;
  const jobId = doc.job?.id ?? null;
  const [est, completionRow, photoState, latest] = await Promise.all([
    jobId
      ? db
          .select({
            id: estimates.id,
            number: estimates.number,
            signatureId: estimates.signatureId,
          })
          .from(estimates)
          .where(
            and(eq(estimates.jobId, jobId), eq(estimates.status, "approved")),
          )
          .orderBy(desc(estimates.approvedAt))
          .limit(1)
          .then((r) => r[0] ?? null)
      : null,
    jobId
      ? db
          .select({ id: signatures.id })
          .from(signatures)
          .where(
            and(
              eq(signatures.docType, "completion"),
              eq(signatures.docId, jobId),
            ),
          )
          .orderBy(desc(signatures.signedAt))
          .limit(1)
          .then((r) => r[0] ?? null)
      : null,
    invoicePhotoState(inv.id),
    latestPaymentId(inv.id),
  ]);

  const sigIds = [est?.signatureId, completionRow?.id].filter(
    (x): x is string => !!x,
  );
  const sigs = sigIds.length
    ? await db
        .select({
          id: signatures.id,
          signerName: signatures.signerName,
          signedAt: signatures.signedAt,
          channel: signatures.channel,
          mediaId: signatures.signatureMediaId,
          snapshot: signatures.docSnapshot,
        })
        .from(signatures)
        .where(inArray(signatures.id, sigIds))
    : [];
  const urls = await getMediaUrls(
    sigs.map((s) => s.mediaId).filter((x): x is string => !!x),
    "full",
  );
  const view = (id: string | null | undefined): SignatureView | null => {
    const s = sigs.find((x) => x.id === id);
    return s
      ? {
          id: s.id,
          signerName: s.signerName,
          signedAt: s.signedAt,
          channel: s.channel,
          imageUrl: s.mediaId ? (urls[s.mediaId] ?? null) : null,
        }
      : null;
  };
  const estSig = sigs.find((s) => s.id === est?.signatureId);
  const snap = (estSig?.snapshot ?? null) as Snapshot;

  const { depositCents, paidCents, creditCents } = creditTotals(doc.credits);

  return {
    estimate: est
      ? {
          id: est.id,
          number: est.number,
          optionLabel: snap?.option?.label ?? null,
          signedTotalCents:
            typeof snap?.totals?.totalCents === "number"
              ? snap.totals.totalCents
              : null,
          signature: view(est.signatureId),
        }
      : null,
    completion: view(completionRow?.id),
    depositCents,
    paidCents,
    creditCents,
    photos: {
      blocked: photoState.blocked,
      items: photoState.photos.map((p) => ({
        id: p.id,
        thumbUrl: p.thumbUrl,
        url: p.url,
        label: invoicePhotoLabel(p.tag),
        caption: p.caption,
      })),
      available: photoState.available,
    },
    latestPaymentId: latest,
  };
}
