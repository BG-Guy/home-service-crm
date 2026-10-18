import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { CalendarClock, FileText, MapPin, Receipt } from "lucide-react";
import type { Metadata } from "next";
import { db } from "@/db";
import {
  changeOrders,
  estimates,
  jobAssignments,
  jobs,
  properties,
  serviceTypes,
} from "@/db/schema";
import { getInvoiceForJob } from "@/features/invoices/api";
import { addressLines } from "@/features/invoices/doc";
import { PortalJobActions } from "@/features/jobs/slots.client";
import { PortalPhotoGallery } from "@/features/media/slots";
import {
  openJobDocument,
  payInvoiceFromPortal,
} from "@/features/portal/actions";
import {
  PortalExpired,
  PortalFooter,
} from "@/features/portal/components/PortalChrome";
import { openPortalToken } from "@/features/portal/token";
import { getUserBriefs } from "@/features/team/api";
import { formatMoney } from "@/lib/money";
import { findCompany, getSettings } from "@/lib/settings";
import { formatDateTime, formatDayShort, formatTimeRange } from "@/lib/time";
import { Button } from "@/ui/components/Button";
import { TechCard } from "@/ui/components/TechCard";
import { cx } from "@/ui/cx";

export const metadata: Metadata = {
  title: "Your appointment",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

const STATUS_COPY: Record<string, { title: string; tone: string }> = {
  unscheduled: { title: "We're finding a time", tone: "text-label-2" },
  scheduled: { title: "You're booked", tone: "text-accent-text" },
  confirmed: { title: "Confirmed — see you then", tone: "text-success" },
  en_route: {
    title: "Your technician is on the way",
    tone: "text-accent-text",
  },
  arrived: { title: "Your technician has arrived", tone: "text-success" },
  in_progress: { title: "Work in progress", tone: "text-accent-text" },
  on_hold: { title: "Waiting on parts or approval", tone: "text-warning" },
  completed: { title: "All done — thank you!", tone: "text-success" },
  closed: { title: "All done — thank you!", tone: "text-success" },
  cancelled: { title: "This appointment was cancelled", tone: "text-danger" },
};

// /j/[token] (SPEC M23; BUILD_PLAN §5.3): tech card, status and window, confirm /
// reschedule (S8), the estimate and invoice (fresh magic links on tap), pay, the
// starred photos (S27) and contact. Server-rendered; tiny client islands only.
export default async function JTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const tok = await openPortalToken("job", token, "/j/[token]");
  if (!tok) return <PortalExpired what="appointment link" />;
  const jobId = tok.jobId ?? tok.entityId;
  const [row] = await db
    .select({
      job: jobs,
      serviceName: serviceTypes.name,
    })
    .from(jobs)
    .leftJoin(serviceTypes, eq(serviceTypes.id, jobs.serviceTypeId))
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!row) return <PortalExpired what="appointment" />;
  const job = row.job;
  const [company, settings, prop, assignees, est, cos, invoice] =
    await Promise.all([
      findCompany(),
      getSettings(),
      db
        .select()
        .from(properties)
        .where(eq(properties.id, job.propertyId))
        .limit(1)
        .then((r) => r[0] ?? null),
      db
        .select({ userId: jobAssignments.userId, role: jobAssignments.role })
        .from(jobAssignments)
        .where(eq(jobAssignments.jobId, job.id))
        .orderBy(asc(jobAssignments.role)),
      db
        .select()
        .from(estimates)
        .where(and(eq(estimates.jobId, job.id), ne(estimates.status, "draft")))
        .orderBy(desc(estimates.createdAt))
        .limit(1)
        .then((r) => r[0] ?? null),
      db
        .select()
        .from(changeOrders)
        .where(
          and(
            eq(changeOrders.jobId, job.id),
            inArray(changeOrders.status, ["sent"]),
          ),
        ),
      getInvoiceForJob(job.id),
    ]);
  const tz = company?.timezone ?? "America/New_York";
  const briefs = await getUserBriefs(assignees.map((a) => a.userId));
  const techs = assignees.map((a) => briefs[a.userId]).filter((b) => !!b);
  const copy = STATUS_COPY[job.status] ?? STATUS_COPY.scheduled;
  const start = job.windowStart ?? job.scheduledStart;
  const end = job.windowEnd ?? job.scheduledEnd;
  const invoiceOpen =
    invoice &&
    (invoice.status === "issued" || invoice.status === "partially_paid") &&
    invoice.balanceCents > 0;
  const live = !["completed", "closed", "cancelled"].includes(job.status);

  return (
    <div className="space-y-5 pt-2">
      <section className="px-1">
        <p className="text-footnote font-semibold uppercase text-label-2">
          {row.serviceName ?? job.title} · {job.number}
        </p>
        <h1 className={cx("text-title1 font-bold tracking-tight", copy?.tone)}>
          {copy?.title}
        </h1>
        {start && live ? (
          <p className="mt-1 flex items-center gap-1.5 text-body">
            <CalendarClock size={18} aria-hidden className="text-label-2" />
            {formatDayShort(start, tz)}
            {end ? ` · ${formatTimeRange(start, end, tz)}` : ""}
          </p>
        ) : null}
        {job.completedAt && !live ? (
          <p className="mt-1 text-subhead text-label-2">
            Completed {formatDateTime(job.completedAt, tz)}
          </p>
        ) : null}
        {prop ? (
          <p className="mt-1 flex items-center gap-1.5 text-subhead text-label-2">
            <MapPin size={16} aria-hidden />
            {addressLines(prop)[0]}
          </p>
        ) : null}
      </section>

      {techs.length > 0 ? (
        <section className="space-y-2" aria-label="Your technician">
          {techs.map((t) => {
            const lic = t.licenseNumbers[0];
            return (
              <TechCard
                key={t.id}
                firstName={t.firstName}
                seed={t.id}
                photoUrl={settings.portal.show_tech_photo ? t.avatarUrl : null}
                licenseNo={lic ? `${lic.state} #${lic.number}` : null}
                subtitle="Your technician"
              />
            );
          })}
        </section>
      ) : null}

      {live ? (
        <PortalJobActions
          token={token}
          jobId={job.id}
          status={job.status as never}
          confirmedAt={job.confirmedAt ? job.confirmedAt.toISOString() : null}
        />
      ) : null}

      {est || invoice || cos.length > 0 ? (
        <section
          className="list-card divide-y divide-sep"
          aria-label="Documents"
        >
          {est ? (
            <form
              action={openJobDocument}
              className="flex items-center gap-3 px-4 py-3"
            >
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="target" value="estimate" />
              <FileText
                size={22}
                aria-hidden
                className="shrink-0 text-accent-text"
              />
              <div className="min-w-0 flex-1">
                <p className="text-body">Estimate {est.number}</p>
                <p className="text-footnote text-label-2">
                  {est.status === "approved"
                    ? "Approved"
                    : est.status === "declined"
                      ? "Declined"
                      : est.status === "expired"
                        ? "Expired"
                        : "Waiting for your approval"}
                </p>
              </div>
              <Button type="submit" size="sm" variant="tinted">
                {est.status === "sent" || est.status === "viewed"
                  ? "Review"
                  : "View"}
              </Button>
            </form>
          ) : null}
          {cos.map((c) => (
            <form
              key={c.id}
              action={openJobDocument}
              className="flex items-center gap-3 px-4 py-3"
            >
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="target" value="change_order" />
              <input type="hidden" name="id" value={c.id} />
              <FileText
                size={22}
                aria-hidden
                className="shrink-0 text-warning"
              />
              <div className="min-w-0 flex-1">
                <p className="text-body">Change {c.number}</p>
                <p className="text-footnote text-label-2">{c.reason}</p>
              </div>
              <Button type="submit" size="sm" variant="tinted">
                Review
              </Button>
            </form>
          ))}
          {invoice &&
          invoice.status !== "draft" &&
          invoice.status !== "void" ? (
            <div className="flex items-center gap-3 px-4 py-3">
              <Receipt
                size={22}
                aria-hidden
                className="shrink-0 text-accent-text"
              />
              <div className="min-w-0 flex-1">
                <p className="text-body">Invoice {invoice.number}</p>
                <p className="text-footnote text-label-2">
                  {invoiceOpen
                    ? `${formatMoney(invoice.balanceCents)} due`
                    : "Paid — thank you"}
                </p>
              </div>
              <form action={openJobDocument}>
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="target" value="invoice" />
                <Button type="submit" size="sm" variant="gray">
                  View
                </Button>
              </form>
            </div>
          ) : null}
        </section>
      ) : null}

      {invoiceOpen ? (
        <form action={payInvoiceFromPortal}>
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="from" value="j" />
          <Button type="submit" size="lg" fullWidth>
            Pay {formatMoney(invoice.balanceCents)}
          </Button>
        </form>
      ) : null}

      <PortalPhotoGallery jobId={job.id} tokenId={tok.id} />

      <PortalFooter />
    </div>
  );
}
