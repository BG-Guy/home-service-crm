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
import { getAvailability } from "@/features/jobs/availability";
import type {
  AvailabilityInput,
  DayAvailability,
} from "@/features/jobs/availability/types";
import { kindDuration } from "@/features/jobs/components/job-type-choice";
import type { ServiceTypeOption } from "@/features/jobs/contracts";
import { isJobKind, type JobKind } from "@/features/jobs/kinds";
import { formatPhoneDisplay } from "@/lib/phone-display";
import { getCompanyTimezone } from "@/lib/settings";
import { dateKey, zonedParts } from "@/lib/time";
import type { SessionUser } from "@/lib/types";
import { getLeadPrefill } from "./api";
import type { LeadPriority } from "./contracts";

// Reads for the booking flow: Who (/leads/new, the caller form) → What + When
// (/leads/new/schedule?leadId=, any saved lead) → Done (/leads/new/done?jobId=).
// Pages call requireUser first and pass the viewer in.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRIORITIES = new Set<string>(["normal", "urgent", "emergency"]);

const priorityOf = (v: unknown): LeadPriority =>
  typeof v === "string" && PRIORITIES.has(v) ? (v as LeadPriority) : "normal";
const kindOrNull = (v: unknown): JobKind | null => (isJobKind(v) ? v : null);

/** Step 1 values of a lead this flow saved (Back from When, or "Who" on any lead). */
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
  /** The job type the office picked (null: derive it from the service type). */
  kind: JobKind | null;
  service: string;
  notes: string;
  sourceId: string | null;
  priceCents: number | null;
  smsConsent: boolean;
  priority: LeadPriority;
  afterHours: boolean;
}

export async function getCallerDraft(
  user: SessionUser,
  leadId: string | undefined,
): Promise<CallerDraft | null> {
  if (!leadId || !UUID_RE.test(leadId) || !user.perms.has("leads.edit"))
    return null;
  const [[l], prefill] = await Promise.all([
    db.select().from(leads).where(eq(leads.id, leadId)).limit(1),
    getLeadPrefill(leadId, user).catch(() => null),
  ]);
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
    kind: kindOrNull(prefill?.kind),
    service: l.serviceTypeId ? "" : (l.serviceText ?? ""),
    notes: l.notes ?? "",
    sourceId: l.leadSourceId,
    priceCents: l.quotedPriceCents,
    smsConsent: l.smsConsent,
    priority: priorityOf(prefill?.priority),
    afterHours: prefill?.afterHours === true,
  };
}

/** What + When: who and where is being booked, and what the lead already says. */
export interface ScheduleLead {
  leadId: string;
  status: string;
  name: string;
  phone: string | null;
  customerId: string | null;
  /** The lead's property, else the customer's primary one. */
  propertyId: string | null;
  /** Typed address on the lead (availability uses it when there's no property yet). */
  address: {
    street: string;
    unit: string | null;
    city: string;
    state: string;
    zip: string;
  } | null;
  /** "4417 Duval St, Austin". */
  addressLine: string | null;
  serviceTypeId: string | null;
  /** What the lead typed ("Garage door won't close"); null when it has a type. */
  serviceText: string | null;
  kind: JobKind | null;
  priority: LeadPriority;
  afterHours: boolean;
  preferredDate: string | null;
  preferredWindow: string | null;
  notes: string | null;
  /** The job this lead already became (status booked). */
  jobId: string | null;
  /** That job was cancelled (the lead has to be reopened before booking again). */
  jobCancelled: boolean;
}

export async function getScheduleLead(
  leadId: string | undefined,
  viewer: SessionUser,
): Promise<ScheduleLead | null> {
  if (!leadId || !UUID_RE.test(leadId)) return null;
  const [[r], prefill] = await Promise.all([
    db
      .select({
        l: leads,
        customerName: customers.displayName,
        customerPhone: customers.phone,
      })
      .from(leads)
      .leftJoin(customers, eq(customers.id, leads.customerId))
      .where(eq(leads.id, leadId))
      .limit(1),
    getLeadPrefill(leadId, viewer).catch(() => null),
  ]);
  if (!r) return null;
  const l = r.l;
  const propertyId = prefill?.propertyId ?? l.propertyId ?? null;
  const [[p], [job]] = await Promise.all([
    propertyId
      ? db
          .select({
            street: properties.street,
            unit: properties.unit,
            city: properties.city,
            state: properties.state,
            zip: properties.zip,
          })
          .from(properties)
          .where(eq(properties.id, propertyId))
          .limit(1)
      : Promise.resolve([]),
    l.status === "booked"
      ? db
          .select({ id: jobs.id, status: jobs.status })
          .from(jobs)
          .where(eq(jobs.leadId, l.id))
          .orderBy(desc(jobs.createdAt))
          .limit(1)
      : Promise.resolve([]),
  ]);
  const a = p
    ? {
        street: p.street,
        unit: p.unit,
        city: p.city ?? "",
        state: p.state ?? "",
        zip: p.zip,
      }
    : l.address?.street && l.address.zip
      ? {
          street: l.address.street,
          unit: l.address.unit ?? null,
          city: l.address.city ?? "",
          state: l.address.state ?? "",
          zip: l.address.zip,
        }
      : null;
  return {
    leadId: l.id,
    status: l.status,
    name: r.customerName ?? l.name ?? "New lead",
    phone: formatPhoneDisplay(r.customerPhone ?? l.phone) || null,
    customerId: l.customerId,
    propertyId,
    address: a,
    addressLine: a
      ? [a.unit ? `${a.street} ${a.unit}` : a.street, a.city]
          .filter(Boolean)
          .join(", ")
      : null,
    serviceTypeId: l.serviceTypeId,
    serviceText: l.serviceTypeId ? null : (l.serviceText ?? null),
    kind: kindOrNull(prefill?.kind),
    priority: priorityOf(prefill?.priority),
    afterHours: prefill?.afterHours === true,
    preferredDate: l.preferredDate ?? null,
    preferredWindow: l.preferredWindow ?? null,
    notes: l.notes,
    jobId: job?.id ?? l.convertedJobId ?? null,
    jobCancelled: job?.status === "cancelled",
  };
}

/**
 * Bookable days for a lead's location and job type. With `withWindows`, each day
 * carries its 2-hour arrival windows (the strip asks for the picked day only).
 */
export async function loadBookingDays(
  lead: Pick<ScheduleLead, "propertyId" | "address" | "preferredDate">,
  job: {
    kind: JobKind;
    serviceTypeId: string | null;
    types: readonly ServiceTypeOption[];
  },
  range: { from: string; to: string; withWindows?: boolean },
): Promise<DayAvailability[]> {
  const input: AvailabilityInput = {
    from: range.from,
    to: range.to,
    withWindows: range.withWindows,
    propertyId: lead.propertyId,
    address: lead.propertyId ? null : lead.address,
    serviceTypeId: job.serviceTypeId,
    kind: job.kind,
    durationMin: kindDuration(job.types, job.kind, job.serviceTypeId),
    requestedDate: lead.preferredDate,
  };
  return getAvailability(input);
}

/** The booking confirmation text/email, from the real scheduled_messages row. */
export interface ConfirmationState {
  status: string;
  channel: string;
  reason: string | null;
}

/** Done. */
export interface BookingDone {
  jobId: string;
  number: string;
  leadId: string | null;
  customerId: string;
  customerName: string;
  /** The trade job or type ("Rekey"), else the job title. */
  serviceName: string;
  date: string | null;
  start: string | null;
  end: string | null;
  techName: string | null;
  confirmation: ConfirmationState | null;
  /** Seconds since the job was created. */
  ageSec: number;
}

const hhmm = (d: Date, tz: string) => {
  const p = zonedParts(d, tz);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
};

/** The job's tech and confirmation (the Done screen polls this on the client). */
export async function getBookingStatus(jobId: string): Promise<{
  techName: string | null;
  confirmation: ConfirmationState | null;
}> {
  const [[tech], [msg]] = await Promise.all([
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
  return { techName: tech?.name ?? null, confirmation: msg ?? null };
}

/** One read, no waiting: the Done screen renders at once and the status fills in after. */
export async function getBookingDone(
  jobId: string | undefined,
): Promise<BookingDone | null> {
  if (!jobId || !UUID_RE.test(jobId)) return null;
  const [[r], tz, status] = await Promise.all([
    db
      .select({
        id: jobs.id,
        number: jobs.number,
        title: jobs.title,
        leadId: jobs.leadId,
        customerId: jobs.customerId,
        customerName: customers.displayName,
        typeName: serviceTypes.name,
        windowStart: jobs.windowStart,
        windowEnd: jobs.windowEnd,
        createdAt: jobs.createdAt,
      })
      .from(jobs)
      .innerJoin(customers, eq(customers.id, jobs.customerId))
      .leftJoin(serviceTypes, eq(serviceTypes.id, jobs.serviceTypeId))
      .where(eq(jobs.id, jobId))
      .limit(1),
    getCompanyTimezone(),
    getBookingStatus(jobId),
  ]);
  if (!r) return null;
  return {
    jobId: r.id,
    number: r.number,
    leadId: r.leadId,
    customerId: r.customerId,
    customerName: r.customerName,
    serviceName: r.typeName ?? r.title,
    date: r.windowStart ? dateKey(r.windowStart, tz) : null,
    start: r.windowStart ? hhmm(r.windowStart, tz) : null,
    end: r.windowEnd ? hhmm(r.windowEnd, tz) : null,
    techName: status.techName,
    confirmation: status.confirmation,
    ageSec: Math.round((Date.now() - r.createdAt.getTime()) / 1000),
  };
}
