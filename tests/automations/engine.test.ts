// Automation engine integration (SPEC M13, §7.2; BUILD_PLAN §7.0) on a private PGlite:
// triggers → scheduled_messages, dedupe on re-emitted events, reschedule recompute,
// cancel_on, job.cancelled sweep, consent revoke suppression.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-b5-engine-"),
);
process.env.PGLITE_DIR = path.join(root, "pglite");
process.env.UPLOADS_DIR = path.join(root, "uploads");
process.env.CRM_DISABLE_BACKGROUND = "1";
process.env.CRON_PIGGYBACK = "0";
process.env.AI_PROVIDER = "none";

import { and, desc, eq, inArray } from "drizzle-orm";
import { closeDb, db, ensureDb } from "@/db";
import {
  customers,
  events,
  jobAssignments,
  jobs,
  properties,
  scheduledMessages,
} from "@/db/schema";
import { makeDemoCtx } from "@/db/seed/demo";
import { seedDemo as seedCore } from "@/db/seed/demo-core";
import { seedId } from "@/db/seed/demo-ids";
import "@/db/seed/register";
import { runAutomationEngine } from "@/features/automations/engine";
import { recordConsent } from "@/features/messaging/api";
import type { EventType } from "@/lib/event-types";
import { type DomainEvent, type EventMap, emit } from "@/lib/events";
import {
  addDaysToKey,
  dateKey,
  parseDateKey,
  zonedTimeToUtc,
} from "@/lib/time";
import { type EntityRef, SYSTEM_ACTOR } from "@/lib/types";

const TZ = "America/Chicago";
const CUSTOMER = "11111111-1111-4111-8111-111111111111";
const PROPERTY = "22222222-2222-4222-8222-222222222222";
const JOB = "33333333-3333-4333-8333-333333333333";
const TECH = seedId("user", "tech1");

async function fire<E extends EventType>(
  type: E,
  entity: EntityRef | null,
  payload: EventMap[E],
): Promise<DomainEvent> {
  await db.transaction((tx) =>
    emit(tx, type, entity, payload, { actor: SYSTEM_ACTOR }),
  );
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

const run = (e: DomainEvent) =>
  db.transaction((tx) => runAutomationEngine(tx, e));

async function rowsFor(jobId: string) {
  return db
    .select()
    .from(scheduledMessages)
    .where(eq(scheduledMessages.jobId, jobId));
}

/** Local 10:00 three days from now (well past any immediate send). */
function windowIn(days: number, hour = 10) {
  const key = addDaysToKey(dateKey(new Date(), TZ), days);
  const start = zonedTimeToUtc({ ...parseDateKey(key), hour, minute: 0 }, TZ);
  return { start, end: new Date(start.getTime() + 2 * 3600_000) };
}

beforeAll(async () => {
  await ensureDb();
  await seedCore(
    db,
    makeDemoCtx(new Date(), () => {}, "core"),
  );
  await db.insert(customers).values({
    id: CUSTOMER,
    displayName: "Pat Customer",
    firstName: "Pat",
    phone: "+15125550123",
    email: "pat@example.com",
    smsStatus: "transactional",
  });
  await db.insert(properties).values({
    id: PROPERTY,
    customerId: CUSTOMER,
    street: "12 Oak St",
    city: "Austin",
    state: "TX",
    zip: "78701",
    timezone: TZ,
  });
  const w = windowIn(3);
  await db.insert(jobs).values({
    id: JOB,
    number: "J-9001",
    customerId: CUSTOMER,
    propertyId: PROPERTY,
    title: "Rekey",
    status: "scheduled",
    windowStart: w.start,
    windowEnd: w.end,
    scheduledStart: w.start,
  });
  await db
    .insert(jobAssignments)
    .values({ jobId: JOB, userId: TECH, role: "primary" });
}, 180_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

describe("automation engine", () => {
  it("job.scheduled schedules the booking confirmation, reminders and staff prompts", async () => {
    const w = windowIn(3);
    const e = await fire("job.scheduled", { type: "job", id: JOB }, {
      job_id: JOB,
      scheduled_start: w.start.toISOString(),
      window_start: w.start.toISOString(),
      window_end: w.end.toISOString(),
      assignees: [TECH],
    } as never);
    const res = await run(e);
    expect(res.matched).toEqual(
      expect.arrayContaining([
        "booking_confirm",
        "reminder_24h",
        "reminder_2h",
        "unconfirmed_flag",
        "late_prompt",
      ]),
    );
    const rows = await rowsFor(JOB);
    const keys = rows.map((r) => r.templateKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        "job.booked",
        "job.reminder_24h",
        "job.reminder_2h",
        "staff.late_prompt",
      ]),
    );
    const r24 = rows.find((r) => r.templateKey === "job.reminder_24h");
    expect(r24?.sendAt.getTime()).toBe(w.start.getTime() - 24 * 3600_000);
    const r2 = rows.find((r) => r.templateKey === "job.reminder_2h");
    expect(r2?.sendAt.getTime()).toBe(w.start.getTime() - 2 * 3600_000);
    // booking confirmation is due now: decided in the same transaction
    const booked = rows.find((r) => r.templateKey === "job.booked");
    expect(["pending_tap", "deferred_quiet"]).toContain(booked?.status);
  });

  it("re-processing the same event never double-schedules (dedupe keys)", async () => {
    const before = (await rowsFor(JOB)).length;
    const [last] = await db
      .select()
      .from(events)
      .where(eq(events.type, "job.scheduled"))
      .orderBy(desc(events.id))
      .limit(1);
    if (!last) throw new Error("missing");
    await run({
      id: last.id,
      type: "job.scheduled",
      entity: { type: "job", id: JOB },
      payload: last.payload as never,
      actorUserId: null,
      createdAt: last.createdAt,
    });
    expect((await rowsFor(JOB)).length).toBe(before);
  });

  it("job.rescheduled recomputes anchored sends (old canceled, new created)", async () => {
    const w2 = windowIn(5, 14);
    await db
      .update(jobs)
      .set({
        windowStart: w2.start,
        windowEnd: w2.end,
        scheduledStart: w2.start,
      })
      .where(eq(jobs.id, JOB));
    const e = await fire("job.rescheduled", { type: "job", id: JOB }, {
      job_id: JOB,
      old_start: windowIn(3).start.toISOString(),
      new_start: w2.start.toISOString(),
      tech_ids: [TECH],
    } as never);
    await run(e);
    const rows = await rowsFor(JOB);
    const r24 = rows.filter((r) => r.templateKey === "job.reminder_24h");
    expect(r24.some((r) => r.status === "canceled")).toBe(true);
    const live = r24.filter((r) => r.status === "scheduled");
    expect(live).toHaveLength(1);
    expect(live[0]?.sendAt.getTime()).toBe(w2.start.getTime() - 24 * 3600_000);
    expect(rows.some((r) => r.templateKey === "job.rescheduled")).toBe(true);
  });

  it("job.confirmed cancels the unconfirmed flag (cancel_on)", async () => {
    await db.update(jobs).set({ status: "confirmed" }).where(eq(jobs.id, JOB));
    const e = await fire("job.confirmed", { type: "job", id: JOB }, {
      job_id: JOB,
      via: "reply",
    } as never);
    const res = await run(e);
    expect(res.canceled).toBeGreaterThan(0);
    const open = (await rowsFor(JOB)).filter(
      (r) =>
        r.templateKey === "staff.unconfirmed" &&
        ["scheduled", "deferred_quiet"].includes(r.status),
    );
    expect(open).toHaveLength(0);
  });

  it("an SMS opt-out suppresses queued texts but not email", async () => {
    await db.transaction((tx) =>
      recordConsent(
        tx,
        {
          customerId: CUSTOMER,
          address: "+15125550123",
          channel: "sms",
          purpose: "transactional",
          action: "revoke",
          source: "admin",
        },
        SYSTEM_ACTOR,
      ),
    );
    const [c] = await db
      .select({ s: customers.smsStatus })
      .from(customers)
      .where(eq(customers.id, CUSTOMER));
    expect(c?.s).toBe("opted_out");
    const texts = (await rowsFor(JOB)).filter(
      (r) => r.channel === "sms" && r.templateKey === "job.reminder_2h",
    );
    expect(texts.every((r) => r.status !== "scheduled")).toBe(true);
    // customer_preferred rows stay queued (they may still go by email at send time)
    const pref = (await rowsFor(JOB)).filter(
      (r) =>
        r.channel === "customer_preferred" &&
        r.templateKey === "job.reminder_24h" &&
        r.status === "scheduled",
    );
    expect(pref.length).toBe(1);
  });

  it("job.cancelled drops pending job sends except cancellation follow-ups", async () => {
    await db.update(jobs).set({ status: "cancelled" }).where(eq(jobs.id, JOB));
    const e = await fire("job.cancelled", { type: "job", id: JOB }, {
      job_id: JOB,
      reason: "customer_cancelled",
      after_arrival: false,
      tech_ids: [TECH],
    } as never);
    await run(e);
    const open = await db
      .select()
      .from(scheduledMessages)
      .where(
        and(
          eq(scheduledMessages.jobId, JOB),
          inArray(scheduledMessages.status, ["scheduled", "deferred_quiet"]),
        ),
      );
    expect(
      open.every((r) =>
        ["job.cancelled", "staff.job_changed"].includes(r.templateKey),
      ),
    ).toBe(true);
  });
});
