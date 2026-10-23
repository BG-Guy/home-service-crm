"use server";

import { and, asc, desc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "@/db";
import { zJobKind } from "@/db/enums";
import {
  apiKeys,
  jobs,
  leadEvents,
  leadSources,
  leads,
  properties,
  sourceSpend,
} from "@/db/schema";
import {
  ensureProperty,
  findCustomerMatch,
  logCall,
  updateContactFromLead,
} from "@/features/customers/api";
import {
  cancelScheduledMessages,
  enqueueMessage,
} from "@/features/messaging/api";
import { validateCustomValues } from "@/features/settings/api";
import { closeTasksFor, createTask } from "@/features/tasks/api";
import { action, zf } from "@/lib/action";
import { writeActivity } from "@/lib/activity";
import { requireUser } from "@/lib/auth/current";
import { appUrl } from "@/lib/env";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { emit } from "@/lib/events";
import { getSettings, updateSettings } from "@/lib/settings";
import type { Actor } from "@/lib/types";
import { markLeadResponded } from "./api";
import type {
  CallerLookup,
  CallerMatch,
  CallerOpenLead,
  IssuedSecrets,
  LeadCardData,
  LeadChangeResult,
  LeadPreviewResult,
  LeadStatus,
} from "./contracts";
import { ensureLeadCustomer } from "./ensure-customer";
import { dedupeHashOf, previewLead, processLead } from "./intake/process";
import {
  hashKey,
  newHookSecret,
  newPublicKey,
  newSecretKey,
  randomToken,
} from "./keys";
import { lostReasonLabel } from "./labels";
import {
  getLeadCard,
  type LeadFilter,
  leadStatusHistory,
  listLeads,
  openLeadsForPhone,
} from "./queries";
import {
  isOpenStatus,
  previousOpenStatus,
  releaseRule,
  reopenRule,
  STATUS_WORD,
  type StatusEventRaw,
  undoPatch,
} from "./rules";

// Lead mutations (SPEC M04). Every write: action() → perm + flag → zod → one tx with
// the domain write + events + audit + activity → revalidate.

const uuid = z.string().uuid();
const optText = (max = 200) => zf.optionalText(max);
const optUuid = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  uuid.optional(),
);
const LEADS_PATHS = (id?: string) => [
  "/leads",
  ...(id ? [`/leads/${id}`] : []),
];

type LeadRow = typeof leads.$inferSelect;

async function loadLead(tx: Tx, id: string): Promise<LeadRow> {
  const [l] = await tx.select().from(leads).where(eq(leads.id, id)).limit(1);
  if (!l) throw new NotFoundError("Lead");
  return l;
}

/** Row lock: two people changing one lead at once → one after the other. */
async function lockLead(tx: Tx, id: string): Promise<LeadRow> {
  await tx.execute(sql`select 1 from leads where id = ${id} for update`);
  return loadLead(tx, id);
}

/**
 * Status change with its lead_events row, event and activity. The row records
 * what the change overwrote (`raw.prev`), so Undo can put it back
 * (`undoLeadChange`). Returns that row's id; null when nothing changed. `record`
 * writes the row even when the status stays (Looks legit, Undo of it).
 */
async function changeStatus(
  tx: Tx,
  l: LeadRow,
  to: LeadStatus,
  actor: Actor,
  extra: Partial<LeadRow> = {},
  summary?: string,
  opts: { record?: boolean; raw?: Record<string, unknown> } = {},
): Promise<string | null> {
  const moved = l.status !== to;
  if (!moved && Object.keys(extra).length === 0 && !opts.record) return null;
  await tx
    .update(leads)
    .set({ status: to, ...extra, updatedAt: new Date() })
    .where(eq(leads.id, l.id));
  if (!moved && !opts.record) return null;
  const entity = { type: "lead", id: l.id } as const;
  const raw: StatusEventRaw & Record<string, unknown> = {
    from: l.status,
    to,
    lost_reason: extra.lostReason ?? null,
    prev: {
      lost_reason: l.lostReason,
      spam_score: l.spamScore,
      spam_reason: l.spamReason,
      converted_job_id: l.convertedJobId,
    },
    ...opts.raw,
  };
  const [ev] = await tx
    .insert(leadEvents)
    .values({
      leadId: l.id,
      kind: "status",
      outcome: to,
      actorUserId: actor.userId,
      raw,
    })
    .returning({ id: leadEvents.id });
  if (moved)
    await emit(
      tx,
      "lead.status_changed",
      entity,
      {
        lead_id: l.id,
        from: l.status,
        to,
        lost_reason: extra.lostReason ?? null,
      },
      { actor },
    );
  await writeActivity(tx, {
    entity,
    customerId: l.customerId,
    kind: "lead.status_changed",
    summary:
      summary ??
      `Status: ${STATUS_WORD[l.status as LeadStatus] ?? l.status} → ${STATUS_WORD[to]}`,
    actorUserId: actor.userId,
  });
  return ev?.id ?? null;
}

const changed = (
  l: LeadRow,
  status: LeadStatus,
  eventId: string | null,
): LeadChangeResult => ({ leadId: l.id, status, eventId });

// ------------------------------------------------------------------ manual entry

const isoDay = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.")
    .optional(),
);

const manualLeadSchema = z.object({
  sourceId: z.string().uuid({ message: "Choose how they heard about you." }),
  name: optText(200),
  phone: optText(40),
  email: optText(200),
  address: optText(300),
  serviceTypeId: optUuid,
  service: optText(120),
  price: optText(30),
  priceCents: zf.optionalInt(),
  preferredDate: isoDay,
  preferredWindow: optText(60),
  notes: optText(5000),
  smsConsent: zf.checkbox(),
  custom: z.record(z.string(), z.unknown()).optional(),
  /** Booking prefs typed on the call (contract 3.2), kept on the lead until Book. */
  kind: z.preprocess((v) => (v === "" ? undefined : v), zJobKind.optional()),
  priority: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(["normal", "urgent", "emergency"]).optional(),
  ),
  afterHours: zf.checkbox().optional(),
  clientId: z.string().uuid().optional(),
});

type ManualIntake = Omit<z.infer<typeof manualLeadSchema>, "clientId"> & {
  street?: string;
  unit?: string;
  city?: string;
  state?: string;
  zip?: string;
};

/** The call's booking prefs → `leads.extra._booking` (read back by getLeadPrefill). */
function bookingExtra(
  input: Pick<ManualIntake, "kind" | "priority" | "afterHours">,
): Record<string, unknown> | null {
  if (!input.kind && !input.priority && !input.afterHours) return null;
  return {
    kind: input.kind ?? null,
    priority: input.priority ?? null,
    after_hours: input.afterHours === true,
  };
}

async function saveBookingPrefs(
  tx: Tx,
  leadId: string,
  input: Pick<ManualIntake, "kind" | "priority" | "afterHours">,
): Promise<void> {
  const b = bookingExtra(input);
  if (!b) return;
  await tx
    .update(leads)
    .set({
      extra: sql`coalesce(${leads.extra}, '{}'::jsonb) || jsonb_build_object('_booking', ${JSON.stringify(b)}::jsonb)`,
    })
    .where(eq(leads.id, leadId));
}

/**
 * Phone leads count as answered (build SPEC fix): the office typed them in while
 * talking to the caller, so the first response is now, by them, and a new lead
 * is contacted (and theirs when nobody has it). The missed-lead automations
 * (auto-reply, 5/15-min alerts, "tried to reach you") check `lead.status = new`
 * and skip it.
 */
async function answerPhoneLead(
  tx: Tx,
  leadId: string,
  userId: string,
  actor: Actor,
): Promise<void> {
  await markLeadResponded(tx, leadId, { userId, channel: "call" }, actor);
  const l = await loadLead(tx, leadId);
  if (l.status === "new")
    await changeStatus(
      tx,
      l,
      "contacted",
      actor,
      { assignedUserId: l.assignedUserId ?? userId },
      "Answered on the phone",
    );
}

/** The manual-entry intake (createLead, createLeadAndCustomer): same pipeline as a web form. */
async function runManualIntake(
  tx: Tx,
  input: ManualIntake,
  actor: Actor,
  opts: { merge?: boolean } = {},
): Promise<{ leadId: string; merged: boolean }> {
  if (!input.name && !input.phone && !input.email)
    throw new ValidationError({ name: ["Enter a name, phone or email."] });
  const [src] = await tx
    .select()
    .from(leadSources)
    .where(eq(leadSources.id, input.sourceId))
    .limit(1);
  if (!src) throw new ValidationError({ sourceId: ["Choose a source."] });
  let service = input.service ?? null;
  if (input.serviceTypeId && !service) {
    const { getServiceType } = await import("@/features/settings/api");
    service = (await getServiceType(input.serviceTypeId))?.name ?? null;
  }
  let custom: Record<string, unknown> = {};
  if (input.custom && Object.keys(input.custom).length) {
    const v = await validateCustomValues("lead", input.custom);
    if (!v.ok) throw new ValidationError(v.fieldErrors);
    custom = v.values;
  }
  // `merge: false` ("Start a new one"): the intake skips its double-submit and
  // same-service merges but still links the existing customer.
  const outcome = await processLead(
    {
      auth: { kind: "manual", source: src, actor },
      channel: "manual",
      raw: {
        name: input.name,
        phone: input.phone,
        email: input.email,
        address: input.address,
        street: input.street,
        unit: input.unit,
        city: input.city,
        state: input.state,
        zip: input.zip,
        service,
        price:
          input.priceCents != null
            ? (input.priceCents / 100).toFixed(2)
            : input.price,
        preferred_date: input.preferredDate,
        preferred_window: input.preferredWindow,
        notes: input.notes,
        sms_consent: input.smsConsent,
        ...(Object.keys(custom).length ? { custom } : {}),
      },
      ip: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
      origin: null,
      referer: null,
    },
    undefined,
    { tx, merge: opts.merge },
  );
  if (outcome.status === "invalid") throw new ValidationError(outcome.errors);
  if (outcome.status === "created" || outcome.status === "merged") {
    if (input.serviceTypeId)
      await tx
        .update(leads)
        .set({ serviceTypeId: input.serviceTypeId })
        .where(eq(leads.id, outcome.leadId));
    await saveBookingPrefs(tx, outcome.leadId, input);
    return { leadId: outcome.leadId, merged: outcome.status === "merged" };
  }
  throw new ConflictError("lead_rejected", "Couldn't save this lead.");
}

/** Manual lead entry (phone call, walk-in). Runs the same intake pipeline. */
export const createLead = action({
  name: "leads.create",
  perm: "leads.create",
  feature: "leads",
  input: manualLeadSchema,
  audit: "lead.created_manual",
  async run({ input, tx, user, actor }) {
    const r = await runManualIntake(tx, input, actor);
    await answerPhoneLead(tx, r.leadId, user.id, actor);
    return r;
  },
  revalidate: ({ data }) => LEADS_PATHS(data.leadId),
});

const callerSchema = manualLeadSchema.omit({ address: true }).extend({
  street: optText(200),
  unit: optText(40),
  city: optText(80),
  state: optText(40),
  zip: optText(12),
  /** "schedule" = Save & schedule (needs leads.convert and a full address). */
  intent: z.enum(["schedule", "lead"]).default("lead"),
  /** Back from step 2: re-save the lead this flow already created (no second lead). */
  leadId: optUuid,
  /** Repeat caller, "Update their open lead" (contract 3.2). */
  mergeIntoLeadId: optUuid,
  /** Repeat caller, "Start a new one" (contract 3.2). */
  forceNew: zf.checkbox().optional(),
});

type CallerInput = z.infer<typeof callerSchema>;

const addressOf = (input: CallerInput, fallback: LeadRow["address"]) =>
  input.street && input.zip
    ? {
        street: input.street,
        ...(input.unit ? { unit: input.unit } : {}),
        city: input.city ?? "",
        state: (input.state ?? "").toUpperCase().slice(0, 2),
        zip: input.zip,
      }
    : fallback;

async function linkProperty(
  tx: Tx,
  l: LeadRow,
  address: LeadRow["address"],
  actor: Actor,
): Promise<void> {
  if (!l.customerId || !address?.street || !address.zip) return;
  const p = await ensureProperty(
    tx,
    l.customerId,
    {
      street: address.street,
      unit: address.unit ?? null,
      city: address.city ?? "",
      state: address.state ?? "",
      zip: address.zip,
    },
    actor,
  );
  await tx
    .update(leads)
    .set({ propertyId: p.propertyId })
    .where(eq(leads.id, l.id));
}

/** Back from step 2 → step 1 → save again: edit the saved lead in place. */
async function resaveCallerLead(
  tx: Tx,
  input: CallerInput & { leadId: string },
  actor: Actor,
): Promise<{ leadId: string; merged: boolean }> {
  const l = await loadLead(tx, input.leadId);
  if (l.status === "booked")
    throw new ConflictError("booked", "This lead is already booked.");
  let serviceText = input.service ?? null;
  if (input.serviceTypeId && !serviceText) {
    const { getServiceType } = await import("@/features/settings/api");
    serviceText = (await getServiceType(input.serviceTypeId))?.name ?? null;
  }
  const address = addressOf(input, l.address);
  await tx
    .update(leads)
    .set({
      name: input.name ?? l.name,
      serviceTypeId: input.serviceTypeId ?? null,
      serviceText,
      quotedPriceCents: input.priceCents ?? null,
      preferredDate: input.preferredDate ?? null,
      preferredWindow: input.preferredWindow ?? null,
      notes: input.notes ?? null,
      leadSourceId: input.sourceId,
      address,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, l.id));
  await linkProperty(tx, l, address, actor);
  await saveBookingPrefs(tx, l.id, input);
  await writeActivity(tx, {
    entity: { type: "lead", id: l.id },
    customerId: l.customerId,
    kind: "lead.updated",
    summary: "Lead details edited",
    actorUserId: actor.userId,
  });
  return { leadId: l.id, merged: false };
}

/**
 * Repeat caller, "Update their open lead" (contract 3.2): what was typed on this
 * call goes onto the chosen open lead (new notes are added under the old ones,
 * the new address replaces the old one) instead of a second lead.
 */
async function updateOpenLead(
  tx: Tx,
  input: CallerInput & { mergeIntoLeadId: string },
  e164: string | null,
  actor: Actor,
): Promise<{ leadId: string; merged: boolean }> {
  const l = await lockLead(tx, input.mergeIntoLeadId);
  if (!isOpenStatus(l.status))
    throw new ConflictError(
      "not_open",
      "That lead was closed in the meantime. Start a new one.",
    );
  if (e164 && l.phone && l.phone !== e164)
    throw new ConflictError(
      "other_phone",
      "That lead belongs to another phone number.",
    );
  let serviceText = input.service ?? l.serviceText;
  if (input.serviceTypeId && !input.service) {
    const { getServiceType } = await import("@/features/settings/api");
    serviceText =
      (await getServiceType(input.serviceTypeId))?.name ?? serviceText;
  }
  const address = addressOf(input, l.address);
  const notes =
    input.notes && l.notes && !l.notes.includes(input.notes)
      ? `${l.notes}\n\n${input.notes}`
      : (input.notes ?? l.notes);
  await tx
    .update(leads)
    .set({
      name: input.name ?? l.name,
      phone: l.phone ?? e164,
      serviceTypeId: input.serviceTypeId ?? l.serviceTypeId,
      serviceText,
      quotedPriceCents: input.priceCents ?? l.quotedPriceCents,
      preferredDate: input.preferredDate ?? l.preferredDate,
      preferredWindow: input.preferredWindow ?? l.preferredWindow,
      notes,
      address,
      isReturning: true,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, l.id));
  await linkProperty(tx, l, address, actor);
  await saveBookingPrefs(tx, l.id, input);
  await tx.insert(leadEvents).values({
    leadId: l.id,
    kind: "touch",
    actorUserId: actor.userId,
    raw: { reason: "repeat_caller", updated: true },
  });
  await writeActivity(tx, {
    entity: { type: "lead", id: l.id },
    customerId: l.customerId,
    kind: "lead.touched",
    summary: "Called again: lead updated with this call",
    actorUserId: actor.userId,
  });
  return { leadId: l.id, merged: true };
}

/**
 * Call-to-booking step 1 (/leads/new): the lead AND its customer + property in one
 * transaction. The lead runs the manual intake (consent, spam score, dedupe and
 * the returning-customer match by phone), then the same `ensureLeadCustomer` as
 * Convert. A lead the intake kept as spam or flagged for review gets no customer.
 *
 * Repeat callers (contract 3.2): when the phone already has an open lead and the
 * office hasn't chosen yet, nothing is saved and `{ needsChoice, openLeads }`
 * comes back; `mergeIntoLeadId` updates that lead, `forceNew` starts a new one.
 * The lead counts as answered (`answerPhoneLead`).
 */
export const createLeadAndCustomer = action({
  name: "leads.create_with_customer",
  perm: "leads.create",
  feature: "leads",
  input: callerSchema,
  async run({ input, tx, user, actor, audit }) {
    const schedule = input.intent === "schedule";
    if (schedule && !user.perms.has("leads.convert"))
      throw new ForbiddenError(undefined, "leads.convert");
    if (schedule && (!input.street || !input.zip))
      throw new ValidationError({
        ...(input.street ? {} : { street: ["Enter the street to schedule."] }),
        ...(input.zip ? {} : { zip: ["Enter the ZIP to schedule."] }),
      });
    if (
      (input.leadId || input.mergeIntoLeadId) &&
      !user.perms.has("leads.edit")
    )
      throw new ForbiddenError(undefined, "leads.edit");
    const { normalizePhone } = await import("@/lib/phone");
    const e164 = input.phone ? normalizePhone(input.phone) : null;
    let r: { leadId: string; merged: boolean };
    if (input.leadId) {
      r = await resaveCallerLead(tx, { ...input, leadId: input.leadId }, actor);
    } else if (input.mergeIntoLeadId) {
      r = await updateOpenLead(
        tx,
        { ...input, mergeIntoLeadId: input.mergeIntoLeadId },
        e164,
        actor,
      );
    } else {
      // Ask first (only people who can see leads get to choose).
      if (!input.forceNew && e164 && user.perms.has("leads.view")) {
        const match = await findCustomerMatch({ phone: e164 }, { tx });
        const openLeads = await openLeadsForPhone(e164, {
          customerIds: match ? [match.customerId] : [],
        });
        if (openLeads.length > 0)
          return {
            needsChoice: true as const,
            openLeads,
            leadId: null,
            merged: false,
            customerId: null,
            propertyId: null,
          };
      }
      r = await runManualIntake(tx, input, actor, { merge: !input.forceNew });
    }
    await answerPhoneLead(tx, r.leadId, user.id, actor);
    const l = await loadLead(tx, r.leadId);
    if (l.status === "booked")
      throw new ConflictError(
        "booked",
        "This caller already has a booked job.",
      );
    let c = { customerId: l.customerId, propertyId: l.propertyId };
    // "Check" leads (soft spam score over the review line) wait for a person.
    const flagged =
      !l.customerId &&
      l.spamScore >= (await getSettings()).leads.spam_review_threshold;
    if (l.status !== "spam" && !flagged)
      c = await ensureLeadCustomer(tx, l, actor);
    if (schedule && (!c.customerId || !c.propertyId))
      throw new ConflictError(
        "needs_review",
        "Saved, but this lead needs a review before it can be scheduled.",
      );
    await audit({
      action: "lead.created_manual",
      entity: { type: "lead", id: r.leadId },
      after: { ...input, merged: r.merged },
      full: true,
    });
    return {
      needsChoice: false as const,
      openLeads: [] as CallerOpenLead[],
      leadId: r.leadId as string | null,
      merged: r.merged,
      customerId: c.customerId,
      propertyId: c.propertyId,
    };
  },
  revalidate: ({ data }) => LEADS_PATHS(data.leadId ?? undefined),
});

/**
 * Returning-caller lookup while the phone is typed (step 1). Exact phone match
 * only. `openLeads` (contract 3.2): that phone's open leads, for "Update their
 * open lead or start a new one?".
 */
export async function lookupCaller(phone: string): Promise<CallerLookup> {
  const user = await requireUser("leads.create");
  const { normalizePhone } = await import("@/lib/phone");
  const e164 = normalizePhone(String(phone ?? "").slice(0, 40));
  if (!e164) return { matches: [], openLeads: [] };
  let matches: CallerMatch[] = [];
  if (user.perms.has("customers.view")) {
    const { findDuplicates } = await import("@/features/customers/queries");
    const dups = (await findDuplicates({ phoneE164: e164 })).slice(0, 3);
    if (dups.length > 0) {
      const ids = dups.map((d) => d.id);
      const reveal = user.perms.has("customers.contact_view");
      const [counts, props] = await Promise.all([
        db
          .select({ id: jobs.customerId, n: sql<number>`count(*)::int` })
          .from(jobs)
          .where(
            and(inArray(jobs.customerId, ids), ne(jobs.status, "cancelled")),
          )
          .groupBy(jobs.customerId),
        reveal
          ? db
              .select({
                id: properties.id,
                customerId: properties.customerId,
                street: properties.street,
                unit: properties.unit,
                city: properties.city,
                state: properties.state,
                zip: properties.zip,
              })
              .from(properties)
              .where(
                and(
                  inArray(properties.customerId, ids),
                  isNull(properties.deletedAt),
                ),
              )
              .orderBy(desc(properties.isPrimary), asc(properties.createdAt))
          : Promise.resolve([]),
      ]);
      matches = dups.map((d) => {
        const p = props.find((x) => x.customerId === d.id);
        return {
          customerId: d.id,
          name: d.displayName,
          jobs: counts.find((x) => x.id === d.id)?.n ?? 0,
          address: p
            ? {
                propertyId: p.id,
                street: p.street,
                unit: p.unit,
                city: p.city ?? "",
                state: p.state ?? "",
                zip: p.zip,
              }
            : null,
        };
      });
    }
  }
  const openLeads = user.perms.has("leads.view")
    ? await openLeadsForPhone(e164, {
        customerIds: matches.map((m) => m.customerId),
      })
    : [];
  return { matches, openLeads };
}

// ------------------------------------------------------------------ inbox actions

/**
 * Claim a lead, or take over someone else's (`force`: the UI asks first). The
 * person who had it is told (in-app, plus push/email per their "Other alerts"
 * preference).
 */
export const claimLead = action({
  name: "leads.claim",
  perm: "leads.edit",
  feature: "leads",
  input: z.object({ leadId: uuid, force: zf.checkbox().optional() }),
  audit: "lead.claimed",
  async run({ input, tx, user, activity }) {
    // Row lock: two people tapping Claim at once → exactly one wins.
    const l = await lockLead(tx, input.leadId);
    if (l.assignedUserId === user.id)
      return { claimed: true, previousUserId: null as string | null };
    const prev = l.assignedUserId;
    if (prev && !input.force) {
      const { getUserBriefs } = await import("@/features/team/api");
      const who = (await getUserBriefs([prev]))[prev];
      throw new ConflictError(
        "already_claimed",
        `${who?.name ?? "Someone"} already claimed this lead.`,
      );
    }
    await tx
      .update(leads)
      .set({ assignedUserId: user.id, updatedAt: new Date() })
      .where(eq(leads.id, l.id));
    await activity({
      entity: { type: "lead", id: l.id },
      customerId: l.customerId,
      kind: "lead.claimed",
      summary: prev ? `Taken over by ${user.name}` : `Claimed by ${user.name}`,
    });
    if (prev) {
      const { notify } = await import("@/features/notify/api");
      await notify(tx, {
        to: { userIds: [prev] },
        type: "staff.generic",
        title: `${user.name} took over ${l.name?.trim() || "a lead"}`,
        body: "They have it now, so there's nothing more for you to do on it.",
        url: `/leads/${l.id}`,
        entity: { type: "lead", id: l.id },
      });
    }
    return { claimed: true, previousUserId: prev };
  },
  auditEntity: ({ input }) => ({ type: "lead", id: input.leadId }),
  revalidate: ({ input }) => LEADS_PATHS(input.leadId),
});

/**
 * Release (Claim's way back): your lead goes back to nobody. `giveBackTo` is the
 * Undo of a take over: the lead goes back to the person who had it.
 */
export const releaseLead = action({
  name: "leads.release",
  perm: "leads.edit",
  feature: "leads",
  input: z.object({ leadId: uuid, giveBackTo: optUuid }),
  audit: "lead.released",
  async run({ input, tx, user, activity }) {
    const l = await lockLead(tx, input.leadId);
    const entity = { type: "lead", id: l.id } as const;
    if (input.giveBackTo) {
      if (l.assignedUserId !== user.id)
        throw new ConflictError("not_yours", "This lead isn't yours anymore.");
      const { listUsers } = await import("@/features/team/api");
      const to = (await listUsers({ perm: "leads.edit" })).find(
        (u) => u.id === input.giveBackTo,
      );
      if (!to)
        throw new ValidationError({
          giveBackTo: ["They can't take leads anymore."],
        });
      await tx
        .update(leads)
        .set({ assignedUserId: to.id, updatedAt: new Date() })
        .where(eq(leads.id, l.id));
      await activity({
        entity,
        customerId: l.customerId,
        kind: "lead.claimed",
        summary: `Given back to ${to.name}`,
      });
      return { assignedUserId: to.id as string | null };
    }
    const rule = releaseRule(l.assignedUserId, user.id);
    if (rule === "unassigned") return { assignedUserId: null };
    if (rule === "someone_else")
      throw new ConflictError(
        "someone_else",
        "Someone else has this lead. Take it over first.",
      );
    await tx
      .update(leads)
      .set({ assignedUserId: null, updatedAt: new Date() })
      .where(eq(leads.id, l.id));
    await activity({
      entity,
      customerId: l.customerId,
      kind: "lead.claimed",
      summary: `Released by ${user.name}`,
    });
    return { assignedUserId: null };
  },
  auditEntity: ({ input }) => ({ type: "lead", id: input.leadId }),
  revalidate: ({ input }) => LEADS_PATHS(input.leadId),
});

/** Returns the dial string; claims the lead when unassigned (claim + call). */
export const startLeadCall = action({
  name: "leads.call_start",
  perm: "leads.edit",
  feature: "leads",
  input: z.object({ leadId: uuid }),
  async run({ input, tx, user }) {
    const l = await loadLead(tx, input.leadId);
    if (!l.phone)
      throw new ConflictError("no_phone", "No phone number on this lead.");
    if (!l.assignedUserId)
      await tx
        .update(leads)
        .set({ assignedUserId: user.id, updatedAt: new Date() })
        .where(eq(leads.id, l.id));
    let dnc = false;
    if (l.customerId) {
      const r = await tx.execute(
        sql`select do_not_contact from customers where id = ${l.customerId}`,
      );
      const row = ((r as unknown as { rows?: { do_not_contact: boolean }[] })
        .rows ?? (r as unknown as { do_not_contact: boolean }[]))[0];
      dnc = !!row?.do_not_contact;
    }
    return { tel: `tel:${l.phone}`, doNotContact: dnc };
  },
  revalidate: ({ input }) => LEADS_PATHS(input.leadId),
});

const OUTCOMES = [
  "connected",
  "no_answer",
  "voicemail",
  "wrong_number",
  "busy",
] as const;

/** The texts that follow a lead until someone reaches them. */
const FOLLOW_UP_TEMPLATES = [
  "lead.ack",
  "lead.ack_after_hours",
  "lead.not_reached",
  "lead.no_answer",
];

/**
 * Call outcome sheet. Any attempt answers the speed-to-lead clock and moves `new` →
 * `contacted`. "No answer"/voicemail/busy → a `lead_retry` task (+15 min) and an
 * auto-drafted `lead.no_answer` text (an outbox card in link mode). "Wrong number"
 * stops the follow-ups: the queued texts to that number and open call-back tasks.
 */
export const logLeadCall = action({
  name: "leads.call_log",
  perm: "leads.edit",
  feature: "leads",
  input: z.object({
    leadId: uuid,
    outcome: z.enum(OUTCOMES),
    notes: optText(1000),
    clientId: z.string().uuid().optional(),
  }),
  async run({ input, tx, user, actor }) {
    const l = await loadLead(tx, input.leadId);
    const { callId } = await logCall(
      tx,
      {
        customerId: l.customerId,
        leadId: l.id,
        userId: user.id,
        direction: "out",
        outcome: input.outcome,
        notes: input.notes ?? null,
      },
      actor,
    );
    await markLeadResponded(
      tx,
      l.id,
      { userId: user.id, channel: "call" },
      actor,
    );
    if (l.status === "new")
      await changeStatus(tx, l, "contacted", actor, {
        assignedUserId: l.assignedUserId ?? user.id,
      });
    else if (!l.assignedUserId)
      await tx
        .update(leads)
        .set({ assignedUserId: user.id })
        .where(eq(leads.id, l.id));
    let retryTaskId: string | null = null;
    let textQueued = false;
    let followUpsStopped = false;
    if (input.outcome === "wrong_number") {
      const entity = { type: "lead", id: l.id } as const;
      const texts = await cancelScheduledMessages(
        tx,
        { entity, templateKeys: FOLLOW_UP_TEMPLATES },
        "wrong_number",
      );
      const tasks = await closeTasksFor(
        tx,
        { kind: "lead_retry", entity },
        "dismissed",
        actor,
      );
      followUpsStopped = texts + tasks > 0;
      await writeActivity(tx, {
        entity,
        customerId: l.customerId,
        kind: "lead.updated",
        summary: "Wrong number: follow-up texts and call-backs stopped",
        actorUserId: actor.userId,
      });
    }
    if (["no_answer", "voicemail", "busy"].includes(input.outcome)) {
      const t = await createTask(
        tx,
        {
          kind: "lead_retry",
          title: `Call ${l.name ?? "lead"} back`,
          body: `No answer at ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.`,
          payload: { lead_id: l.id, call_id: callId },
          assigneeUserId: user.id,
          entity: { type: "lead", id: l.id },
          customerId: l.customerId,
          dueAt: new Date(Date.now() + 15 * 60_000),
        },
        actor,
      );
      retryTaskId = t.taskId;
      if (l.customerId && input.outcome !== "voicemail") {
        try {
          await enqueueMessage(
            tx,
            {
              templateKey: "lead.no_answer",
              channel: "sms",
              audience: { type: "customer", customerId: l.customerId },
              entity: { type: "lead", id: l.id },
              leadId: l.id,
              dedupeKey: `lead_no_answer:${l.id}:${callId}`,
              outboxAssigneeUserId: user.id,
            },
            actor,
          );
          textQueued = true;
        } catch (err) {
          // Messaging may refuse (consent, flag off): the call is still logged.
          console.warn("[leads] no-answer text not queued:", err);
        }
      }
    }
    return { callId, retryTaskId, textQueued, followUpsStopped };
  },
  revalidate: ({ input }) => [...LEADS_PATHS(input.leadId), "/tasks"],
});

/**
 * Open-status steps and their way back: Contacted ↔ Not contacted, Qualify ↔
 * Unqualify (rules.ts STATUS_STEPS). Closed leads come back through Reopen.
 */
export const setLeadStatus = action({
  name: "leads.status",
  perm: "leads.edit",
  feature: "leads",
  input: z.object({
    leadId: uuid,
    status: z.enum(["new", "contacted", "qualified"]),
  }),
  audit: "lead.status_changed",
  async run({ input, tx, actor }): Promise<LeadChangeResult> {
    const l = await lockLead(tx, input.leadId);
    if (!isOpenStatus(l.status))
      throw new ConflictError(
        l.status,
        l.status === "booked"
          ? "This lead is already booked."
          : "Reopen this lead first.",
      );
    const eventId = await changeStatus(tx, l, input.status, actor, {
      lostReason: null,
    });
    return changed(l, input.status, eventId);
  },
  auditEntity: ({ input }) => ({ type: "lead", id: input.leadId }),
  revalidate: ({ input }) => LEADS_PATHS(input.leadId),
});

export const markLeadLost = action({
  name: "leads.lost",
  perm: "leads.edit",
  feature: "leads",
  input: z.object({
    leadId: uuid,
    reason: z.string().trim().min(1).max(60),
    note: optText(1000),
  }),
  audit: "lead.lost",
  async run({ input, tx, actor }): Promise<LeadChangeResult> {
    const s = await getSettings();
    if (!s.leads.lost_reasons.includes(input.reason))
      throw new ValidationError({ reason: ["Pick a reason."] });
    const l = await lockLead(tx, input.leadId);
    if (l.status === "booked")
      throw new ConflictError("booked", "This lead is already booked.");
    const eventId = await changeStatus(
      tx,
      l,
      "lost",
      actor,
      { lostReason: input.reason },
      `Marked lost: ${lostReasonLabel(input.reason)}${input.note ? ` — ${input.note}` : ""}`,
    );
    return changed(l, "lost", eventId);
  },
  auditEntity: ({ input }) => ({ type: "lead", id: input.leadId }),
  revalidate: ({ input }) => LEADS_PATHS(input.leadId),
});

export const markLeadSpam = action({
  name: "leads.spam",
  perm: "leads.edit",
  feature: "leads",
  input: z.object({ leadId: uuid }),
  audit: "lead.spam",
  async run({ input, tx, actor }): Promise<LeadChangeResult> {
    const l = await lockLead(tx, input.leadId);
    if (l.status === "booked")
      throw new ConflictError("booked", "This lead is already booked.");
    const eventId = await changeStatus(
      tx,
      l,
      "spam",
      actor,
      {
        spamReason: l.spamReason ?? "manual",
        spamScore: Math.max(l.spamScore, 100),
      },
      "Marked as spam",
    );
    return changed(l, "spam", eventId);
  },
  auditEntity: ({ input }) => ({ type: "lead", id: input.leadId }),
  revalidate: ({ input }) => LEADS_PATHS(input.leadId),
});

/**
 * "Looks legit" (a "Check" lead) and "Not spam" (spam's way back): creates the
 * customer and consent rows, clears the score, and a spam lead goes back to the
 * open status it had before (New when it came in as spam).
 */
export const markLeadNotSpam = action({
  name: "leads.not_spam",
  perm: "leads.edit",
  feature: "leads",
  input: z.object({ leadId: uuid }),
  audit: "lead.not_spam",
  async run({ input, tx, actor }) {
    const l = await lockLead(tx, input.leadId);
    if (l.status === "booked" || l.status === "lost")
      throw new ConflictError(l.status, "This lead isn't spam.");
    const c = await ensureLeadCustomer(tx, l, actor);
    const fresh = { ...l, customerId: c.customerId, propertyId: c.propertyId };
    const to: LeadStatus =
      l.status === "spam"
        ? previousOpenStatus(
            await leadStatusHistory(l.id),
            "spam",
            !!l.firstResponseAt,
          )
        : (l.status as LeadStatus);
    const eventId = await changeStatus(
      tx,
      fresh,
      to,
      actor,
      {
        spamScore: 0,
        extra: {
          ...(l.extra ?? {}),
          _spam_review: {
            score: l.spamScore,
            reason: l.spamReason,
            cleared_by: actor.userId,
          },
        },
      },
      l.status === "spam" ? "Marked as not spam" : "Looks legit",
      { record: true, raw: { review: "legit" } },
    );
    return {
      customerId: c.customerId,
      leadId: l.id,
      status: to,
      eventId,
    };
  },
  auditEntity: ({ input }) => ({ type: "lead", id: input.leadId }),
  revalidate: ({ input }) => LEADS_PATHS(input.leadId),
});

/**
 * Reopen (Lost's way back, and a booked lead whose job was cancelled): back to
 * the open status it had before, from the status history (rules.ts
 * previousOpenStatus), not always Contacted. A spam lead goes through Not spam.
 */
export const reopenLead = action({
  name: "leads.reopen",
  perm: "leads.edit",
  feature: "leads",
  input: z.object({ leadId: uuid }),
  audit: "lead.reopened",
  async run({ input, tx, actor }): Promise<LeadChangeResult> {
    const l = await lockLead(tx, input.leadId);
    if (l.status === "spam")
      throw new ConflictError("spam", "Use Not spam for a spam lead.");
    const [job] = l.convertedJobId
      ? await tx
          .select({ status: jobs.status })
          .from(jobs)
          .where(eq(jobs.id, l.convertedJobId))
          .limit(1)
      : [];
    const rule = reopenRule({
      status: l.status,
      jobStatus: job?.status ?? null,
    });
    if (!rule) throw new ConflictError("open", "This lead is already open.");
    if (!rule.ok) throw new ConflictError("not_reopenable", rule.reason);
    const to = previousOpenStatus(
      await leadStatusHistory(l.id),
      l.status,
      !!l.firstResponseAt,
    );
    const extra: Partial<LeadRow> = { lostReason: null };
    if (l.status === "booked") extra.convertedJobId = null;
    const eventId = await changeStatus(
      tx,
      l,
      to,
      actor,
      extra,
      `Reopened: back to ${STATUS_WORD[to]}`,
      l.status === "booked"
        ? { raw: { cancelled_job_id: l.convertedJobId } }
        : {},
    );
    return changed(l, to, eventId);
  },
  auditEntity: ({ input }) => ({ type: "lead", id: input.leadId }),
  revalidate: ({ input }) => LEADS_PATHS(input.leadId),
});

/**
 * Undo for every status toast: reverts one recorded change (`eventId` from the
 * action's result) while it is still the lead's latest, restoring what it
 * overwrote (status, lost reason, spam score, the booked job).
 */
export const undoLeadChange = action({
  name: "leads.undo",
  perm: "leads.edit",
  feature: "leads",
  input: z.object({ leadId: uuid, eventId: uuid }),
  audit: "lead.change_undone",
  async run({ input, tx, actor }): Promise<LeadChangeResult> {
    const l = await lockLead(tx, input.leadId);
    const [ev] = await tx
      .select({
        id: leadEvents.id,
        raw: leadEvents.raw,
        createdAt: leadEvents.createdAt,
      })
      .from(leadEvents)
      .where(
        and(
          eq(leadEvents.id, input.eventId),
          eq(leadEvents.leadId, l.id),
          eq(leadEvents.kind, "status"),
        ),
      )
      .limit(1);
    if (!ev) throw new NotFoundError("Change");
    const [later] = await tx
      .select({ id: leadEvents.id })
      .from(leadEvents)
      .where(
        and(
          eq(leadEvents.leadId, l.id),
          eq(leadEvents.kind, "status"),
          gt(leadEvents.createdAt, ev.createdAt),
        ),
      )
      .limit(1);
    const patch = later ? null : undoPatch(ev.raw as StatusEventRaw, l);
    if (!patch)
      throw new ConflictError(
        "moved_on",
        "This lead changed since, so there's nothing to undo.",
      );
    const extra: Partial<LeadRow> = { lostReason: patch.lostReason };
    if (patch.spamScore !== undefined) extra.spamScore = patch.spamScore;
    if (patch.spamReason !== undefined) extra.spamReason = patch.spamReason;
    if (patch.convertedJobId !== undefined)
      extra.convertedJobId = patch.convertedJobId;
    const to = patch.status as LeadStatus;
    const eventId = await changeStatus(
      tx,
      l,
      to,
      actor,
      extra,
      `Undone: back to ${STATUS_WORD[to] ?? to}`,
      { record: true, raw: { undo_of: ev.id } },
    );
    return changed(l, to, eventId);
  },
  auditEntity: ({ input }) => ({ type: "lead", id: input.leadId }),
  revalidate: ({ input }) => LEADS_PATHS(input.leadId),
});

/** Convert: make sure the lead has a customer (and property), then hand off to /jobs/new or /estimates/new. */
export const prepareLeadConversion = action({
  name: "leads.convert_prepare",
  perm: "leads.convert",
  feature: "leads",
  input: z.object({ leadId: uuid, to: z.enum(["job", "estimate"]) }),
  async run({ input, tx, actor }) {
    const l = await loadLead(tx, input.leadId);
    if (l.status === "spam")
      throw new ConflictError("spam", "Mark this lead as not spam first.");
    const c = await ensureLeadCustomer(tx, l, actor);
    const base = input.to === "job" ? "/jobs/new" : "/estimates/new";
    const q = new URLSearchParams({ leadId: l.id });
    if (c.customerId) q.set("customerId", c.customerId);
    if (c.propertyId) q.set("propertyId", c.propertyId);
    return { href: `${base}?${q.toString()}` };
  },
  revalidate: ({ input }) => LEADS_PATHS(input.leadId),
});

/**
 * Edit lead: the request details and (build SPEC fix) the contact details:
 * phone, email and address. A blank contact field keeps what's there. A fixed
 * phone or email also fixes the lead's customer where it still holds the old
 * (mistyped) value (`customerFields`); a new address is added to the customer's
 * properties.
 */
export const updateLead = action({
  name: "leads.update",
  perm: "leads.edit",
  feature: "leads",
  input: z.object({
    leadId: uuid,
    name: optText(200),
    phone: optText(40),
    email: optText(200),
    street: optText(200),
    unit: optText(40),
    city: optText(80),
    state: optText(40),
    zip: optText(12),
    serviceTypeId: optUuid,
    service: optText(120),
    price: optText(30),
    preferredDate: optText(10),
    preferredWindow: optText(60),
    notes: optText(5000),
    sourceId: optUuid,
  }),
  audit: "lead.updated",
  async run({ input, tx, actor, activity }) {
    const l = await lockLead(tx, input.leadId);
    const { parseMoneyToCents } = await import("@/lib/money");
    const price = input.price ? parseMoneyToCents(input.price) : null;
    if (input.price && price == null)
      throw new ValidationError({ price: ["Enter a dollar amount."] });
    if (input.preferredDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.preferredDate))
      throw new ValidationError({ preferredDate: ["Pick a date."] });
    let phone = l.phone;
    if (input.phone) {
      const { normalizePhone } = await import("@/lib/phone");
      phone = normalizePhone(input.phone);
      if (!phone)
        throw new ValidationError({ phone: ["Enter a valid phone number."] });
    }
    let email = l.email;
    if (input.email) {
      email = input.email.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw new ValidationError({ email: ["Enter a valid email."] });
    }
    if (!!input.street !== !!input.zip)
      throw new ValidationError(
        input.street
          ? { zip: ["Enter the ZIP too."] }
          : { street: ["Enter the street too."] },
      );
    const address =
      input.street && input.zip
        ? {
            street: input.street,
            ...(input.unit ? { unit: input.unit } : {}),
            city: input.city ?? "",
            state: (input.state ?? "").toUpperCase().slice(0, 2),
            zip: input.zip,
          }
        : l.address;
    const service = input.serviceTypeId ? null : (input.service ?? null);
    const contactChanged =
      phone !== l.phone ||
      email !== l.email ||
      JSON.stringify(address ?? null) !== JSON.stringify(l.address ?? null);
    await tx
      .update(leads)
      .set({
        name: input.name ?? l.name,
        phone,
        email,
        address,
        serviceTypeId: input.serviceTypeId ?? null,
        serviceText: service,
        quotedPriceCents: price,
        preferredDate: input.preferredDate ?? null,
        preferredWindow: input.preferredWindow ?? null,
        notes: input.notes ?? null,
        leadSourceId: input.sourceId ?? l.leadSourceId,
        dedupeHash:
          phone !== l.phone || email !== l.email
            ? dedupeHashOf(phone, email, service)
            : l.dedupeHash,
        updatedAt: new Date(),
      })
      .where(eq(leads.id, l.id));
    if (address !== l.address) await linkProperty(tx, l, address, actor);
    const customerFields =
      l.customerId && (phone !== l.phone || email !== l.email)
        ? (
            await updateContactFromLead(
              tx,
              l.customerId,
              {
                oldPhone: l.phone,
                newPhone: phone,
                oldEmail: l.email,
                newEmail: email,
              },
              actor,
            )
          ).fields
        : [];
    await activity({
      entity: { type: "lead", id: l.id },
      customerId: l.customerId,
      kind: "lead.updated",
      summary: contactChanged
        ? "Lead details and contact info edited"
        : "Lead details edited",
    });
    return { ok: true, customerFields };
  },
  auditEntity: ({ input }) => ({ type: "lead", id: input.leadId }),
  revalidate: ({ input }) => LEADS_PATHS(input.leadId),
});

/** Infinite scroll for the inbox. */
export async function loadMoreLeads(f: LeadFilter) {
  const user = await requireUser("leads.view");
  return listLeads(user, f);
}

/** The lead card's light loader (the sheet): one lead, no page around it. */
export async function loadLeadCard(
  leadId: string,
): Promise<{ ok: true; data: LeadCardData } | { ok: false; error: string }> {
  try {
    const user = await requireUser("leads.view");
    return { ok: true, data: await getLeadCard(user, leadId) };
  } catch (err) {
    if (err instanceof NotFoundError)
      return { ok: false, error: "This lead isn't here anymore." };
    if (err instanceof ForbiddenError)
      return { ok: false, error: "You don't have access to leads." };
    throw err;
  }
}

/** Sources and service types for the Edit lead sheet (loaded when it opens). */
export async function loadLeadEditOptions(): Promise<{
  sources: { id: string; name: string }[];
  services: { id: string; name: string }[];
}> {
  await requireUser("leads.edit");
  const { listActiveSources } = await import("./queries");
  const { listServiceTypes } = await import("@/features/settings/api");
  const [sources, services] = await Promise.all([
    listActiveSources(),
    listServiceTypes().catch(() => []),
  ]);
  return {
    sources,
    services: services.map((s) => ({ id: s.id, name: s.name })),
  };
}

// ------------------------------------------------------------------ sources (settings)

const KINDS = [
  "website",
  "google_lsa",
  "google_ads",
  "angi",
  "thumbtack",
  "yelp",
  "referral",
  "repeat",
  "phone",
  "walk_in",
  "zapier",
  "other",
] as const;
const INTEGRATIONS = [
  "plain_form",
  "js_snippet",
  "hosted_form",
  "json_api",
  "preset",
] as const;
const PRESETS = [
  "generic",
  "zapier",
  "make",
  "thumbtack",
  "angi",
  "google_ads_leadform",
] as const;

const originsField = z.preprocess(
  (v) =>
    typeof v === "string"
      ? v
          .split(/[\s,]+/)
          .map((x) => x.trim())
          .filter(Boolean)
      : v,
  z
    .array(
      z
        .string()
        .max(200)
        .regex(
          /^(https?:\/\/)?(\*\.)?[a-z0-9.-]+(:\d+)?\/?$/i,
          "Use a domain like example.com or https://www.example.com",
        ),
    )
    .max(20)
    .default([]),
);

function issueKeys(
  integration: (typeof INTEGRATIONS)[number],
  preset: string,
): {
  row: Partial<typeof leadSources.$inferInsert>;
  secrets: IssuedSecrets;
} {
  const row: Partial<typeof leadSources.$inferInsert> = {};
  const secrets: IssuedSecrets = {};
  if (integration !== "preset") {
    const pk = newPublicKey();
    row.publicKey = pk;
    secrets.publicKey = pk;
  }
  if (integration === "json_api") {
    const sk = newSecretKey();
    row.secretHash = hashKey(sk);
    secrets.secretKey = sk;
  }
  if (integration === "preset") {
    const hk = newHookSecret();
    row.hookSecretHash = hashKey(hk);
    secrets.hookSecret = hk;
    secrets.hookUrl = appUrl(`/api/v1/hooks/${preset}/${hk}`);
    if (preset === "google_ads_leadform") {
      const gk = `gk_${randomToken(24)}`;
      row.googleKeyHash = hashKey(gk);
      secrets.googleKey = gk;
    }
  }
  return { row, secrets };
}

export const createLeadSource = action({
  name: "leads.source_create",
  perm: "settings.api_keys",
  feature: "leads",
  input: z.object({
    name: z.string().trim().min(1, "Name it (e.g. Website).").max(80),
    kind: z.enum(KINDS).default("website"),
    integrationKind: z.enum(INTEGRATIONS),
    preset: z.enum(PRESETS).default("generic"),
    allowedOrigins: originsField,
  }),
  audit: "lead_source.created",
  async run({ input, tx }) {
    const { row, secrets } = issueKeys(input.integrationKind, input.preset);
    const [s] = await tx
      .insert(leadSources)
      .values({
        name: input.name,
        kind: input.kind,
        preset: input.integrationKind === "preset" ? input.preset : "generic",
        integrationKind: input.integrationKind,
        // Static HTML can't sign `_ts`; hosted/snippet forms always do.
        requireTs: ["js_snippet", "hosted_form"].includes(
          input.integrationKind,
        ),
        allowedOrigins: input.allowedOrigins,
        costModel: ["thumbtack", "angi", "google_lsa"].includes(input.kind)
          ? "per_lead"
          : "none",
        ...row,
      })
      .returning({ id: leadSources.id });
    if (!s) throw new Error("insert failed");
    return { id: s.id, secrets };
  },
  revalidate: ({ data }) => [
    "/settings/lead-sources",
    `/settings/lead-sources/${data.id}`,
  ],
});

export const updateLeadSource = action({
  name: "leads.source_update",
  perm: "settings.api_keys",
  feature: "leads",
  input: z.object({
    id: uuid,
    name: z.string().trim().min(1).max(80),
    kind: z.enum(KINDS),
    integrationKind: z.enum(INTEGRATIONS),
    preset: z.enum(PRESETS).default("generic"),
    allowedOrigins: originsField,
    requireTs: zf.checkbox(),
    turnstileRequired: zf.checkbox(),
    dailyCap: z.coerce.number().int().min(1).max(100_000),
    costModel: z.enum(["none", "per_lead", "monthly"]),
    defaultCost: optText(20),
    active: zf.checkbox(),
  }),
  audit: "lead_source.updated",
  async run({ input, tx }) {
    const { parseMoneyToCents } = await import("@/lib/money");
    const cost = input.defaultCost
      ? parseMoneyToCents(input.defaultCost)
      : null;
    if (input.defaultCost && cost == null)
      throw new ValidationError({ defaultCost: ["Enter a dollar amount."] });
    const [cur] = await tx
      .select()
      .from(leadSources)
      .where(eq(leadSources.id, input.id))
      .limit(1);
    if (!cur) throw new NotFoundError("Source");
    // Switching integration kind: issue any key the new kind needs (shown once).
    const secrets: IssuedSecrets = {};
    const patch: Partial<typeof leadSources.$inferInsert> = {};
    if (input.integrationKind !== "preset" && !cur.publicKey) {
      patch.publicKey = newPublicKey();
      secrets.publicKey = patch.publicKey;
    }
    if (input.integrationKind === "json_api" && !cur.secretHash) {
      const sk = newSecretKey();
      patch.secretHash = hashKey(sk);
      secrets.secretKey = sk;
    }
    if (input.integrationKind === "preset" && !cur.hookSecretHash) {
      const hk = newHookSecret();
      patch.hookSecretHash = hashKey(hk);
      secrets.hookSecret = hk;
      secrets.hookUrl = appUrl(`/api/v1/hooks/${input.preset}/${hk}`);
    }
    await tx
      .update(leadSources)
      .set({
        name: input.name,
        kind: input.kind,
        integrationKind: input.integrationKind,
        preset: input.integrationKind === "preset" ? input.preset : "generic",
        allowedOrigins: input.allowedOrigins,
        requireTs: input.requireTs,
        turnstileRequired: input.turnstileRequired,
        dailyCap: input.dailyCap,
        costModel: input.costModel,
        defaultCostCents: cost,
        active: input.active,
        ...patch,
        updatedAt: new Date(),
      })
      .where(eq(leadSources.id, input.id));
    return { id: input.id, secrets };
  },
  revalidate: ({ input }) => [
    "/settings/lead-sources",
    `/settings/lead-sources/${input.id}`,
  ],
});

/** Rotate one key; the new value is returned once (only its hash is stored). */
export const rotateSourceKey = action({
  name: "leads.source_rotate",
  perm: "settings.api_keys",
  feature: "leads",
  input: z.object({
    id: uuid,
    which: z.enum(["public", "secret", "hook", "google"]),
  }),
  audit: "lead_source.key_rotated",
  async run({ input, tx }) {
    const [cur] = await tx
      .select()
      .from(leadSources)
      .where(eq(leadSources.id, input.id))
      .limit(1);
    if (!cur) throw new NotFoundError("Source");
    const secrets: IssuedSecrets = {};
    const patch: Partial<typeof leadSources.$inferInsert> = {};
    if (input.which === "public") {
      patch.publicKey = newPublicKey();
      secrets.publicKey = patch.publicKey;
    } else if (input.which === "secret") {
      const sk = newSecretKey();
      patch.secretHash = hashKey(sk);
      secrets.secretKey = sk;
    } else if (input.which === "hook") {
      const hk = newHookSecret();
      patch.hookSecretHash = hashKey(hk);
      secrets.hookSecret = hk;
      secrets.hookUrl = appUrl(`/api/v1/hooks/${cur.preset}/${hk}`);
    } else {
      const gk = `gk_${randomToken(24)}`;
      patch.googleKeyHash = hashKey(gk);
      secrets.googleKey = gk;
    }
    await tx
      .update(leadSources)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(leadSources.id, input.id));
    return { secrets };
  },
  revalidate: ({ input }) => [
    "/settings/lead-sources",
    `/settings/lead-sources/${input.id}`,
  ],
});

const MAPPING_KEY = /^[a-z_.A-Z]{1,40}$/;

export const saveSourceMapping = action({
  name: "leads.source_mapping",
  perm: "settings.api_keys",
  feature: "leads",
  input: z.object({
    id: uuid,
    mapping: z
      .array(
        z.object({
          target: z.string().regex(MAPPING_KEY),
          path: z.string().trim().max(200),
        }),
      )
      .max(30),
  }),
  audit: "lead_source.mapping_saved",
  async run({ input, tx }) {
    const mapping = Object.fromEntries(
      input.mapping.filter((m) => m.path).map((m) => [m.target, m.path]),
    );
    await tx
      .update(leadSources)
      .set({
        mapping: Object.keys(mapping).length ? mapping : null,
        updatedAt: new Date(),
      })
      .where(eq(leadSources.id, input.id));
    return { count: Object.keys(mapping).length };
  },
  revalidate: ({ input }) => [`/settings/lead-sources/${input.id}`],
});

/** Dry run of a payload (pasted JSON or a stored one) through preset + mapping + aliases. */
export async function testSourcePayload(input: {
  id: string;
  payload?: string;
  eventId?: string;
  mapping?: { target: string; path: string }[];
}): Promise<
  { ok: true; data: LeadPreviewResult } | { ok: false; error: string }
> {
  const user = await requireUser("settings.api_keys");
  const { getLeadSource, recentPayloads } = await import("./queries");
  const src = await getLeadSource(user, input.id);
  let raw: unknown;
  if (input.eventId) {
    const rows = await recentPayloads(user, src.id, 20);
    raw = rows.find((r) => r.id === input.eventId)?.raw;
    if (raw === undefined) return { ok: false, error: "Payload not found." };
  } else {
    try {
      raw = JSON.parse(input.payload ?? "{}");
    } catch {
      return { ok: false, error: "That isn't valid JSON." };
    }
  }
  const mapping = input.mapping
    ? Object.fromEntries(
        input.mapping
          .filter((m) => m.path && MAPPING_KEY.test(m.target))
          .map((m) => [m.target, m.path]),
      )
    : src.mapping;
  const r = await previewLead({ preset: src.preset, mapping }, raw);
  const { formatMoney: formatCents } = await import("@/lib/money");
  const n = r.lead;
  const fields: { label: string; value: string }[] = [];
  const add = (label: string, v: unknown) => {
    if (v !== null && v !== undefined && v !== "" && v !== false)
      fields.push({ label, value: v === true ? "Yes" : String(v) });
  };
  add("Name", n.name);
  add("Phone", n.phone ?? n.phoneRaw);
  add("Email", n.email);
  add(
    "Address",
    n.address
      ? `${n.address.street}${n.address.unit ? ` ${n.address.unit}` : ""}, ${n.address.city} ${n.address.state} ${n.address.zip}`
      : n.addressText,
  );
  add("Service", n.service);
  add("Matched service type", r.serviceTypeId ? "Yes" : null);
  add("Quoted price", n.priceCents != null ? formatCents(n.priceCents) : null);
  add("Preferred date", n.preferredDate);
  add("Time window", n.preferredWindow);
  add("Notes", n.notes);
  add("External id", n.externalId);
  add("SMS consent", n.smsConsent);
  add("Marketing consent", n.marketingConsent);
  add(
    "Lead cost",
    r.sourceCostCents != null ? formatCents(r.sourceCostCents) : null,
  );
  for (const [k, v] of Object.entries(n.attribution))
    add(k, typeof v === "object" ? JSON.stringify(v) : v);
  return {
    ok: true,
    data: {
      fields,
      errors: r.errors,
      warnings: r.warnings,
      missingMappings: r.missingMappings,
      spamScore: r.spam.score,
      spamReasons: r.spam.reasons,
      extraKeys: Object.keys(n.extra),
    },
  };
}

export const saveSourceSpend = action({
  name: "leads.spend_save",
  perm: "settings.api_keys",
  feature: "leads",
  input: z.object({
    id: uuid,
    month: z.string().regex(/^\d{4}-\d{2}$/, "Pick a month."),
    /** Integer cents (MoneyField submits cents). */
    amount: z.coerce.number({ message: "Enter an amount." }).int(),
    notes: optText(200),
  }),
  audit: "lead_source.spend_saved",
  async run({ input, tx }) {
    if (input.amount < 0)
      throw new ValidationError({ amount: ["Enter a positive amount."] });
    await tx
      .insert(sourceSpend)
      .values({
        leadSourceId: input.id,
        month: `${input.month}-01`,
        amountCents: input.amount,
        notes: input.notes ?? null,
      })
      .onConflictDoUpdate({
        target: [sourceSpend.leadSourceId, sourceSpend.month],
        set: {
          amountCents: input.amount,
          notes: input.notes ?? null,
          updatedAt: new Date(),
        },
      });
    return { ok: true };
  },
  revalidate: ({ input }) => [`/settings/lead-sources/${input.id}`],
});

export const deleteSourceSpend = action({
  name: "leads.spend_delete",
  perm: "settings.api_keys",
  feature: "leads",
  input: z.object({ id: uuid, spendId: uuid }),
  audit: "lead_source.spend_deleted",
  async run({ input, tx }) {
    await tx
      .delete(sourceSpend)
      .where(
        and(
          eq(sourceSpend.id, input.spendId),
          eq(sourceSpend.leadSourceId, input.id),
        ),
      );
    return { ok: true };
  },
  revalidate: ({ input }) => [`/settings/lead-sources/${input.id}`],
});

export const saveLeadSettings = action({
  name: "leads.settings",
  perm: "settings.api_keys",
  input: z.object({
    assignment: z.enum(["first_to_claim", "round_robin"]),
    slaBusinessHours: zf.checkbox(),
    spamReviewThreshold: z.coerce.number().int().min(10).max(100),
    leadResponseMinutes: z.coerce.number().int().min(1).max(1440),
    lostReasons: z.preprocess(
      (v) =>
        typeof v === "string"
          ? v
              .split(/[\n,]+/)
              .map((x) => x.trim().toLowerCase().replace(/\s+/g, "_"))
              .filter(Boolean)
          : v,
      z.array(z.string().max(60)).min(1, "Keep at least one reason.").max(20),
    ),
    defaultSourceId: optUuid,
  }),
  audit: "settings.leads_updated",
  async run({ input, tx, actor }) {
    await updateSettings(
      tx,
      {
        leads: {
          assignment: input.assignment,
          sla_business_hours: input.slaBusinessHours,
          spam_review_threshold: input.spamReviewThreshold,
          lost_reasons: [...new Set(input.lostReasons)],
          default_source_id: input.defaultSourceId ?? null,
        },
        company: { lead_response_minutes: input.leadResponseMinutes },
      },
      actor,
    );
    return { ok: true };
  },
  revalidate: () => ["/settings/lead-sources", "/leads"],
});

// ------------------------------------------------------------------ api keys

const SCOPES = ["leads:write"] as const;

export const createApiKey = action({
  name: "api_keys.create",
  perm: "settings.api_keys",
  input: z.object({
    name: z.string().trim().min(1, "Name the key (e.g. Zapier).").max(80),
    scopes: zf.array(z.enum(SCOPES)).default(["leads:write"]),
  }),
  audit: "api_key.created",
  async run({ input, tx, user }) {
    const key = newSecretKey();
    const scopes = input.scopes.length ? input.scopes : ["leads:write"];
    const [row] = await tx
      .insert(apiKeys)
      .values({
        name: input.name,
        prefix: key.slice(0, 12),
        keyHash: hashKey(key),
        scopes,
        createdBy: user.id,
      })
      .returning({ id: apiKeys.id });
    if (!row) throw new Error("insert failed");
    return { id: row.id, key };
  },
  revalidate: () => ["/settings/api-keys"],
});

export const revokeApiKey = action({
  name: "api_keys.revoke",
  perm: "settings.api_keys",
  input: z.object({ id: uuid }),
  audit: "api_key.revoked",
  async run({ input, tx }) {
    await tx
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, input.id), sql`${apiKeys.revokedAt} is null`));
    return { ok: true };
  },
  revalidate: () => ["/settings/api-keys"],
});

/** Who may be assigned leads (picker). */
export async function leadAssignees(): Promise<{ id: string; name: string }[]> {
  await requireUser("leads.edit");
  const { listUsers } = await import("@/features/team/api");
  const users = await listUsers({ perm: "leads.edit", statuses: ["active"] });
  return users.map((u) => ({ id: u.id, name: u.name }));
}
