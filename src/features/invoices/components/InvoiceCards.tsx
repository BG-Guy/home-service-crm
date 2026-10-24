import { ArrowRight, CircleCheck } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { formatDate, formatInTz } from "@/lib/time";
import { Card } from "@/ui/components/Card";
import { MoneyText } from "@/ui/components/MoneyText";
import { Pill, StatusPill } from "@/ui/components/StatusPill";
import { cx } from "@/ui/cx";
import { Morph } from "@/ui/motion/Morph";
import type { InvoiceDoc } from "../doc";
import { invoiceTotalRows } from "../money-lines";
import { INVOICE_PHOTO_TONE } from "../photo-labels";
import { balanceParts, qtyName } from "../screen-copy";
import type { InvoiceScreenData, SignatureView } from "../screen-data";
import {
  LazyChoosePhotosButton as ChoosePhotosButton,
  LazySignOffButton as SignOffButton,
} from "./islands";

// The invoice screen as section cards (Quote to Paid, Part I; mockup step3-17 /
// step2-9): Balance, Work, Photos, Signatures. Server components; the few buttons
// are lazy client islands. Every card is print:hidden: print shows the document.

/** The soft stage wash at the top of the balance card (follows --accent). */
const WASH: CSSProperties = {
  background:
    "linear-gradient(180deg, color-mix(in srgb, var(--accent) 9%, var(--card)), var(--card) 75%)",
};

/** "2:41 PM" today, else "Oct 24, 2:41 PM". */
export function whenLabel(d: Date, tz: string, now = new Date()): string {
  const day = (x: Date) =>
    formatInTz(x, tz, { year: "numeric", month: "numeric", day: "numeric" });
  return formatInTz(
    d,
    tz,
    day(d) === day(now)
      ? { hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
  );
}

/* ------------------------------------------------------------------ balance */

export function InvoiceBalanceCard({
  doc,
  data,
  canOpenEstimate,
}: {
  doc: InvoiceDoc;
  data: InvoiceScreenData;
  canOpenEstimate: boolean;
}) {
  const inv = doc.invoice;
  const tz = doc.timezone;
  const statusKey = inv.overdue ? "overdue" : inv.status;
  const paid = inv.status === "paid";
  const closed = inv.status === "void" || inv.status === "uncollectible";
  const parts = balanceParts({
    totalCents: inv.totalCents,
    optionLabel: data.estimate?.optionLabel,
    signedTotalCents: data.estimate?.signedTotalCents,
    depositCents: data.depositCents,
    paidCents: data.paidCents,
    creditCents: data.creditCents,
  });
  const due =
    inv.status === "draft"
      ? `Draft · ${inv.terms ?? "due on receipt"} once it's issued`
      : inv.status === "void"
        ? `Voided${inv.voidedAt ? ` ${formatDate(inv.voidedAt, tz)}` : ""}${inv.voidReason ? `: ${inv.voidReason}` : ""}`
        : inv.status === "uncollectible"
          ? "Written off"
          : paid
            ? inv.issuedAt
              ? `Issued ${formatDate(inv.issuedAt, tz)}`
              : null
            : inv.dueAt
              ? `${inv.overdue ? "Past due since" : "Due"} ${formatDate(inv.dueAt, tz)}${inv.terms ? ` · ${inv.terms}` : ""}`
              : (inv.terms ?? null);
  return (
    <Card
      as="section"
      aria-labelledby="inv-balance-h"
      className="flex flex-col gap-1 print:hidden"
      style={WASH}
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="inv-balance-h"
          className="text-footnote font-semibold text-label-2"
        >
          {paid || closed ? "Invoice" : "Balance due"}
        </h2>
        <StatusPill kind="invoice" status={statusKey} size="sm" />
      </div>
      {paid ? (
        <p className="flex items-center gap-2 text-title1 text-success">
          <CircleCheck aria-hidden size={26} />
          Paid in full
        </p>
      ) : (
        <MoneyText
          cents={closed ? inv.totalCents : inv.balanceCents}
          className="block text-[44px] font-bold leading-[1.05] tracking-[-0.03em]"
        />
      )}
      <p className="text-subhead text-label-2">
        {paid ? (
          <MoneyText cents={inv.totalCents} className="text-label" />
        ) : (
          parts.map((p, i) => (
            <span key={p.text} className={p.off ? "text-success" : undefined}>
              {i > 0 ? " · " : ""}
              {p.text}
            </span>
          ))
        )}
        {paid && inv.version > 1 ? ` · v${inv.version}` : null}
      </p>
      {due ? <p className="text-footnote text-label-2">{due}</p> : null}
      <LinkStrip doc={doc} data={data} canOpenEstimate={canOpenEstimate} />
    </Card>
  );
}

/** EST-1026 → J-1079 → INV-1067: what this invoice came from. */
function LinkStrip({
  doc,
  data,
  canOpenEstimate,
}: {
  doc: InvoiceDoc;
  data: InvoiceScreenData;
  canOpenEstimate: boolean;
}) {
  const est = data.estimate;
  const job = doc.job;
  const inv = doc.invoice;
  const arrow = (
    <ArrowRight aria-hidden size={13} className="shrink-0 text-label-3" />
  );
  return (
    <nav
      aria-label="Linked documents"
      className="mt-2 flex flex-wrap items-center gap-1.5 text-footnote font-semibold"
    >
      {est ? (
        <>
          {canOpenEstimate ? (
            <Link
              href={`/estimates/${est.id}`}
              className="num text-accent-text"
            >
              {est.number}
            </Link>
          ) : (
            <span className="num text-label-2">{est.number}</span>
          )}
          {arrow}
        </>
      ) : null}
      {job ? (
        <>
          <Link href={`/jobs/${job.id}`} className="num text-accent-text">
            {job.number}
          </Link>
          {arrow}
        </>
      ) : null}
      <Morph name={`invoice-${inv.id}-title`}>
        <span className="num inline-block text-label" aria-current="page">
          {inv.number}
        </span>
      </Morph>
    </nav>
  );
}

/* ------------------------------------------------------------------ work */

/** Read-only, compact lines and totals of an issued invoice (phones; desktop shows the document). */
export function InvoiceWorkCard({
  doc,
  className,
}: {
  doc: InvoiceDoc;
  className?: string;
}) {
  const inv = doc.invoice;
  const lines = doc.lines.filter((l) => !l.isOptional || l.isSelected);
  const rows = invoiceTotalRows(inv, doc.credits, {
    taxExempt: doc.customer.taxExempt,
  });
  return (
    <Card
      as="section"
      aria-labelledby="inv-work-h"
      className={cx("print:hidden", className)}
    >
      <h2 id="inv-work-h" className="text-headline">
        Work
      </h2>
      {lines.length === 0 ? (
        <p className="mt-1 text-subhead text-label-2">No items.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {lines.map((l) => (
            <li
              key={l.id}
              className="flex items-baseline justify-between gap-3 text-body"
            >
              <span className="min-w-0">{qtyName(l.qty, l.name)}</span>
              <MoneyText cents={l.totalCents} className="shrink-0" />
            </li>
          ))}
        </ul>
      )}
      <dl className="mt-3 flex flex-col gap-1 border-t border-sep pt-3 text-subhead">
        {rows.map((r, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: static order
            key={i}
            className={cx(
              "flex items-baseline justify-between gap-3",
              r.kind === "total" ? "font-semibold" : "text-label-2",
            )}
          >
            <dt className="min-w-0">{r.label}</dt>
            <dd>
              <MoneyText cents={r.cents} className="shrink-0" />
            </dd>
          </div>
        ))}
        <div className="mt-1 flex items-baseline justify-between gap-3 text-headline">
          <dt>{inv.status === "void" ? "Voided" : "Balance due"}</dt>
          <dd>
            <MoneyText cents={inv.balanceCents} className="shrink-0" />
          </dd>
        </div>
      </dl>
      {doc.tips.length > 0 ? (
        <p className="mt-2 text-footnote text-label-2">
          Tips (not part of the invoice):{" "}
          {doc.tips.map((t, i) => (
            <span key={t.id}>
              {i > 0 ? " · " : ""}
              {t.label} <MoneyText cents={t.cents} />
            </span>
          ))}
        </p>
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ photos */

export function InvoicePhotosCard({
  invoiceId,
  jobId,
  photos,
  canEdit,
  issued,
}: {
  invoiceId: string;
  jobId: string;
  photos: InvoiceScreenData["photos"];
  canEdit: boolean;
  issued: boolean;
}) {
  const n = photos.items.length;
  return (
    <Card as="section" aria-labelledby="inv-photos-h" className="print:hidden">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="inv-photos-h" className="text-headline">
          Photos on the invoice
        </h2>
        {photos.available > 0 ? (
          <span className="num shrink-0 text-footnote font-semibold text-accent-text">
            {n} of {photos.available}
          </span>
        ) : null}
      </div>
      {n > 0 ? (
        <ul className="mt-3 grid grid-cols-4 gap-2">
          {photos.items.map((p) => (
            <li
              key={p.id}
              className="relative aspect-square overflow-hidden rounded-xl bg-fill-2"
            >
              {/* biome-ignore lint/performance/noImgElement: signed thumbnails */}
              <img
                src={p.thumbUrl}
                alt={`${p.label}${p.caption ? `: ${p.caption}` : ""}`}
                loading="lazy"
                decoding="async"
                className="size-full object-cover"
              />
              <span
                aria-hidden
                className="absolute bottom-1 left-1 rounded-pill bg-black/55 px-1.5 py-px text-[11px] font-semibold text-white"
              >
                {p.label}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-subhead text-label-2">
          {photos.available > 0
            ? "None yet. Pick the before, during and after photos the customer should see."
            : "No job photos yet. Take a few, then pick the ones for the invoice."}
        </p>
      )}
      {canEdit ? (
        <div className="mt-3">
          <ChoosePhotosButton
            invoiceId={invoiceId}
            jobId={jobId}
            selected={photos.items.map((p) => p.id)}
            issued={issued}
          />
        </div>
      ) : null}
    </Card>
  );
}

/** Plain label chips for photos in documents (Before / During / After). */
export function PhotoLabelChip({
  label,
}: {
  label: keyof typeof INVOICE_PHOTO_TONE;
}) {
  return (
    <Pill tone={INVOICE_PHOTO_TONE[label]} size="sm">
      {label}
    </Pill>
  );
}

/* ------------------------------------------------------------------ signatures */

function SignatureRow({
  sig,
  line,
  tz,
}: {
  sig: SignatureView;
  line: string;
  tz: string;
}) {
  return (
    <div className="flex items-center gap-3">
      {sig.imageUrl ? (
        // biome-ignore lint/performance/noImgElement: signed signature image
        <img
          src={sig.imageUrl}
          alt={`Signature of ${sig.signerName}`}
          className="h-12 w-auto shrink-0 rounded-[10px] bg-white p-1 object-contain"
          style={{ maxWidth: "45%" }}
        />
      ) : null}
      <div className="min-w-0 flex-1 text-right">
        <p className="text-subhead font-semibold">Signed by {sig.signerName}</p>
        <p className="text-footnote text-label-2">
          {line} · {whenLabel(sig.signedAt, tz)}
          {sig.channel === "remote_link"
            ? " · online"
            : sig.channel === "verbal"
              ? " · verbal"
              : ""}
        </p>
      </div>
    </div>
  );
}

export function InvoiceSignaturesCard({
  data,
  jobId,
  tz,
  signOff,
}: {
  data: InvoiceScreenData;
  jobId: string;
  tz: string;
  /** Present when the viewer may ask for the sign-off (job in progress or done). */
  signOff: {
    customerName: string;
    consentText: string;
    summaryLines: string[];
  } | null;
}) {
  const est = data.estimate;
  const done = data.completion;
  if (!est?.signature && !done && !signOff) return null;
  return (
    <Card
      as="section"
      aria-labelledby="inv-sig-h"
      className="flex flex-col gap-3 print:hidden"
    >
      <h2 id="inv-sig-h" className="text-headline">
        Signatures
      </h2>
      {est?.signature ? (
        <SignatureRow
          sig={est.signature}
          line={`${est.number}${est.optionLabel ? ` · ${est.optionLabel}` : ""}`}
          tz={tz}
        />
      ) : null}
      <div
        className={cx(
          "flex flex-wrap items-center justify-between gap-2",
          est?.signature && "border-t border-sep pt-3",
        )}
      >
        {done ? (
          <p className="flex min-w-0 items-center gap-2 text-subhead">
            <CircleCheck
              aria-hidden
              size={18}
              className="shrink-0 text-success"
            />
            <span className="min-w-0">
              Signed off by {done.signerName} · {whenLabel(done.signedAt, tz)}
            </span>
          </p>
        ) : (
          <p className="min-w-0 text-subhead text-label-2">
            Customer sign-off: not yet
          </p>
        )}
        {signOff && !done ? (
          <SignOffButton
            jobId={jobId}
            customerName={signOff.customerName}
            consentText={signOff.consentText}
            summaryLines={signOff.summaryLines}
          />
        ) : null}
      </div>
    </Card>
  );
}
