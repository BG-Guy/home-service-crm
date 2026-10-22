import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  customers,
  jobAssignments,
  jobs,
  leads,
  properties,
  scheduledMessages,
  serviceTypes,
  users,
} from "@/db/schema";
import { formatPhoneDisplay } from "@/lib/phone-display";
import { getCompanyTimezone } from "@/lib/settings";
import { dateKey, zonedParts } from "@/lib/time";
import type { SessionUser } from "@/lib/types";

// Reads for the call-to-booking flow (/leads/new → /leads/new/schedule →
// /leads/new/done). Pages call requireUser first and pass the viewer in.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Step 1 values of a lead this flow saved (Back from step 2). */
export interface CallerDraft {
  leadId: string;
  name: string;
  phone: string;
  street: string;
  unit: string;
  city: string;
  state: string;
  zip: string;
  serviceTypeId: string | null;
  service: string;
  notes: string;
  sourceId: string | null;
  priceCents: number | null;
  smsConsent: boolean;
}

export async function getCallerDraft(
  user: SessionUser,
  leadId: string | undefined,
): Promise<CallerDraft | null> {
  if (!leadId || !UUID_RE.test(leadId) || !user.perms.has("leads.edit"))
    return null;
  const [l] = await db
    .select()
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1);
  if (!l || l.status === "booked" || l.status === "spam") return null;
  const a = l.address;
  return {
    leadId: l.id,
    name: l.name ?? "",
    phone: formatPhoneDisplay(l.phone),
    street: a?.street ?? "",
    unit: a?.unit ?? "",
    city: a?.city ?? "",
    state: a?.state ?? "",
    zip: a?.zip ?? "",
    serviceTypeId: l.serviceTypeId,
    service: l.serviceTypeId ? "" : (l.serviceText ?? ""),
    notes: l.notes ?? "",
    sourceId: l.leadSourceId,
    priceCents: l.quotedPriceCents,
    smsConsent: l.smsConsent,
  };
}

/** Step 2: who and where is being booked. */
export interface ScheduleLead {
  leadId: string;
  status: string;
  name: string;
  customerId: string | null;
  propertyId: string | null;
  addressLine: string | null;
  serviceTypeId: string | null;
  serviceName: string | null;
  notes: string | null;
  /** The job this lead already became (status booked). */
  jobId: string | null;
}

export async function getScheduleLead(
  leadId: string | undefined,
): Promise<ScheduleLead | null> {
  if (!leadId || !UUID_RE.test(leadId)) return null;
  const [r] = await db
    .select({
      l: leads,
      customerName: customers.displayName,
      street: properties.street,
      unit: properties.unit,
      city: properties.city,
      serviceName: serviceTypes.name,
    })
    .from(leads)
    .leftJoin(customers, eq(customers.id, leads.customerId))
    .leftJoin(properties, eq(properties.id, leads.propertyId))
    .leftJoin(serviceTypes, eq(serviceTypes.id, leads.serviceTypeId))
    .where(eq(leads.id, leadId))
    .limit(1);
  if (!r) return null;
  const [job] =
    r.l.status === "booked"
      ? await db
          .select({ id: jobs.id })
          .from(jobs)
          .where(eq(jobs.leadId, r.l.id))
          .orderBy(desc(jobs.createdAt))
          .limit(1)
      : [];
  return {
    leadId: r.l.id,
    status: r.l.status,
    name: r.customerName ?? r.l.name ?? "New caller",
    customerId: r.l.customerId,
    propertyId: r.l.propertyId,
    addressLine: r.street
      ? [r.street, r.unit, r.city].filter(Boolean).join(", ")
      : null,
    serviceTypeId: r.l.serviceTypeId,
    serviceName: r.serviceName ?? r.l.serviceText ?? null,
    notes: r.l.notes,
    jobId: job?.id ?? null,
  };
}

/** The booking confirmation text/email, from the real scheduled_messages row. */
export interface ConfirmationState {
  status: string;
  channel: string;
  reason: string | null;
}

/** Step 3. */
export interface BookingDone {
  jobId: string;
  number: string;
  leadId: string | null;
  customerId: string;
  customerName: string;
  date: string | null;
  start: string | null;
  end: string | null;
  techName: string | null;
  confirmation: ConfirmationState | null;
  /** Seconds since the job was created (the page polls briefly for the text). */
  ageSec: number;
}

const hhmm = (d: Date, tz: string) => {
  const p = zonedParts(d, tz);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
};

export async function getBookingDone(
  jobId: string | undefined,
): Promise<BookingDone | null> {
  if (!jobId || !UUID_RE.test(jobId)) return null;
  const [r] = await db
    .select({
      id: jobs.id,
      number: jobs.number,
      leadId: jobs.leadId,
      customerId: jobs.customerId,
      customerName: customers.displayName,
      windowStart: jobs.windowStart,
      windowEnd: jobs.windowEnd,
      createdAt: jobs.createdAt,
    })
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!r) return null;
  const [tz, [tech], [msg]] = await Promise.all([
    getCompanyTimezone(),
    db
      .select({ name: users.name })
      .from(jobAssignments)
      .innerJoin(users, eq(users.id, jobAssignments.userId))
      .where(
        and(
          eq(jobAssignments.jobId, jobId),
          eq(jobAssignments.role, "primary"),
        ),
      )
      .limit(1),
    db
      .select({
        status: scheduledMessages.status,
        channel: scheduledMessages.channel,
        reason: scheduledMessages.lastError,
      })
      .from(scheduledMessages)
      .where(
        and(
          eq(scheduledMessages.jobId, jobId),
          eq(scheduledMessages.templateKey, "job.booked"),
          eq(scheduledMessages.audienceType, "customer"),
        ),
      )
      .orderBy(desc(scheduledMessages.createdAt))
      .limit(1),
  ]);
  return {
    jobId: r.id,
    number: r.number,
    leadId: r.leadId,
    customerId: r.customerId,
    customerName: r.customerName,
    date: r.windowStart ? dateKey(r.windowStart, tz) : null,
    start: r.windowStart ? hhmm(r.windowStart, tz) : null,
    end: r.windowEnd ? hhmm(r.windowEnd, tz) : null,
    techName: tech?.name ?? null,
    confirmation: msg ?? null,
    ageSec: Math.round((Date.now() - r.createdAt.getTime()) / 1000),
  };
}
