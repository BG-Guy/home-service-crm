// Messaging flows on a private PGlite (SPEC M12/M14): enqueue → outbox card → "Sent? Yes",
// email through the sender, inbound STOP / C replies, review eligibility, staff push.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-b5-flows-"),
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
  customers,
  events,
  jobAssignments,
  jobs,
  messages,
  notifications,
  properties,
  reviewRequests,
  scheduledMessages,
} from "@/db/schema";
import { makeDemoCtx } from "@/db/seed/demo";
import { seedDemo as seedCore } from "@/db/seed/demo-core";
import { seedId } from "@/db/seed/demo-ids";
import "@/db/seed/register";
import { enqueueMessage } from "@/features/messaging/api";
import {
  handleInboundKeywords,
  recordInbound,
} from "@/features/messaging/inbound";
import {
  deliverDueMessages,
  recordOutbound,
} from "@/features/messaging/sender";
import { checkReviewEligibility } from "@/features/reviews/eligibility";
import { SYSTEM_ACTOR } from "@/lib/types";

const CUST = "44444444-4444-4444-8444-444444444444";
const PROP = "55555555-5555-4555-8555-555555555555";
const JOB = "66666666-6666-4666-8666-666666666666";
const OFFICE = seedId("user", "office");
const TECH = seedId("user", "tech1");

beforeAll(async () => {
  await ensureDb();
  await seedCore(
    db,
    makeDemoCtx(new Date(), () => {}, "core"),
  );
  await db.insert(customers).values({
    id: CUST,
    displayName: "Sam Customer",
    firstName: "Sam",
    phone: "+15125550199",
    email: "sam@example.com",
    smsStatus: "transactional",
  });
  await db.insert(properties).values({
    id: PROP,
    customerId: CUST,
    street: "9 Elm St",
    city: "Austin",
    state: "TX",
    zip: "78701",
    timezone: "America/Chicago",
  });
  const start = new Date(Date.now() + 26 * 3600_000);
  await db.insert(jobs).values({
    id: JOB,
    number: "J-9100",
    customerId: CUST,
    propertyId: PROP,
    title: "Rekey",
    status: "scheduled",
    windowStart: start,
    windowEnd: new Date(start.getTime() + 2 * 3600_000),
  });
  await db
    .insert(jobAssignments)
    .values({ jobId: JOB, userId: TECH, role: "primary" });
}, 180_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

describe("link-mode SMS", () => {
  it("a due text becomes an outbox card at once; 'Sent? Yes' records it and emits message.sent", async () => {
    const res = await db.transaction((tx) =>
      enqueueMessage(
        tx,
        {
          body: "Hi Sam, quick question about your appointment.",
          channel: "sms",
          purpose: "transactional",
          audience: { type: "customer", customerId: CUST },
          jobId: JOB,
          outboxAssigneeUserId: OFFICE,
        },
        { kind: "user", userId: OFFICE },
      ),
    );
    expect(res.status).toBe("pending_tap");
    const [row] = await db
      .select()
      .from(scheduledMessages)
      .where(eq(scheduledMessages.id, res.scheduledMessageId));
    expect(row?.toAddress).toBe("+15125550199");
    expect(row?.assignedUserId).toBe(OFFICE);
    if (!row) return;
    const msgId = await db.transaction((tx) =>
      recordOutbound(tx, row, {
        status: "sent_manual",
        body: row.renderedBody ?? "",
        sentByUserId: OFFICE,
      }),
    );
    const [m] = await db.select().from(messages).where(eq(messages.id, msgId));
    expect(m?.status).toBe("sent_manual");
    const [ev] = await db
      .select()
      .from(events)
      .where(eq(events.type, "message.sent"))
      .orderBy(desc(events.id))
      .limit(1);
    expect((ev?.payload as { message_id?: string })?.message_id).toBe(msgId);
  });

  it("dedupe keys make enqueue idempotent", async () => {
    const send = () =>
      db.transaction((tx) =>
        enqueueMessage(
          tx,
          {
            templateKey: "job.reminder_24h",
            channel: "sms",
            audience: { type: "customer", customerId: CUST },
            jobId: JOB,
            dedupeKey: "test:dupe:1",
            sendAt: new Date(Date.now() + 3600_000),
          },
          SYSTEM_ACTOR,
        ),
      );
    const a = await send();
    const b = await send();
    expect(b.scheduledMessageId).toBe(a.scheduledMessageId);
  });
});

describe("email through the sender", () => {
  it("customer email renders, sends via the console driver and is recorded", async () => {
    const res = await db.transaction((tx) =>
      enqueueMessage(
        tx,
        {
          templateKey: "job.booked",
          channel: "email",
          audience: { type: "customer", customerId: CUST },
          entity: { type: "job", id: JOB },
          jobId: JOB,
          dedupeKey: "test:email:1",
        },
        SYSTEM_ACTOR,
      ),
    );
    expect(res.status).toBe("scheduled");
    const out = await deliverDueMessages();
    expect(out.sent).toBeGreaterThanOrEqual(1);
    const [row] = await db
      .select()
      .from(scheduledMessages)
      .where(eq(scheduledMessages.id, res.scheduledMessageId));
    expect(row?.status).toBe("sent");
    expect(row?.renderedBody).toMatch(/Rekey/);
    expect(row?.renderedBody).toMatch(/9 Elm St/);
    expect(row?.renderedSubject).toBeTruthy();
  });
});

describe("inbound replies", () => {
  it("C confirms the next job (B2 confirmJob)", async () => {
    const { messageId } = await db.transaction((tx) =>
      recordInbound(tx, {
        customerId: CUST,
        from: "+15125550199",
        body: "C",
        channel: "sms",
        driver: "manual",
        status: "logged",
        loggedByUserId: OFFICE,
      }),
    );
    const did = await db.transaction((tx) =>
      handleInboundKeywords(tx, {
        message_id: messageId,
        customer_id: CUST,
        body: "C",
      }),
    );
    expect(did).toBe("confirm");
    const [j] = await db
      .select({ s: jobs.status })
      .from(jobs)
      .where(eq(jobs.id, JOB));
    expect(j?.s).toBe("confirmed");
  });

  it("STOP opts out (once) and suppresses queued texts", async () => {
    const { messageId } = await db.transaction((tx) =>
      recordInbound(tx, {
        customerId: CUST,
        from: "+15125550199",
        body: "STOP",
        channel: "sms",
        driver: "manual",
        status: "logged",
      }),
    );
    const run = () =>
      db.transaction((tx) =>
        handleInboundKeywords(tx, {
          message_id: messageId,
          customer_id: CUST,
          body: "STOP",
        }),
      );
    expect(await run()).toBe("stop");
    expect(await run()).toBe("duplicate");
    const [c] = await db
      .select({ s: customers.smsStatus })
      .from(customers)
      .where(eq(customers.id, CUST));
    expect(c?.s).toBe("opted_out");
    const [dupe] = await db
      .select({ s: scheduledMessages.status })
      .from(scheduledMessages)
      .where(eq(scheduledMessages.dedupeKey, "test:dupe:1"));
    expect(dupe?.s).toBe("suppressed_optout");
  });
});

describe("review eligibility (sentiment-neutral rules)", () => {
  it("waits for payment, then allows at most two asks", async () => {
    await db
      .update(jobs)
      .set({
        status: "completed",
        completedAt: new Date(),
        paymentStatus: "none",
      })
      .where(eq(jobs.id, JOB));
    // Email still reaches an SMS-opted-out customer.
    const wait = await checkReviewEligibility(db, JOB);
    expect(wait).toMatchObject({
      ok: false,
      reason: "awaiting_payment",
      wait: true,
    });
    await db
      .update(jobs)
      .set({ paymentStatus: "paid" })
      .where(eq(jobs.id, JOB));
    expect((await checkReviewEligibility(db, JOB)).ok).toBe(true);
    await db
      .insert(reviewRequests)
      .values({ jobId: JOB, customerId: CUST, sentCount: 2 });
    expect(await checkReviewEligibility(db, JOB)).toMatchObject({
      ok: false,
      reason: "max_asks",
    });
  });
});

describe("staff push", () => {
  it("a push to a user writes the bell row immediately", async () => {
    await db.transaction((tx) =>
      enqueueMessage(
        tx,
        {
          templateKey: "staff.generic",
          channel: "push",
          audience: { type: "user", userId: TECH },
          vars: { title: "Hello", body: "Test" },
          dedupeKey: "test:push:1",
        },
        SYSTEM_ACTOR,
      ),
    );
    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, TECH),
          eq(notifications.type, "staff.generic"),
        ),
      );
    expect(rows.length).toBe(1);
    expect(rows[0]?.title).toBe("Hello");
  });
});
