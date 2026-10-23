"use server";

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { zJobKind, zJobPriority } from "@/db/enums";
import { leads, properties } from "@/db/schema";
import { assertCustomerAccess } from "@/features/customers/api";
import { addJobLine } from "@/features/invoices/api";
import { LEAD_QUOTE_LINE_DESCRIPTION } from "@/features/invoices/lead-quote";
import { createBookedJob } from "@/features/jobs/api";
import type { DayAvailability } from "@/features/jobs/availability/types";
import { isJobKind } from "@/features/jobs/kinds";
import { listServiceTypeOptions } from "@/features/jobs/service-types";
import { action } from "@/lib/action";
import { requireUser } from "@/lib/auth/current";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { getCompanyTimezone } from "@/lib/settings";
import { addDaysToKey, dateKey } from "@/lib/time";
import { type ConfirmationLabel, confirmationLabel } from "./booking-labels";
import {
  getBookingDone,
  getScheduleLead,
  loadBookingDays,
} from "./booking-queries";
import { ensureLeadCustomer } from "./ensure-customer";

// The booking flow's writes and reads (contract 3.3): book any saved lead into a
// 2-hour arrival window with no tech (the Assign hub picks one), plus the reads the
// When step and the Done screen call from the client.

const uuid = z.string().uuid();
const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a day.");
const zTime = z.string().regex(/^\d{1,2}:\d{2}$/, "Pick an arrival window.");
const notesText = z.preprocess(
  (v) =>
    v == null || (typeof v === "string" && v.trim() === "") ? undefined : v,
  z.string().trim().max(5000).optional(),
);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BookLeadSchema = z.object({
  leadId: uuid,
  /** The trade job (a "What's the job?" chip); null = the kind's own row. */
  serviceTypeId: z.preprocess(
    (v) => (v === "" ? null : v),
    uuid.nullable().optional(),
  ),
  kind: zJobKind,
  windowDate: zDate,
  windowStart: zTime,
  windowEnd: zTime,
  priority: zJobPriority.default("normal"),
  afterHours: z.boolean().default(false),
  /** What the customer said (the lead's notes, edited): the job's customer notes. */
  customerNotes: notesText,
  clientId: uuid.optional(),
});

/**
 * Book a lead (phone, website, Google, Thumbtack…): creates the job with the
 * arrival window, job type, priority, after-hours, the customer's notes and the day
 * they asked for, marks the lead booked (markLeadConverted) and assigns nobody.
 * The customer's confirmation goes out when the Assign hub sets a tech
 * (job.scheduled), not here.
 */
export const bookLead = action({
  name: "leads.book",
  perm: ["leads.convert", "jobs.create"],
  feature: "leads",
  input: BookLeadSchema,
  audit: "lead.booked",
  async run({ input, tx, user, actor }) {
    // Row lock: a double tap (or two people) books the lead once.
    await tx.execute(
      sql`select 1 from leads where id = ${input.leadId} for update`,
    );
    const [l] = await tx
      .select()
      .from(leads)
      .where(eq(leads.id, input.leadId))
      .limit(1);
    if (!l) throw new NotFoundError("Lead");
    if (l.status === "spam")
      throw new ConflictError("spam", "Mark this lead as not spam first.");
    if (l.status === "booked")
      throw new ConflictError("booked", "This lead is already booked.");
    // A flagged ("Check") lead has no customer yet: booking creates it, since the
    // owner kept booking allowed for flagged leads.
    const linked = l.customerId
      ? { customerId: l.customerId, propertyId: l.propertyId }
      : await ensureLeadCustomer(tx, l, actor);
    const customerId = linked.customerId;
    if (!customerId)
      throw new ConflictError(
        "no_customer",
        "Add a name, phone or email to this lead first.",
      );
    await assertCustomerAccess(user, customerId, "read");
    let propertyId = l.propertyId ?? linked.propertyId;
    if (!propertyId) {
      // No address on the lead: the customer's primary (else first) property.
      const [p] = await tx
        .select({ id: properties.id })
        .from(properties)
        .where(
          and(
            eq(properties.customerId, customerId),
            isNull(properties.deletedAt),
          ),
        )
        .orderBy(desc(properties.isPrimary), asc(properties.createdAt))
        .limit(1);
      propertyId = p?.id ?? null;
    }
    if (!propertyId)
      throw new ValidationError({
        address: ["Add a service address first."],
      });
    const tz = await getCompanyTimezone();
    if (input.windowDate < dateKey(new Date(), tz))
      throw new ValidationError({
        windowDate: ["Pick today or a later day."],
      });
    const created = await createBookedJob(
      tx,
      {
        leadId: l.id,
        customerId,
        propertyId,
        kind: input.kind,
        serviceTypeId: input.serviceTypeId ?? null,
        serviceText: l.serviceTypeId ? null : l.serviceText,
        date: input.windowDate,
        start: input.windowStart,
        end: input.windowEnd,
        priority: input.priority,
        afterHours: input.afterHours,
        customerNotes: input.customerNotes ?? null,
        requestedDate: l.preferredDate,
        requestedWindow: l.preferredWindow,
      },
      actor,
    );
    // The price quoted on the lead becomes the draft invoice's first line, as on
    // New job (QA T2-12). Read from the lead, never the client.
    if (l.quotedPriceCents && l.quotedPriceCents > 0)
      await addJobLine(
        tx,
        created.jobId,
        {
          type: "service",
          name: (l.serviceText?.trim() || created.title).slice(0, 200),
          description: LEAD_QUOTE_LINE_DESCRIPTION,
          qty: 1,
          unitPriceCents: l.quotedPriceCents,
          taxable: false,
        },
        actor,
      );
    return { jobId: created.jobId, number: created.number };
  },
  auditEntity: ({ data }) => ({ type: "job", id: data.jobId }),
  revalidate: ({ input, data }) => [
    "/leads",
    `/leads/${input.leadId}`,
    "/jobs",
    `/jobs/${data.jobId}`,
    "/schedule",
    "/dispatch",
    "/today",
  ],
});

interface DayQuery {
  leadId: string;
  kind: string;
  serviceTypeId?: string | null;
}

async function resolveQuery(q: DayQuery) {
  const user = await requireUser(["leads.convert", "jobs.create"]);
  if (!UUID_RE.test(String(q?.leadId ?? ""))) return null;
  const [lead, types] = await Promise.all([
    getScheduleLead(q.leadId, user),
    listServiceTypeOptions(),
  ]);
  if (!lead || (!lead.propertyId && !lead.address)) return null;
  const kind = isJobKind(q.kind) ? q.kind : "service";
  const st =
    q.serviceTypeId && types.some((t) => t.id === q.serviceTypeId)
      ? q.serviceTypeId
      : null;
  return { lead, job: { kind, serviceTypeId: st, types } };
}

/** The When step: one day with its 2-hour arrival windows (loaded on tap). */
export async function fetchBookingDay(
  q: DayQuery & { date: string },
): Promise<DayAvailability | null> {
  const r = await resolveQuery(q);
  if (!r || !DATE_RE.test(String(q.date ?? ""))) return null;
  const [d] = await loadBookingDays(r.lead, r.job, {
    from: q.date,
    to: q.date,
    withWindows: true,
  });
  return d ?? null;
}

/** The When step's week strip again, after the job type changed (length and skills differ). */
export async function fetchBookingDays(
  q: DayQuery & { from: string; to: string },
): Promise<DayAvailability[]> {
  const r = await resolveQuery(q);
  if (!r || !DATE_RE.test(String(q.from)) || !DATE_RE.test(String(q.to)))
    return [];
  const to = q.to > addDaysToKey(q.from, 59) ? addDaysToKey(q.from, 59) : q.to;
  return loadBookingDays(r.lead, r.job, { from: q.from, to });
}

/** The Done screen's status line, polled on the client after the first paint. */
export async function fetchBookingStatus(
  jobId: string,
): Promise<ConfirmationLabel | null> {
  await requireUser("jobs.create");
  const b = await getBookingDone(String(jobId ?? ""));
  return b ? confirmationLabel(b) : null;
}
