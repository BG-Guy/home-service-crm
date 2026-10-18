import type { ReactNode } from "react";
import { formatMoney } from "@/lib/money";
import { formatPhoneDisplay } from "@/lib/phone-display";
import { qrSvg } from "@/lib/qr";
import { formatDate } from "@/lib/time";
import { cx } from "@/ui/cx";
import type { DocCompany, DocLine, InvoiceDoc } from "../doc";
import { discountKindLabel } from "../line-labels";
import { type DocTipLine, invoiceTotalRows } from "../money-lines";

// The invoice as paper (SPEC M08, §12.5). One renderer for the detail screen, the
// print page and the public /i/[token] page, so what the customer sees, what prints
// and what the office reviews are the same document. Server component, no client JS.

const qtyFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

const STAMP: Record<string, string> = {
  draft: "Draft",
  paid: "Paid",
  void: "Void",
  uncollectible: "Written off",
};

export function DocHeader({
  company,
  kind,
  number,
  meta,
  stamp,
}: {
  company: DocCompany;
  kind: string;
  number: string;
  meta: { label: string; value: ReactNode }[];
  stamp?: string | null;
}) {
  return (
    <header
      className={cx(
        "flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between",
        company.headerStyle === "centered" && "sm:flex-col sm:items-center",
      )}
    >
      <div
        className={cx(
          "flex min-w-0 items-start gap-3",
          company.headerStyle === "centered" && "sm:flex-col sm:items-center",
        )}
      >
        {company.logoUrl && company.headerStyle !== "minimal" ? (
          // biome-ignore lint/performance/noImgElement: signed storage URL, printed
          <img
            src={company.logoUrl}
            alt=""
            className="h-12 w-auto max-w-40 rounded-md object-contain"
          />
        ) : null}
        <div
          className={cx(
            "min-w-0",
            company.headerStyle === "centered" && "sm:text-center",
          )}
        >
          <p className="text-title3 font-semibold">{company.name}</p>
          {company.headerStyle !== "minimal" && (
            <div className="text-footnote text-label-2">
              {company.legalName && company.legalName !== company.name && (
                <p>{company.legalName}</p>
              )}
              {company.addressLines.map((l) => (
                <p key={l}>{l}</p>
              ))}
              <p>
                {[formatPhoneDisplay(company.phone), company.email]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {company.licenses.length > 0 && (
                <p>Lic. {company.licenses.join(" · ")}</p>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="shrink-0 sm:text-right">
        <p className="text-footnote font-semibold uppercase tracking-wide text-label-2">
          {kind}
        </p>
        <p className="num text-title2 font-semibold">{number}</p>
        {stamp ? (
          <p className="print-box print-strong mt-1 inline-block rounded-md border-2 border-current px-2 py-0.5 text-footnote font-bold uppercase tracking-wider text-label-2">
            {stamp}
          </p>
        ) : null}
        <dl className="mt-2 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-footnote sm:justify-end">
          {meta.map((m) => (
            <div key={m.label} className="contents">
              <dt className="text-label-2">{m.label}</dt>
              <dd className="num text-right">{m.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </header>
  );
}

export function LinesTable({
  lines,
  showOptional = false,
}: {
  lines: Pick<
    DocLine,
    | "id"
    | "type"
    | "name"
    | "description"
    | "qty"
    | "unitPriceCents"
    | "discountCents"
    | "totalCents"
    | "taxable"
    | "isOptional"
    | "isSelected"
    | "isServiceFee"
    | "warrantyDays"
    | "serial"
  >[];
  showOptional?: boolean;
}) {
  const shown = lines.filter(
    (l) => showOptional || !l.isOptional || l.isSelected,
  );
  if (shown.length === 0)
    return <p className="py-4 text-subhead text-label-2">No items yet.</p>;
  const anyTaxable = shown.some((l) => l.taxable);
  return (
    <>
      <table className="w-full border-collapse text-subhead">
        <thead>
          <tr className="border-b border-sep text-left text-footnote uppercase text-label-2">
            <th scope="col" className="py-2 pr-2 font-medium">
              Description
            </th>
            <th
              scope="col"
              className="hidden py-2 pr-2 text-right font-medium sm:table-cell print:table-cell"
            >
              Qty
            </th>
            <th
              scope="col"
              className="hidden py-2 pr-2 text-right font-medium sm:table-cell print:table-cell"
            >
              Unit
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((l) => {
            const detail = [
              l.description,
              l.serial ? `Serial ${l.serial}` : null,
              l.warrantyDays ? `${l.warrantyDays}-day warranty` : null,
              l.isServiceFee ? "Credited if you approve the repair" : null,
              l.discountCents > 0
                ? `Includes ${formatMoney(l.discountCents)} off`
                : null,
            ].filter(Boolean);
            return (
              <tr key={l.id} className="border-b border-sep/60 align-top">
                <td className="py-2 pr-2">
                  <span className="font-medium">{l.name}</span>
                  {l.isOptional ? (
                    <span className="text-label-2"> (add-on)</span>
                  ) : null}
                  {l.taxable ? (
                    <span className="text-label-3" title="Taxable">
                      {" "}
                      <span aria-hidden>T</span>
                      <span className="sr-only">(taxable)</span>
                    </span>
                  ) : null}
                  <span className="block text-footnote text-label-2 sm:hidden print:hidden">
                    {l.type === "discount"
                      ? discountKindLabel(l.name)
                      : `${qtyFmt.format(l.qty)} × ${formatMoney(l.unitPriceCents)}`}
                  </span>
                  {detail.length > 0 && (
                    <span className="block text-footnote text-label-2">
                      {detail.join(" · ")}
                    </span>
                  )}
                </td>
                <td className="num hidden py-2 pr-2 text-right sm:table-cell print:table-cell">
                  {l.type === "discount" ? "" : qtyFmt.format(l.qty)}
                </td>
                <td className="num hidden py-2 pr-2 text-right sm:table-cell print:table-cell">
                  {l.type === "discount" ? "" : formatMoney(l.unitPriceCents)}
                </td>
                <td className="num py-2 text-right">
                  {formatMoney(l.totalCents)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {anyTaxable ? (
        <p className="mt-1 text-footnote text-label-3">T = taxable item</p>
      ) : null}
    </>
  );
}

export function TotalsBlock({
  rows,
  grand,
  tips,
  className,
}: {
  rows: { label: ReactNode; cents: number; muted?: boolean }[];
  grand: { label: string; cents: number };
  /** Tips paid / refunded, shown under the balance and never part of it (QA2). */
  tips?: readonly DocTipLine[];
  className?: string;
}) {
  return (
    <div className={cx("ml-auto w-full max-w-80 text-subhead", className)}>
      <dl>
        {rows.map((r, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: static order
            key={i}
            className={cx(
              "flex justify-between gap-4 py-0.5",
              r.muted && "text-label-2",
            )}
          >
            <dt className="min-w-0">{r.label}</dt>
            <dd className="num shrink-0">{formatMoney(r.cents)}</dd>
          </div>
        ))}
        <div className="print-box mt-1 flex justify-between gap-4 rounded-lg bg-fill px-3 py-2 text-headline">
          <dt>{grand.label}</dt>
          <dd className="num print-strong">{formatMoney(grand.cents)}</dd>
        </div>
      </dl>
      {tips && tips.length > 0 ? (
        <section aria-label="Tips" className="mt-3 text-footnote text-label-2">
          <h4 className="font-medium">Tips (not part of the invoice)</h4>
          <dl>
            {tips.map((t) => (
              <div key={t.id} className="flex justify-between gap-4 py-0.5">
                <dt className="min-w-0">{t.label}</dt>
                <dd className="num shrink-0">{formatMoney(t.cents)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  );
}

export function PayQr({ url, label }: { url: string; label?: string }) {
  let svg = "";
  try {
    svg = qrSvg(url, { title: label ?? "Scan to pay", ecl: "M" });
  } catch {
    return null;
  }
  return (
    <figure className="flex items-center gap-3">
      <span
        className="block size-24 shrink-0 text-black"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: generated by our own QR encoder (escaped)
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <figcaption className="text-footnote">
        <span className="block font-semibold">{label ?? "Scan to pay"}</span>
        <span className="block break-all text-label-2">{url}</span>
      </figcaption>
    </figure>
  );
}

/** Never-pay-the-tech warning + statement descriptor (M08, chargeback defense). */
export function PayOnlyNotice({
  company,
  descriptor,
}: {
  company: string;
  descriptor?: string | null;
}) {
  return (
    <div className="print-box rounded-xl border border-sep px-3 py-2 text-footnote">
      <p className="print-strong font-semibold">
        Pay only {company}. Never pay a technician personally.
      </p>
      {descriptor ? (
        <p className="text-label-2">
          Card payments appear on your statement as{" "}
          <span className="font-mono text-label">{descriptor}</span>.
        </p>
      ) : null}
    </div>
  );
}

export function InvoiceDocument({
  doc,
  payUrl,
  photos,
  className,
  showRevisionNote = true,
}: {
  doc: InvoiceDoc;
  /** /p/… link rendered as a QR when the invoice is open. */
  payUrl?: string | null;
  /** S26 InvoicePhotoGrid (rendered by the page). */
  photos?: ReactNode;
  className?: string;
  showRevisionNote?: boolean;
}) {
  const { invoice: inv, company, customer, job } = doc;
  const tz = doc.timezone;
  const open =
    (inv.status === "issued" || inv.status === "partially_paid") &&
    inv.balanceCents > 0;
  const meta = [
    ...(inv.issuedAt
      ? [{ label: "Issued", value: formatDate(inv.issuedAt, tz) }]
      : [{ label: "Created", value: formatDate(inv.createdAt, tz) }]),
    ...(inv.dueAt && inv.status !== "draft"
      ? [{ label: "Due", value: formatDate(inv.dueAt, tz) }]
      : []),
    ...(inv.terms ? [{ label: "Terms", value: inv.terms }] : []),
    ...(job ? [{ label: "Job", value: job.number }] : []),
    ...(inv.version > 1 && showRevisionNote
      ? [{ label: "Revision", value: `v${inv.version}` }]
      : []),
  ];
  const stamp = inv.overdue ? "Past due" : (STAMP[inv.status] ?? null);
  const totalRows = invoiceTotalRows(inv, doc.credits, {
    taxExempt: customer.taxExempt,
  });
  return (
    <article
      className={cx(
        "rounded-card bg-card p-5 shadow-card sm:p-8 print:p-0",
        className,
      )}
      aria-label={`Invoice ${inv.number}`}
    >
      <DocHeader
        company={company}
        kind="Invoice"
        number={inv.number}
        meta={meta}
        stamp={stamp}
      />

      <section className="mt-6 grid gap-4 text-subhead sm:grid-cols-3">
        <div>
          <h3 className="text-footnote uppercase text-label-2">Bill to</h3>
          <p className="font-medium">{customer.displayName}</p>
          {customer.companyName &&
            customer.companyName !== customer.displayName && (
              <p>{customer.companyName}</p>
            )}
          {customer.email && (
            <p className="text-label-2 break-all">{customer.email}</p>
          )}
        </div>
        {doc.property && (
          <div>
            <h3 className="text-footnote uppercase text-label-2">
              Service address
            </h3>
            {doc.property.addressLines.map((l) => (
              <p key={l}>{l}</p>
            ))}
          </div>
        )}
        {job && (
          <div>
            <h3 className="text-footnote uppercase text-label-2">Service</h3>
            <p>{job.serviceTypeName ?? job.title}</p>
            {job.serviceDate && (
              <p className="text-label-2">{formatDate(job.serviceDate, tz)}</p>
            )}
            {doc.techs.map((t) => (
              <p key={t.id} className="text-label-2">
                {t.name}
                {t.license ? ` · Lic. ${t.license}` : ""}
              </p>
            ))}
          </div>
        )}
      </section>

      <section className="mt-6" aria-label="Items">
        <LinesTable lines={doc.lines} />
      </section>

      <section className="mt-4 flex flex-col gap-5 sm:flex-row-reverse sm:items-start sm:justify-between">
        <TotalsBlock
          rows={totalRows}
          grand={{
            label: inv.status === "void" ? "Voided" : "Balance due",
            cents: inv.balanceCents,
          }}
          tips={doc.tips}
        />
        {open && payUrl ? (
          <div className="sm:max-w-72">
            <PayQr url={payUrl} />
          </div>
        ) : null}
      </section>

      {inv.status === "void" && inv.voidReason ? (
        <p className="mt-4 text-footnote text-label-2">
          Voided{inv.voidedAt ? ` ${formatDate(inv.voidedAt, tz)}` : ""}:{" "}
          {inv.voidReason}
        </p>
      ) : null}

      <div className="mt-5">
        <PayOnlyNotice company={company.name} descriptor={doc.descriptor} />
      </div>

      {photos ? (
        <section className="mt-6" aria-label="Photos">
          {photos}
        </section>
      ) : null}

      {inv.notes ? (
        <section className="mt-6 text-subhead">
          <h3 className="text-footnote uppercase text-label-2">Notes</h3>
          <p className="whitespace-pre-line">{inv.notes}</p>
        </section>
      ) : null}

      {inv.warrantyText || doc.warrantyPolicy ? (
        <section
          className="mt-6 text-footnote"
          style={{ breakInside: "avoid" }}
        >
          <h3 className="uppercase text-label-2">Warranty</h3>
          {inv.warrantyText ? (
            <p className="text-subhead">{inv.warrantyText}</p>
          ) : null}
          {doc.warrantyPolicy ? (
            <p className="mt-1 whitespace-pre-line text-label-2">
              {excerpt(doc.warrantyPolicy.body, 700)}
            </p>
          ) : null}
        </section>
      ) : null}

      {doc.footer ? (
        <footer className="mt-6 border-t border-sep pt-3 text-center text-footnote text-label-2">
          {doc.footer}
        </footer>
      ) : null}
    </article>
  );
}

export function excerpt(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 40))}…`;
}
