import {
  DocHeader,
  LinesTable,
  PayOnlyNotice,
  TotalsBlock,
} from "@/features/invoices/components/InvoiceDocument";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/time";
import { cx } from "@/ui/cx";
import type { EstimateDoc } from "../doc";

// The estimate as paper (print page, and the read-only body for approved / closed
// estimates). Every option prints with its own totals; the approved one is marked,
// else the Recommended one when there is a choice (2–3 options). Lines carry no
// item badges (older optional add-ons read "(add-on)").
// Policies print in full (SPEC M07 "policies (full text inline)").

const STAMP: Record<string, string> = {
  draft: "Draft",
  approved: "Approved",
  declined: "Declined",
  expired: "Expired",
};

const POLICY_ORDER = ["cooling_off", "warranty", "deposit", "cancellation"];

export function EstimateDocument({
  doc,
  className,
  showPolicies = true,
}: {
  doc: EstimateDoc;
  className?: string;
  showPolicies?: boolean;
}) {
  const e = doc.estimate;
  const tz = doc.timezone;
  const approvedId = e.approvedOptionId;
  const shown = approvedId
    ? doc.options.filter((o) => o.id === approvedId)
    : doc.options;
  const policies = doc.policies
    .filter((p) => POLICY_ORDER.includes(p.kind))
    .sort(
      (a, b) => POLICY_ORDER.indexOf(a.kind) - POLICY_ORDER.indexOf(b.kind),
    );
  return (
    <article
      className={cx(
        "rounded-card bg-card p-5 shadow-card sm:p-8 print:p-0",
        className,
      )}
      aria-label={`Estimate ${e.number}`}
    >
      <DocHeader
        company={doc.company}
        kind="Estimate"
        number={e.number}
        stamp={STAMP[e.status] ?? null}
        meta={[
          { label: "Date", value: formatDate(e.sentAt ?? e.createdAt, tz) },
          ...(e.expiresAt && e.status !== "approved"
            ? [{ label: "Valid until", value: formatDate(e.expiresAt, tz) }]
            : []),
          ...(doc.job ? [{ label: "Job", value: doc.job.number }] : []),
        ]}
      />

      <section className="mt-6 grid gap-4 text-subhead sm:grid-cols-2">
        <div>
          <h3 className="text-footnote uppercase text-label-2">Prepared for</h3>
          <p className="font-medium">{doc.customer.displayName}</p>
          {doc.customer.email ? (
            <p className="break-all text-label-2">{doc.customer.email}</p>
          ) : null}
        </div>
        {doc.propertyLines.length > 0 ? (
          <div>
            <h3 className="text-footnote uppercase text-label-2">
              Service address
            </h3>
            {doc.propertyLines.map((l) => (
              <p key={l}>{l}</p>
            ))}
          </div>
        ) : null}
      </section>

      {e.title ? (
        <h2 className="mt-6 text-title3 font-semibold">{e.title}</h2>
      ) : null}
      {e.notes ? (
        <p className="mt-1 whitespace-pre-line text-subhead text-label-2">
          {e.notes}
        </p>
      ) : null}

      {doc.problemPhotos.length > 0 ? (
        <section className="mt-5" aria-label="Photos of the problem">
          <h3 className="text-footnote uppercase text-label-2">
            What we found
          </h3>
          <div className="print-photos mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {doc.problemPhotos.map((p) => (
              <figure key={p.id} className="m-0">
                {/* biome-ignore lint/performance/noImgElement: signed storage URL */}
                <img
                  src={p.thumbUrl}
                  alt={p.caption ?? "Photo of the problem"}
                  className="aspect-[4/3] w-full rounded-lg object-cover"
                  loading="lazy"
                />
                {p.caption ? (
                  <figcaption className="mt-1 text-footnote text-label-2">
                    {p.caption}
                  </figcaption>
                ) : null}
              </figure>
            ))}
          </div>
        </section>
      ) : null}

      {shown.map((o) => {
        const dep = doc.deposits[o.id];
        const chosen = o.id === approvedId;
        const recommended =
          o.recommended && !approvedId && doc.options.length > 1;
        return (
          <section
            key={o.id}
            className={cx(
              "mt-6 rounded-xl border p-4 print:break-inside-avoid",
              chosen || recommended ? "print-box border-accent" : "border-sep",
            )}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-headline">
                {o.label}
                {chosen ? (
                  <span className="print-strong ml-2 text-footnote font-semibold text-success">
                    ✓ Approved
                  </span>
                ) : recommended ? (
                  <span className="ml-2 text-footnote font-semibold text-accent-text">
                    Recommended
                  </span>
                ) : null}
              </h3>
              <span className="num text-headline">
                {formatMoney(o.totals.totalCents)}
              </span>
            </div>
            {o.notes ? (
              <p className="mt-1 text-subhead text-label-2">{o.notes}</p>
            ) : null}
            <div className="mt-3">
              <LinesTable
                lines={o.lines.map((l) => ({ ...l, qty: Number(l.qty) }))}
                showOptional
              />
            </div>
            <TotalsBlock
              className="mt-3"
              rows={[
                { label: "Subtotal", cents: o.totals.subtotalCents },
                ...(o.totals.discountCents > 0
                  ? [{ label: "Discount", cents: -o.totals.discountCents }]
                  : []),
                {
                  label: doc.customer.taxExempt ? "Tax (exempt)" : "Tax",
                  cents: o.totals.taxCents,
                },
              ]}
              grand={{ label: "Total", cents: o.totals.totalCents }}
            />
            {dep ? (
              <p className="mt-2 text-right text-footnote text-label-2">
                Deposit to book: {formatMoney(dep.amountCents)}
                {dep.capWarning ? ` · ${dep.capWarning}` : ""}
              </p>
            ) : null}
          </section>
        );
      })}

      {e.warrantyText ? (
        <section className="mt-6 text-subhead">
          <h3 className="text-footnote uppercase text-label-2">Warranty</h3>
          <p>{e.warrantyText}</p>
        </section>
      ) : null}

      {doc.signature ? (
        <section
          className="print-box mt-6 rounded-xl border border-sep p-4 text-subhead"
          aria-label="Approval"
        >
          <h3 className="text-footnote uppercase text-label-2">
            {doc.signature.channel === "verbal"
              ? "Approved verbally"
              : "Signed"}
          </h3>
          <div className="mt-2 flex flex-wrap items-end gap-4">
            {doc.signature.imageUrl ? (
              // biome-ignore lint/performance/noImgElement: signed storage URL
              <img
                src={doc.signature.imageUrl}
                alt={`Signature of ${doc.signature.signerName}`}
                className="h-16 w-auto max-w-60 object-contain"
              />
            ) : null}
            <div>
              <p className="font-medium">{doc.signature.signerName}</p>
              <p className="text-footnote text-label-2">
                {formatDateTime(doc.signature.signedAt, tz)} ·{" "}
                {doc.signature.channel.replace("_", " ")}
              </p>
              <p className="break-all font-mono text-caption text-label-3">
                SHA-256 {doc.signature.docSha256}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <div className="mt-5">
        <PayOnlyNotice company={doc.company.name} />
      </div>

      {showPolicies && policies.length > 0 ? (
        <section className="mt-6 space-y-4 text-footnote">
          {policies.map((p) => (
            <div
              key={p.id}
              className={cx(
                p.kind === "cooling_off" &&
                  "print-box rounded-xl border border-sep p-3",
              )}
            >
              <h3 className="font-semibold uppercase text-label-2">
                {p.title}{" "}
                <span className="font-normal normal-case text-label-3">
                  v{p.version}
                </span>
              </h3>
              <p className="whitespace-pre-line text-label-2">
                {p.body.replaceAll("{company}", doc.company.name)}
              </p>
            </div>
          ))}
        </section>
      ) : null}
    </article>
  );
}
