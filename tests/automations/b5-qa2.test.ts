// B5 QA round 2 regressions (automations, sender validity, reviews) on a private PGlite:
// - T6-04 lead "we tried to reach you" stops once a call connects (event + send time)
// - T2-16 lead auto-reply cancels on booking / status change and keeps its expiry
// - T6-05 the actor skip applies to immediate notices only
// - T6-10 booking / reschedule / 24h reminder never go out after the visit or completion
// - T6-06 review asks: closed ≠ paid, disputes and old jobs never asked
// - T6-13 empty optional lines leave no blank lines in emails
// - T3-14 template syntax lint; T4-26 plain-words event labels
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-b5-qa2-"),
);
process.env.PGLITE_DIR = path.join(root, "pglite");
process.env.UPLOADS_DIR = path.join(root, "uploads");
process.env.CRM_DISABLE_BACKGROUND = "1";
process.env.CRON_PIGGYBACK = "0";
process.env.AI_PROVIDER = "none";
process.env.EMAIL_DRIVER = "console";
process.env.MESSAGING_SMS_DRIVER = "link";

import { and, desc, eq } from "drizzle-orm";
import { closeDb, db, ensureDb } from "@/db";
import {
  calls,
  customers,
  disputes,
  events,
  jobAssignments,
  jobs,
  leads,
  payments,
  properties,
  scheduledMessages,
} from "@/db/schema";
import { makeDemoCtx } from "@/db/seed/demo";
import { seedDemo as seedCore } from "@/db/seed/demo-core";
import { seedId } from "@/db/seed/demo-ids";
import "@/db/seed/register";
import { builtinTemplates } from "@/features/automations/builtin";
import { loadFacts } from "@/features/automations/context";
import {
  isImmediateStep,
  runAutomationEngine,
} from "@/features/automations/engine";
import { eventLabel, triggerLabel } from "@/features/automations/event-labels";
import { lintTemplateSyntax } from "@/features/automations/template-lint";
import { tidyEmailText } from "@/features/messaging/email";
import { renderTemplateFor } from "@/features/messaging/render";
import {
  entityStillValid,
  prepareScheduled,
  templateMeta,
} from "@/features/messaging/sender";
import { checkReviewEligibility } from "@/features/reviews/eligibility";
import { scheduleReviewAfterPayment } from "@/features/reviews/service";
import type { EventType } from "@/lib/event-types";
import { type DomainEvent, type EventMap, emit } from "@/lib/events";
import { type Actor, type EntityRef, SYSTEM_ACTOR } from "@/lib/types";

const CUST = "77777777-7777-4777-8777-777777777771";
const PROP = "77777777-7777-4777-8777-777777777772";
const JOB = "77777777-7777-4777-8777-777777777773";
const OFFICE = seedId("user", "office");
const TECH = seedId("user", "tech1");
const H = 3600_000;
let n = 0;

async function fire<E extends EventType>(
  type: E,
  entity: EntityRef | null,
  payload: EventMap[E],
  actor: Actor = SYSTEM_ACTOR,
): Promise<DomainEvent> {
  await db.transaction((tx) => emit(tx, type, entity, payload, { actor }));
  const [row] = await db
    .select()
    .from(events)
    .orderBy(desc(events.id))
    .limit(1);
  if (!row) throw new Error("no event");
  return {
    id: row.id,
    type: row.type as E,
    entity,
    payload: row.payload as never,
    actorUserId: row.actorUserId,
    createdAt: row.createdAt,
  };
}

const run = (e: DomainEvent, now?: Date) =>
  db.transaction((tx) => runAutomationEngine(tx, e, now));

const sends = (where: ReturnType<typeof eq>) =>
  db.select().from(scheduledMessages).where(where);

async function newLead(customerId: string | null = CUST): Promise<string> {
  n++;
  const [l] = await db
    .insert(leads)
    .values({
      customerId,
      name: "Pat Lead",
      phone: "+15125550123",
      serviceText: "Rekey",
    } as never)
    .returning({ id: leads.id });
  return l?.id as string;
}

async function newJob(v: Partial<typeof jobs.$inferInsert>): Promise<string> {
  n++;
  const [j] = await db
    .insert(jobs)
    .values({
      number: `J-Q${n}`,
      customerId: CUST,
      propertyId: PROP,
      title: "Rekey",
      ...v,
    } as never)
    .returning({ id: jobs.id });
  const id = j?.id as string;
  await db
    .insert(jobAssignments)
    .values({ jobId: id, userId: TECH, role: "primary" });
  return id;
}

async function leadCreated(leadId: string) {
  return fire("lead.created", { type: "lead", id: leadId }, {
    lead_id: leadId,
    source_id: null,
    customer_id: CUST,
    service: "Rekey",
    is_returning: false,
    sms_consent: true,
  } as never);
}

beforeAll(async () => {
  await ensureDb();
  await seedCore(
    db,
    makeDemoCtx(new Date(), () => {}, "core"),
  );
  await db.insert(customers).values({
    id: CUST,
    displayName: "Pat Customer",
    firstName: "Pat",
    phone: "+15125550123",
    email: "pat@example.com",
    smsStatus: "transactional",
  });
  await db.insert(properties).values({
    id: PROP,
    customerId: CUST,
    street: "12 Oak St",
    city: "Austin",
    state: "TX",
    zip: "78701",
    timezone: "America/Chicago",
  });
  const start = new Date(Date.now() + 3 * 24 * H);
  await db.insert(jobs).values({
    id: JOB,
    number: "J-Q0",
    customerId: CUST,
    propertyId: PROP,
    title: "Rekey",
    status: "scheduled",
    windowStart: start,
    windowEnd: new Date(start.getTime() + 2 * H),
    scheduledStart: start,
  });
  await db
    .insert(jobAssignments)
    .values({ jobId: JOB, userId: TECH, role: "primary" });
}, 180_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

// ------------------------------------------------------------------ T6-04

describe("T6-04 lead_not_reached stops once a call connects", () => {
  it("a connected call cancels the queued texts at lead.responded", async () => {
    const leadId = await newLead();
    await run(await leadCreated(leadId));
    const queued = await sends(eq(scheduledMessages.entityId, leadId));
    const notReached = queued.filter(
      (r) => r.templateKey === "lead.not_reached",
    );
    expect(notReached).toHaveLength(3);
    expect(notReached.every((r) => r.status === "scheduled")).toBe(true);

    await db.insert(calls).values({
      customerId: CUST,
      leadId,
      userId: OFFICE,
      direction: "out",
      outcome: "connected",
    });
    const res = await run(
      await fire(
        "lead.responded",
        { type: "lead", id: leadId },
        {
          lead_id: leadId,
          user_id: OFFICE,
          channel: "call",
          response_seconds: 60,
        },
      ),
    );
    expect(res.canceled).toBeGreaterThan(0);
    const after = (await sends(eq(scheduledMessages.entityId, leadId))).filter(
      (r) => r.templateKey === "lead.not_reached",
    );
    expect(after.every((r) => r.status === "canceled")).toBe(true);
  });

  it("a no-answer attempt keeps them; a later connected call stops them at send time", async () => {
    const leadId = await newLead();
    await run(await leadCreated(leadId));
    await db.insert(calls).values({
      customerId: CUST,
      leadId,
      userId: OFFICE,
      direction: "out",
      outcome: "no_answer",
    });
    await db
      .update(leads)
      .set({ status: "contacted", firstResponseAt: new Date() })
      .where(eq(leads.id, leadId));
    await run(
      await fire(
        "lead.responded",
        { type: "lead", id: leadId },
        {
          lead_id: leadId,
          user_id: OFFICE,
          channel: "call",
          response_seconds: 60,
        },
      ),
    );
    const open = (await sends(eq(scheduledMessages.entityId, leadId))).filter(
      (r) => r.templateKey === "lead.not_reached" && r.status === "scheduled",
    );
    expect(open).toHaveLength(3);

    // Second call connects (no event): the sender re-checks before sending.
    await db.insert(calls).values({
      customerId: CUST,
      leadId,
      userId: OFFICE,
      direction: "out",
      outcome: "connected",
    });
    const first = open[0];
    if (!first) throw new Error("missing");
    const out = await db.transaction((tx) =>
      prepareScheduled(tx, first.id, new Date(first.sendAt.getTime() + 1000)),
    );
    expect(out).toMatchObject({ kind: "final", status: "canceled" });
    const [row] = await sends(eq(scheduledMessages.id, first.id));
    expect(row?.lastError).toBe("lead_reached");
  });
});

// ------------------------------------------------------------------ T2-16

describe("T2-16 lead auto-reply", () => {
  it("expires (expiry taken from any channel) and cancels when the lead is booked", async () => {
    const meta = await templateMeta(db, "lead.ack");
    expect(meta?.expiresAfterMinutes).toBe(60);

    const leadId = await newLead();
    await run(await leadCreated(leadId));
    const [ack] = (await sends(eq(scheduledMessages.entityId, leadId))).filter(
      (r) => r.templateKey.startsWith("lead.ack"),
    );
    expect(ack?.expiresAt).toBeTruthy();
    // pending_tap (link mode) or deferred by quiet hours: still open either way.
    expect(["pending_tap", "deferred_quiet", "scheduled"]).toContain(
      ack?.status,
    );
    await run(
      await fire(
        "lead.converted",
        { type: "lead", id: leadId },
        {
          lead_id: leadId,
          job_id: JOB,
        },
      ),
    );
    const [after] = await sends(eq(scheduledMessages.id, ack?.id as string));
    expect(after?.status).toBe("canceled");
  });

  it("the sender drops an auto-reply for a lead someone already handled", async () => {
    const leadId = await newLead();
    await db
      .update(leads)
      .set({ status: "contacted", firstResponseAt: new Date() })
      .where(eq(leads.id, leadId));
    const facts = await loadFacts({ entity: { type: "lead", id: leadId } });
    expect(entityStillValid("lead.ack", facts)).toBe("lead_progressed");
    expect(entityStillValid("lead.ack_after_hours", facts)).toBe(
      "lead_progressed",
    );
  });
});

// ------------------------------------------------------------------ T6-05

describe("T6-05 actor skip only for immediate notices", () => {
  it("isImmediateStep: event-time, no delay, no pinned time", () => {
    expect(isImmediateStep({})).toBe(true);
    expect(isImmediateStep({ anchor: "event_time" })).toBe(true);
    expect(isImmediateStep({ delay: { minutes: 5 } })).toBe(false);
    expect(isImmediateStep({ at: "09:00" })).toBe(false);
    expect(
      isImmediateStep({ anchor: "job.window_start", delay: { days: -1 } }),
    ).toBe(false);
    expect(isImmediateStep({ anchor: "fixed_time_local 07:00" })).toBe(false);
    expect(isImmediateStep({}, 6)).toBe(false);
  });

  it("the office user who booked still gets 'unconfirmed tomorrow'; the tech who self-assigns gets no push", async () => {
    const start = new Date(Date.now() + 3 * 24 * H);
    const jobId = await newJob({
      status: "scheduled",
      windowStart: start,
      windowEnd: new Date(start.getTime() + 2 * H),
      scheduledStart: start,
    });
    const office: Actor = { kind: "user", userId: OFFICE };
    await run(
      await fire(
        "job.scheduled",
        { type: "job", id: jobId },
        {
          job_id: jobId,
          scheduled_start: start.toISOString(),
          window_start: start.toISOString(),
          window_end: new Date(start.getTime() + 2 * H).toISOString(),
          assignees: [TECH],
        } as never,
        office,
      ),
    );
    const flags = (await sends(eq(scheduledMessages.jobId, jobId))).filter(
      (r) => r.templateKey === "staff.unconfirmed",
    );
    expect(flags.some((r) => r.recipientUserId === OFFICE)).toBe(true);

    const tech: Actor = { kind: "user", userId: TECH };
    await run(
      await fire(
        "job.assigned",
        { type: "job", id: jobId },
        {
          job_id: jobId,
          user_ids_added: [TECH],
          user_ids_removed: [],
          tech_ids: [TECH],
        },
        tech,
      ),
    );
    const assigned = (await sends(eq(scheduledMessages.jobId, jobId))).filter(
      (r) => r.templateKey === "staff.job_assigned",
    );
    expect(assigned.filter((r) => r.recipientUserId === TECH)).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ T6-10

describe("T6-10 booking and reminder texts never go out late", () => {
  it("validity: completed job, passed appointment, still-ahead appointment", async () => {
    const past = new Date(Date.now() - 4 * H);
    const ahead = new Date(Date.now() + 26 * H);
    const done = await newJob({
      status: "completed",
      windowStart: past,
      windowEnd: new Date(past.getTime() + 2 * H),
      completedAt: new Date(),
    });
    const missed = await newJob({
      status: "scheduled",
      windowStart: past,
      windowEnd: new Date(past.getTime() + 2 * H),
    });
    const next = await newJob({
      status: "scheduled",
      windowStart: ahead,
      windowEnd: new Date(ahead.getTime() + 2 * H),
    });
    const f = (id: string) => loadFacts({ entity: { type: "job", id } });
    const fDone = await f(done);
    const fMissed = await f(missed);
    const fNext = await f(next);
    for (const k of ["job.booked", "job.rescheduled", "job.return_visit"]) {
      expect(entityStillValid(k, fDone)).toBe("job_progressed");
      expect(entityStillValid(k, fMissed)).toBe("appointment_passed");
      expect(entityStillValid(k, fNext)).toBeNull();
    }
    expect(entityStillValid("job.reminder_24h", fMissed)).toBe(
      "appointment_passed",
    );
    expect(entityStillValid("job.reminder_24h", fDone)).toBe("job_progressed");
    expect(entityStillValid("job.reminder_24h", fNext)).toBeNull();
  });

  it("a queued booking text for a job completed meanwhile is canceled by the sender", async () => {
    const ahead = new Date(Date.now() + 26 * H);
    const jobId = await newJob({
      status: "scheduled",
      windowStart: ahead,
      windowEnd: new Date(ahead.getTime() + 2 * H),
    });
    const [row] = await db
      .insert(scheduledMessages)
      .values({
        dedupeKey: `test:booked:${jobId}`,
        templateKey: "job.booked",
        channel: "sms",
        purpose: "transactional",
        audienceType: "customer",
        recipientCustomerId: CUST,
        entityType: "job",
        entityId: jobId,
        jobId,
        sendAt: new Date(),
        status: "scheduled",
      } as never)
      .returning({ id: scheduledMessages.id });
    await db
      .update(jobs)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(jobs.id, jobId));
    const out = await db.transaction((tx) =>
      prepareScheduled(tx, row?.id as string),
    );
    expect(out).toMatchObject({ kind: "final", status: "canceled" });
  });

  it("booking, reschedule and 24h templates carry an expiry", async () => {
    expect((await templateMeta(db, "job.booked"))?.expiresAfterMinutes).toBe(
      720,
    );
    expect(
      (await templateMeta(db, "job.rescheduled"))?.expiresAfterMinutes,
    ).toBe(720);
    expect(
      (await templateMeta(db, "job.reminder_24h"))?.expiresAfterMinutes,
    ).toBe(1200);
  });
});

// ------------------------------------------------------------------ T6-06

describe("T6-06 review eligibility", () => {
  it("closed is not paid: an unpaid closed job waits for payment", async () => {
    const jobId = await newJob({
      status: "closed",
      completedAt: new Date(Date.now() - 2 * H),
      closedAt: new Date(),
      paymentStatus: "none",
    });
    expect(await checkReviewEligibility(db, jobId)).toMatchObject({
      ok: false,
      reason: "awaiting_payment",
    });
    // …and job.closed doesn't queue an ask the sender would refuse.
    expect(
      await db.transaction((tx) => scheduleReviewAfterPayment(tx, jobId)),
    ).toBe(false);
  });

  it("never asks after a dispute, even on a paid job", async () => {
    const jobId = await newJob({
      status: "closed",
      completedAt: new Date(Date.now() - 2 * H),
      closedAt: new Date(),
      paymentStatus: "paid",
    });
    expect((await checkReviewEligibility(db, jobId)).ok).toBe(true);
    const [p] = await db
      .insert(payments)
      .values({
        jobId,
        customerId: CUST,
        kind: "payment",
        method: "card",
        provider: "stripe",
        status: "succeeded",
        amountCents: 12_500,
      } as never)
      .returning({ id: payments.id });
    await db.insert(disputes).values({
      paymentId: p?.id as string,
      provider: "stripe",
      providerRef: `dp_test_${jobId}`,
      category: "general",
      amountCents: 12_500,
      status: "needs_response",
    } as never);
    expect(await checkReviewEligibility(db, jobId)).toMatchObject({
      ok: false,
      reason: "disputed",
    });
    expect(
      await checkReviewEligibility(db, jobId, { manual: true }),
    ).toMatchObject({ ok: false, reason: "disputed" });
    expect(
      await db.transaction((tx) => scheduleReviewAfterPayment(tx, jobId)),
    ).toBe(false);
  });

  it("an old job closed by a settlement lock is not asked automatically", async () => {
    const jobId = await newJob({
      status: "closed",
      completedAt: new Date(Date.now() - 60 * 24 * H),
      closedAt: new Date(),
      paymentStatus: "paid",
    });
    expect(await checkReviewEligibility(db, jobId)).toMatchObject({
      ok: false,
      reason: "too_old",
    });
    // A person asking by hand decides for themselves.
    expect((await checkReviewEligibility(db, jobId, { manual: true })).ok).toBe(
      true,
    );
    expect(
      await db.transaction((tx) => scheduleReviewAfterPayment(tx, jobId)),
    ).toBe(false);
  });

  it("a recent paid job is still asked once", async () => {
    const jobId = await newJob({
      status: "completed",
      completedAt: new Date(Date.now() - 2 * H),
      paymentStatus: "paid",
    });
    expect(
      await db.transaction((tx) => scheduleReviewAfterPayment(tx, jobId)),
    ).toBe(true);
    const asks = await sends(
      and(
        eq(scheduledMessages.jobId, jobId),
        eq(scheduledMessages.templateKey, "review.request"),
      ) as never,
    );
    expect(asks).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ T6-13 / phone

describe("T6-13 email rendering", () => {
  it("tidyEmailText collapses blank runs and trailing spaces", () => {
    expect(tidyEmailText("Hi,\n\nLine one. \n\n\n\nBye  now\n")).toBe(
      "Hi,\n\nLine one.\n\nBye now",
    );
  });

  it("the booking email has no blank lines when the fee line is empty", async () => {
    const r = await db.transaction((tx) =>
      renderTemplateFor(tx, {
        templateKey: "job.booked",
        channel: "email",
        customerId: CUST,
        jobId: JOB,
        entity: { type: "job", id: JOB },
        mint: false,
        bodyOverride:
          "Hi {{customer.first_name}},\n\nBooked {{job.window}}.\n\n{{job.cancel_fee_line}}\n\nDetails: {{job.link}}",
      }),
    );
    expect(r?.body).not.toMatch(/\n{3,}/);
    expect(r?.body).toContain("Details: ");
  });

  it("company.phone renders formatted, never raw E.164", async () => {
    const r = await db.transaction((tx) =>
      renderTemplateFor(tx, {
        templateKey: "x",
        channel: "sms",
        customerId: CUST,
        mint: false,
        bodyOverride: "Call {{company.phone|us}}",
      }),
    );
    expect(r?.body).not.toMatch(/\+1\d{10}/);
  });
});

// ------------------------------------------------------------------ T3-14 / T4-26

describe("T3-14 template lint", () => {
  it("flags broken tags and a review ask without its link", () => {
    expect(
      lintTemplateSyntax("job.booked", "See {{job.link today").errors,
    ).toHaveLength(1);
    expect(
      lintTemplateSyntax("job.booked", "Stray }} brace").errors,
    ).toHaveLength(1);
    expect(
      lintTemplateSyntax("review.request", "Thanks for choosing us!").errors[0],
    ).toMatch(/review\.link/);
    expect(
      lintTemplateSyntax("review.request", "Review us: {{review.link}}").errors,
    ).toHaveLength(0);
  });

  it("warns on unknown variables without blocking", () => {
    const l = lintTemplateSyntax("job.booked", "Hi {{custmer.first_name}}");
    expect(l.errors).toHaveLength(0);
    expect(l.unknown).toEqual(["custmer.first_name"]);
    expect(l.warnings[0]).toMatch(/custmer\.first_name/);
  });

  it("every built-in template lints clean", () => {
    for (const t of builtinTemplates) {
      const l = lintTemplateSyntax(t.key, `${t.subject ?? ""}\n${t.body}`);
      expect({ key: t.key, ...l }).toMatchObject({
        key: t.key,
        errors: [],
        unknown: [],
      });
    }
  });
});

describe("T4-26 event labels", () => {
  it("shows plain words for trigger keys", () => {
    expect(eventLabel("job.return_visit_scheduled")).toBe(
      "Return visit booked",
    );
    expect(eventLabel("schedule.daily")).toBe("Every morning");
    expect(eventLabel("something.new_thing")).toBe("Something new thing");
    expect(
      triggerLabel("job.scheduled|job.return_visit_scheduled|job.rescheduled"),
    ).toBe("Job booked or return visit booked or job rescheduled");
  });
});
