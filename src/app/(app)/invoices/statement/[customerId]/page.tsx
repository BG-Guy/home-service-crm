import { Receipt } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  DocHeader,
  PayOnlyNotice,
} from "@/features/invoices/components/InvoiceDocument";
import { PrintBar } from "@/features/invoices/components/PrintBar";
import { descriptorFor, loadDocCompany } from "@/features/invoices/doc";
import { getStatement } from "@/features/invoices/queries";
import { requireUser } from "@/lib/auth/current";
import { formatMoney } from "@/lib/money";
import { getCompanyTimezone } from "@/lib/settings";
import { formatDate } from "@/lib/time";
import { EmptyState } from "@/ui/components/EmptyState";

export const metadata: Metadata = { title: "Statement" };

// Customer statement (SPEC M08): every open invoice on one printable page with the
// total due and the past-due share. Same row scope as the invoice list.
export default async function InvoicesStatementCustomerIdPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  await requireUser("invoices.view");
  const [data, company, tz, descriptor] = await Promise.all([
    getStatement(customerId),
    loadDocCompany(),
    getCompanyTimezone(),
    descriptorFor(null),
  ]);
  if (!data) notFound();
  const now = new Date();
  return (
    <>
      <PrintBar
        backHref={`/customers/${customerId}`}
        backLabel="Customer"
        title="Statement"
      />
      <div className="mx-auto max-w-[var(--content-max)] px-[var(--gutter)] py-4 print:max-w-none print:p-0">
        <article className="rounded-card bg-card p-5 shadow-card sm:p-8 print:p-0">
          <DocHeader
            company={company}
            kind="Statement"
            number={formatDate(now, tz)}
            meta={[
              { label: "Open invoices", value: data.invoices.length },
              { label: "Total due", value: formatMoney(data.totalDueCents) },
            ]}
          />
          <section className="mt-6 text-subhead">
            <h3 className="text-subhead font-semibold text-label-2">Account</h3>
            <p className="font-medium">{data.customer.displayName}</p>
            {data.customer.companyName &&
              data.customer.companyName !== data.customer.displayName && (
                <p>{data.customer.companyName}</p>
              )}
            {data.customer.addressLines.map((l) => (
              <p key={l} className="text-label-2">
                {l}
              </p>
            ))}
          </section>

          {data.invoices.length === 0 ? (
            <EmptyState
              icon={<Receipt size={44} />}
              title="All paid up"
              message={`${data.customer.displayName} has no open invoices.`}
              className="mt-6"
            />
          ) : (
            <table className="mt-6 w-full border-collapse text-subhead">
              <thead>
                <tr className="border-b border-sep text-left text-subhead font-semibold text-label-2">
                  <th scope="col" className="py-2 pr-2 font-medium">
                    Invoice
                  </th>
                  <th scope="col" className="py-2 pr-2 font-medium">
                    Due
                  </th>
                  <th
                    scope="col"
                    className="hidden py-2 pr-2 text-right font-medium sm:table-cell print:table-cell"
                  >
                    Total
                  </th>
                  <th
                    scope="col"
                    className="hidden py-2 pr-2 text-right font-medium sm:table-cell print:table-cell"
                  >
                    Paid
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((r) => (
                  <tr key={r.id} className="border-b border-sep/60 align-top">
                    <td className="py-2 pr-2">
                      <a
                        href={`/invoices/${r.id}`}
                        className="font-medium text-accent-text print:text-label"
                      >
                        {r.number}
                      </a>
                      <span className="block text-footnote text-label-2">
                        {r.issuedAt ? formatDate(r.issuedAt, tz) : ""}
                        {r.jobNumber ? ` · ${r.jobNumber}` : ""}
                      </span>
                    </td>
                    <td className="py-2 pr-2">
                      {r.dueAt ? formatDate(r.dueAt, tz) : "—"}
                      {r.overdue ? (
                        <span className="print-strong block text-footnote font-semibold text-danger">
                          Past due
                        </span>
                      ) : null}
                    </td>
                    <td className="num hidden py-2 pr-2 text-right sm:table-cell print:table-cell">
                      {formatMoney(r.totalCents)}
                    </td>
                    <td className="num hidden py-2 pr-2 text-right sm:table-cell print:table-cell">
                      {formatMoney(r.paidCents)}
                    </td>
                    <td className="num py-2 text-right">
                      {formatMoney(r.balanceCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <dl className="ml-auto mt-4 w-full max-w-80 text-subhead">
            {data.overdueCents > 0 ? (
              <div className="flex justify-between gap-4 py-0.5 text-danger">
                <dt>Past due</dt>
                <dd className="num">{formatMoney(data.overdueCents)}</dd>
              </div>
            ) : null}
            <div className="print-box mt-1 flex justify-between gap-4 rounded-lg bg-fill px-3 py-2 text-headline">
              <dt>Total due</dt>
              <dd className="num print-strong">
                {formatMoney(data.totalDueCents)}
              </dd>
            </div>
          </dl>

          <div className="mt-5">
            <PayOnlyNotice company={company.name} descriptor={descriptor} />
          </div>
        </article>
      </div>
    </>
  );
}
