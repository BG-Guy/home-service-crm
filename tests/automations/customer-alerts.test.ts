// Alerts when the customer views or signs (Quote to Paid, part J5), on a private
// PGlite: "Estimate viewed" and "Estimate approved" also reach the job's techs
// (one push per person, even when the author is on the job), and the new
// "Invoice viewed" reaches the job's techs and the office.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-q2p-alerts-"),
);
process.env.PGLITE_DIR = path.join(root, "pglite");
process.env.UPLOADS_DIR = path.join(root, "uploads");
process.env.CRM_DISABLE_BACKGROUND = "1";
process.env.CRON_PIGGYBACK = "0";
process.env.AI_PROVIDER = "none";

import { and, desc, eq } from "drizzle-orm";
import { closeDb, db, ensureDb } from "@/db";
import {
  customers,
  estimates,
  events,
  invoices,
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
import { NOTIFICATION_TYPES } from "@/features/notify/catalog";
import { notifyKind } from "@/features/notify/kinds";
import type { EventType } from "@/lib/event-types";
import { type DomainEvent, type EventMap, emit } from "@/lib/events";
import { type EntityRef, SYSTEM_ACTOR } from "@/lib/types";

const CUSTOMER = "71111111-1111-4111-8111-111111111111";
const PROPERTY = "72222222-2222-4222-8222-222222222222";
const JOB = "73333333-3333-4333-8333-333333333333";
const ESTIMATE = "74444444-4444-4444-8444-444444444444";
const INVOICE = "75555555-5555-4555-8555-555555555555";
const TOKEN = "76666666-6666-4666-8666-666666666666";
const TECH1 = seedId("user", "tech1");
const TECH2 = seedId("user", "tech2");
const OFFICE = seedId("user", "office");

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

/** Who got a staff push for this template (one entry per scheduled row). */
async function pushedTo(templateKey: string): Promise<string[]> {
  const rows = await db
    .select({ to: scheduledMessages.recipientUserId })
    .from(scheduledMessages)
    .where(
      and(
        eq(scheduledMessages.templateKey, templateKey),
        eq(scheduledMessages.channel, "push"),
      ),
    );
  return rows.map((r) => r.to as string).sort();
}

beforeAll(async () => {
  await ensureDb();
  await seedCore(
    db,
    makeDemoCtx(new Date(), () => {}, "core"),
  );
  await db.insert(customers).values({
    id: CUSTOMER,
    displayName: "Sophia Taylor",
    firstName: "Sophia",
    phone: "+13035550188",
    email: "sophia@example.com",
    smsStatus: "transactional",
  });
  await db.insert(properties).values({
    id: PROPERTY,
    customerId: CUSTOMER,
    street: "8106 S Monaco Pkwy",
    city: "Denver",
    state: "CO",
    zip: "80112",
    timezone: "America/Denver",
  });
  await db.insert(jobs).values({
    id: JOB,
    number: "J-9079",
    customerId: CUSTOMER,
    propertyId: PROPERTY,
    title: "Install Grade 1 deadbolts",
    status: "in_progress",
  });
  await db.insert(jobAssignments).values([
    { jobId: JOB, userId: TECH1, role: "primary" },
    { jobId: JOB, userId: TECH2, role: "helper" },
  ]);
  // Tech 1 wrote the estimate and is on the job.
  await db.insert(estimates).values({
    id: ESTIMATE,
    number: "E-9026",
    jobId: JOB,
    customerId: CUSTOMER,
    propertyId: PROPERTY,
    status: "viewed",
    createdBy: TECH1,
  });
  await db.insert(invoices).values({
    id: INVOICE,
    number: "INV-9067",
    jobId: JOB,
    customerId: CUSTOMER,
    propertyId: PROPERTY,
    status: "issued",
    totalCents: 45073,
  });
}, 180_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

describe("customer alerts", () => {
  it("estimate viewed: the author and the job's techs, once each", async () => {
    const e = await fire(
      "estimate.viewed",
      { type: "estimate", id: ESTIMATE },
      { estimate_id: ESTIMATE, token_id: TOKEN },
    );
    await db.transaction((tx) => runAutomationEngine(tx, e));
    expect(await pushedTo("staff.estimate_viewed")).toEqual(
      [TECH1, TECH2].sort(),
    );
  });

  it("estimate approved: the author, the office and the job's techs, once each", async () => {
    const e = await fire(
      "estimate.approved",
      { type: "estimate", id: ESTIMATE },
      {
        estimate_id: ESTIMATE,
        option_id: ESTIMATE,
        signature_id: null,
        channel: "remote_link",
      },
    );
    await db.transaction((tx) => runAutomationEngine(tx, e));
    expect(await pushedTo("staff.estimate_approved")).toEqual(
      [TECH1, TECH2, OFFICE].sort(),
    );
  });

  it("invoice viewed: the job's techs and the office", async () => {
    const e = await fire(
      "invoice.viewed",
      { type: "invoice", id: INVOICE },
      { invoice_id: INVOICE, token_id: TOKEN },
    );
    await db.transaction((tx) => runAutomationEngine(tx, e));
    expect(await pushedTo("staff.invoice_viewed")).toEqual(
      [TECH1, TECH2, OFFICE].sort(),
    );
    // Re-running the same event schedules nothing new (dedupe).
    await db.transaction((tx) => runAutomationEngine(tx, e));
    expect(await pushedTo("staff.invoice_viewed")).toHaveLength(3);
  });

  it("the new alert has its own catalog entry, icon and money color", () => {
    expect(
      NOTIFICATION_TYPES.find((t) => t.key === "staff.invoice_viewed")?.group,
    ).toBe("Money");
    const k = notifyKind("staff.invoice_viewed");
    expect(k.label).toBe("Invoice viewed");
    expect(k.category).toBe("money");
    expect(k.tone).toBe("blue");
  });
});
