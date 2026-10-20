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
import { PortalJobActions } from "@/features/jobs/components/portal/PortalJobActions";
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
import { Pill } from "@/ui/components/StatusPill";
import { TechCard } from "@/ui/components/TechCard";
import { type Tone, toneStyle } from "@/ui/tone";

export const metadata: Metadata = {
  title: "Your appointment",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

const STATUS_COPY: Record<
  string,
  { title: string; pill: string; tone: Tone; live?: boolean }
> = {
  unscheduled: { title: "We're finding a time", pill: "Booking", tone: "gray" },
  scheduled: { title: "You're booked", pill: "Scheduled", tone: "blue" },
  confirmed: {
    title: "Confirmed, see you then",
    pill: "Confirmed",
    tone: "green",
  },
  en_route: {
    title: "Your technician is on the way",
    pill: "On the way",
    tone: "blue",
    live: true,
  },
  arrived: {
    title: "Your technician has arrived",
    pill: "Arrived",
    tone: "green",
  },
  in_progress: {
    title: "Work in progress",
    pill: "In progress",
    tone: "blue",
    live: true,
  },
  on_hold: {
    title: "Waiting on parts or approval",
    pill: "On hold",
    tone: "orange",
  },
  completed: { title: "All done, thank you!", pill: "Done", tone: "green" },
  closed: { title: "All done, thank you!", pill: "Done", tone: "green" },
  cancelled: {
    title: "This appointment was cancelled",
    pill: "Cancelled",
    tone: "red",
  },
};

const FALLBACK_COPY = {
  title: "You're booked",
  pill: "Scheduled",
  tone: "blue" as Tone,
  live: false,
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
  const copy = STATUS_COPY[job.status] ?? FALLBACK_COPY;
  const start = job.windowStart ?? job.scheduledStart;
  const end = job.windowEnd ?? job.scheduledEnd;
  const invoiceOpen =
    invoice &&
    (invoice.status === "issued" || invoice.status === "partially_paid") &&
    invoice.balanceCents > 0;
  const live = !["completed", "closed", "cancelled"].includes(job.status);

  return (
    <div className="space-y-5 pt-2">
      <section className="card p-5" aria-labelledby="appt-title">
        <div className="flex items-center justify-between gap-3">
          <Pill tone={copy.tone} live={copy.live}>
            {copy.pill}
          </Pill>
          <span className="num truncate text-footnote text-label-2">
            {row.serviceName ?? job.title} · {job.number}
          </span>
        </div>
        <h1 id="appt-title" className="mt-3 text-title1">
          {copy.title}
        </h1>
        <div className="mt-3 flex flex-col gap-2 text-body">
          {start && live ? (
            <p className="flex items-center gap-2.5">
              <CalendarClock
                size={20}
                aria-hidden
                className="shrink-0 text-label-2"
              />
              <span className="num">
                {formatDayShort(start, tz)}
                {end ? ` · ${formatTimeRange(start, end, tz)}` : ""}
              </span>
            </p>
          ) : null}
          {job.completedAt && !live ? (
            <p className="text-subhead text-label-2">
              Completed {formatDateTime(job.completedAt, tz)}
            </p>
          ) : null}
          {prop ? (
            <p className="flex items-center gap-2.5 text-label-2">
              <MapPin size={20} aria-hidden className="shrink-0" />
              <span className="min-w-0 truncate">{addressLines(prop)[0]}</span>
            </p>
          ) : null}
        </div>
      </section>

      {techs.length > 0 ? (
        <section className="space-y-3" aria-label="Your technician">
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
        <section className="flex flex-col gap-2" aria-labelledby="docs-title">
          <h2 id="docs-title" className="px-1 pt-2 text-title3">
            Documents
          </h2>
          <div className="card divide-y divide-sep overflow-hidden">
            {est ? (
              <form
                action={openJobDocument}
                className="flex min-h-[60px] items-center gap-3 px-4 py-2.5"
              >
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="target" value="estimate" />
                <span
                  className="icon-tile tint-bg tint-fg shrink-0"
                  aria-hidden
                  style={toneStyle("accent")}
                >
                  <FileText size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-headline">Estimate {est.number}</p>
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
                <Button type="submit" size="sm" variant="secondary">
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
                className="flex min-h-[60px] items-center gap-3 px-4 py-2.5"
              >
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="target" value="change_order" />
                <input type="hidden" name="id" value={c.id} />
                <span
                  className="icon-tile tint-bg tint-fg shrink-0"
                  aria-hidden
                  style={toneStyle("orange")}
                >
                  <FileText size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-headline">Change {c.number}</p>
                  <p className="text-footnote text-label-2">{c.reason}</p>
                </div>
                <Button type="submit" size="sm" variant="secondary">
                  Review
                </Button>
              </form>
            ))}
            {invoice &&
            invoice.status !== "draft" &&
            invoice.status !== "void" ? (
              <div className="flex min-h-[60px] items-center gap-3 px-4 py-2.5">
                <span
                  className="icon-tile tint-bg tint-fg shrink-0"
                  aria-hidden
                  style={toneStyle("accent")}
                >
                  <Receipt size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-headline">Invoice {invoice.number}</p>
                  <p className="text-footnote text-label-2">
                    {invoiceOpen
                      ? `${formatMoney(invoice.balanceCents)} due`
                      : "Paid, thank you"}
                  </p>
                </div>
                <form action={openJobDocument}>
                  <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="target" value="invoice" />
                  <Button type="submit" size="sm" variant="secondary">
                    View
                  </Button>
                </form>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {invoiceOpen ? (
        <form action={payInvoiceFromPortal}>
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="from" value="j" />
          <Button type="submit" size="lg" block>
            Pay {formatMoney(invoice.balanceCents)}
          </Button>
        </form>
      ) : null}

      <PortalPhotoGallery jobId={job.id} tokenId={tok.id} />

      <PortalFooter />
    </div>
  );
}
