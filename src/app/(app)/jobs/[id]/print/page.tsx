import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCustomerBrief, getPropertyBrief } from "@/features/customers/api";
import { PrintButton } from "@/features/jobs/components/PrintButton";
import { HOLD_REASON_LABEL, PRIORITY_LABEL } from "@/features/jobs/machine";
import { getJobDetail, listNotes } from "@/features/jobs/queries";
import { requireAnyPerm } from "@/lib/auth/current";
import { formatPhone } from "@/lib/phone";
import { getCompany, getCompanyTimezone } from "@/lib/settings";
import {
  formatDate,
  formatDateTime,
  formatDayShort,
  formatTimeRange,
} from "@/lib/time";
import { NavBar } from "@/ui/components/NavBar";
import { statusDef } from "@/ui/status";

export const metadata: Metadata = { title: "Work order" };

/** Printable work order (SPEC M05): letter-size, no app chrome when printed. */
export default async function JobPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAnyPerm(["jobs.view_all", "jobs.view_own"]);
  const { id } = await params;
  const job = await getJobDetail(id);
  if (!job) notFound();
  const [company, tz, customer, property, notes] = await Promise.all([
    getCompany(),
    getCompanyTimezone(),
    getCustomerBrief(job.customerId, user, { jobId: job.id }).catch(() => null),
    getPropertyBrief(job.propertyId, user, { jobId: job.id }).catch(() => null),
    listNotes({ type: "job", id: job.id }, 20),
  ]);
  const start = job.windowStart ?? job.scheduledStart;
  const end = job.windowEnd ?? job.scheduledEnd;
  const phone = customer?.contactRevealed
    ? customer.phone
    : (customer?.phoneMasked ?? null);

  const Row = ({
    label,
    children,
  }: {
    label: string;
    children: React.ReactNode;
  }) => (
    <div className="grid grid-cols-[130px_1fr] gap-2 py-1">
      <dt className="text-footnote font-semibold uppercase tracking-wide text-label-2">
        {label}
      </dt>
      <dd className="text-subhead">{children}</dd>
    </div>
  );

  return (
    <>
      <div className="print:hidden">
        <NavBar
          title="Work order"
          back={{ href: `/jobs/${job.id}`, label: job.number }}
          trailing={<PrintButton />}
        />
      </div>
      <article className="mx-auto my-4 max-w-[8.5in] bg-white p-8 text-black shadow-card print:my-0 print:max-w-none print:p-0 print:shadow-none">
        <header className="flex items-start justify-between border-b border-black/20 pb-4">
          <div>
            <p className="text-title3 font-bold">{company.name}</p>
            {company.phone && (
              <p className="text-subhead">{formatPhone(company.phone)}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-title2 font-bold">Work order</p>
            <p className="num text-headline">{job.number}</p>
            <p className="text-footnote text-black/60">
              Printed {formatDateTime(new Date(), tz)}
            </p>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-6 border-b border-black/20 py-4">
          <dl>
            <Row label="Customer">{job.customerName}</Row>
            {phone && <Row label="Phone">{formatPhone(phone)}</Row>}
            <Row label="Address">
              {property?.masked
                ? `${property.addressShort}, ${property.city}, ${property.state} ${property.zip}`
                : job.addressFull}
            </Row>
            {property?.accessNotes && (
              <Row label="Access">{property.accessNotes}</Row>
            )}
            {property?.gateCode && (
              <Row label="Gate code">{property.gateCode}</Row>
            )}
            {property?.pets && <Row label="Pets">{property.pets}</Row>}
            {property?.siteContactName && (
              <Row label="Site contact">
                {property.siteContactName}
                {property.siteContactPhone
                  ? ` · ${formatPhone(property.siteContactPhone)}`
                  : ""}
              </Row>
            )}
          </dl>
          <dl>
            <Row label="Status">
              {statusDef("job", job.status).label}
              {job.holdReason
                ? ` (${HOLD_REASON_LABEL[job.holdReason] ?? job.holdReason})`
                : ""}
            </Row>
            <Row label="Scheduled">
              {start
                ? `${formatDayShort(start, tz)}${end ? `, ${formatTimeRange(start, end, tz)}` : ""}`
                : "Not scheduled"}
            </Row>
            <Row label="Technician">
              {job.assignees
                .map(
                  (a) => `${a.name}${a.role === "helper" ? " (helper)" : ""}`,
                )
                .join(", ") || "Unassigned"}
            </Row>
            <Row label="Service">{job.serviceTypeName ?? "—"}</Row>
            <Row label="Priority">
              {PRIORITY_LABEL[job.priority]}
              {job.afterHours ? " · after hours" : ""}
            </Row>
            {job.isCallback && (
              <Row label="Callback of">{job.callbackOfNumber ?? "—"}</Row>
            )}
            {job.warrantyExpiresAt && (
              <Row label="Warranty">
                Until {formatDate(job.warrantyExpiresAt, tz)}
              </Row>
            )}
          </dl>
        </section>

        <section className="border-b border-black/20 py-4">
          <h2 className="text-headline font-semibold">{job.title}</h2>
          {job.customerNotes && (
            <p className="mt-2 whitespace-pre-wrap text-subhead">
              <span className="font-semibold">Customer says: </span>
              {job.customerNotes}
            </p>
          )}
          {job.description && (
            <p className="mt-2 whitespace-pre-wrap text-subhead">
              {job.description}
            </p>
          )}
        </section>

        {job.checklist.length > 0 && (
          <section className="border-b border-black/20 py-4">
            <h2 className="mb-2 text-headline font-semibold">Checklist</h2>
            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 print:grid-cols-2">
              {job.checklist.map((i) => (
                <li key={i.id} className="flex items-start gap-2 text-subhead">
                  <span
                    aria-hidden
                    className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center border border-black/60 text-[11px]"
                  >
                    {i.answer != null && i.answer !== false ? "✓" : ""}
                  </span>
                  {i.label}
                  {i.required ? " *" : ""}
                </li>
              ))}
            </ul>
          </section>
        )}

        {notes.length > 0 && (
          <section className="border-b border-black/20 py-4">
            <h2 className="mb-2 text-headline font-semibold">Notes</h2>
            <ul className="flex flex-col gap-1.5">
              {notes.map((n) => (
                <li key={n.id} className="text-subhead">
                  <span className="text-black/60">
                    {formatDate(n.createdAt, tz)} · {n.authorName ?? "—"}:
                  </span>{" "}
                  {n.body}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="py-4">
          <h2 className="mb-2 text-headline font-semibold">Work performed</h2>
          <div className="flex flex-col gap-6">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="border-b border-black/30" />
            ))}
          </div>
          <div className="mt-10 grid grid-cols-2 gap-10 text-footnote">
            <div className="border-t border-black/60 pt-1">
              Technician signature &amp; date
            </div>
            <div className="border-t border-black/60 pt-1">
              Customer signature &amp; date
            </div>
          </div>
        </section>
      </article>
    </>
  );
}
