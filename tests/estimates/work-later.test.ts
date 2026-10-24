// Quote to Paid E5, "when is the work?" after signing, on a throwaway PGlite
// (TEST_PGLITE_ROOT): Schedule later moves the estimate's lines (by source) and
// its open deposit request to a new unscheduled follow-up job; "Move it back"
// undoes it quietly while the follow-up is unbooked and unpaid; a paid deposit
// locks the choice; the visit's techs keep seeing the estimate.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-work-later-"),
);
process.env.PGLITE_DIR = path.join(root, "pglite");
process.env.UPLOADS_DIR = path.join(root, "uploads");
process.env.CRM_DISABLE_BACKGROUND = "1";
process.env.CRON_PIGGYBACK = "0";
process.env.AI_PROVIDER = "none";

import { and, eq, sql } from "drizzle-orm";
import { closeDb, db, ensureDb, execRows, type Tx } from "@/db";
import {
  customers,
  depositRequests,
  estimateOptions,
  estimates,
  invoices,
  jobAssignments,
  jobs,
  lineItems,
  properties,
  users,
} from "@/db/schema";
import "@/db/seed/register";
import { assertEstimateAccess } from "@/features/estimates/access";
import {
  approveEstimateTx,
  createEstimateDraft,
  moveEstimateBackTx,
  scheduleEstimateLaterTx,
  workState,
} from "@/features/estimates/api";
import type { LineInput } from "@/features/invoices/api";
import { addJobLine, insertLines } from "@/features/invoices/api";
import { createJob } from "@/features/jobs/api";
import { loadSessionUser } from "@/lib/auth/current";
import { signup } from "@/lib/auth/flows";
import { type SessionUser, SYSTEM_ACTOR } from "@/lib/types";

let customerId = "";
let propertyId = "";
let tech: SessionUser;

const inTx = <T>(fn: (tx: Tx) => Promise<T>) => db.transaction(fn);
const svc = (name: string, cents: number, o: Partial<LineInput> = {}) =>
  ({
    type: "service",
    name,
    qty: 1,
    unitPriceCents: cents,
    taxable: false,
    ...o,
  }) as LineInput;

async function invoiceLinesOf(jobId: string) {
  const [inv] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.jobId, jobId)));
  if (!inv) return { inv: null, names: [] as string[] };
  const lines = await db
    .select({ name: lineItems.name })
    .from(lineItems)
    .where(
      and(eq(lineItems.parentType, "invoice"), eq(lineItems.parentId, inv.id)),
    );
  return { inv, names: lines.map((l) => l.name).sort() };
}

/** A job with a service-call fee, an approved estimate and an open deposit. */
async function approvedJob() {
  const { jobId } = await inTx((tx) =>
    createJob(
      tx,
      { customerId, propertyId, title: "Rekey all doors" },
      SYSTEM_ACTOR,
    ),
  );
  await db
    .insert(jobAssignments)
    .values({ jobId, userId: tech.id, role: "primary" } as never);
  await inTx((tx) =>
    addJobLine(
      tx,
      jobId,
      svc("Service call", 8900, { isServiceFee: true }),
      SYSTEM_ACTOR,
    ),
  );
  const { estimateId } = await inTx((tx) =>
    createEstimateDraft(tx, { customerId, jobId }, SYSTEM_ACTOR),
  );
  const [opt] = await db
    .select()
    .from(estimateOptions)
    .where(eq(estimateOptions.estimateId, estimateId));
  await inTx((tx) =>
    insertLines(tx, "estimate_option", opt?.id as string, [
      svc("Rekey six cylinders", 33000),
    ]),
  );
  await inTx((tx) =>
    approveEstimateTx(
      tx,
      {
        estimateId,
        optionId: opt?.id as string,
        addonIds: [],
        sign: {
          signerName: "Sam Lee",
          signatureMediaId: null,
          channel: "verbal",
          esignConsent: false,
          consentText: "Verbal approval recorded in a test",
        },
      },
      SYSTEM_ACTOR,
    ),
  );
  const [dep] = await db
    .insert(depositRequests)
    .values({
      jobId,
      estimateId,
      amountCents: 9000,
      mode: "manual",
      status: "requested",
    } as never)
    .returning({ id: depositRequests.id });
  return { jobId, estimateId, depositId: dep?.id as string };
}

beforeAll(async () => {
  await ensureDb();
  const s = await signup({
    companyName: "Later Locks",
    name: "Ada Admin",
    email: "ada@later.test",
    password: "tangerine-kayak-41",
    timezone: "America/Denver",
    state: "co",
  });
  const admin = (await loadSessionUser(
    s.userId,
    s.session?.sessionId as string,
  )) as SessionUser;
  const [c] = await db
    .insert(customers)
    .values({ displayName: "Sam Lee", firstName: "Sam" } as never)
    .returning({ id: customers.id });
  customerId = c?.id as string;
  const [p] = await db
    .insert(properties)
    .values({
      customerId,
      street: "12 Elm St",
      city: "Denver",
      state: "CO",
      zip: "80210",
    })
    .returning({ id: properties.id });
  propertyId = p?.id as string;
  // A tech: no jobs.view_all, sees only jobs they're on.
  const [u] = await db
    .insert(users)
    .values({
      email: "tech@later.test",
      name: "Derek Tech",
      role: "tech",
      status: "active",
    } as never)
    .returning({ id: users.id });
  tech = {
    ...admin,
    id: u?.id as string,
    name: "Derek Tech",
    baseRole: "tech",
    perms: new Set([...admin.perms].filter((x) => x !== "jobs.view_all")),
  } as SessionUser;
}, 120_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

describe("Schedule later", () => {
  it("moves the estimate's lines and open deposit to an unscheduled follow-up", async () => {
    const { jobId, estimateId, depositId } = await approvedJob();
    const before = await workState(estimateId);
    expect(before).toMatchObject({
      mode: "now",
      linesOnInvoice: 1,
      canScheduleLater: true,
      canMoveBack: false,
    });
    const r = await inTx((tx) =>
      scheduleEstimateLaterTx(tx, estimateId, SYSTEM_ACTOR),
    );
    const [follow] = await db.select().from(jobs).where(eq(jobs.id, r.jobId));
    expect(follow).toMatchObject({
      status: "unscheduled",
      estimateId,
      customerId,
      propertyId,
    });
    expect(follow?.title).toBe("Follow-up: Rekey all doors");
    // The fee and its credit stay on the visit; the approved work moved.
    expect((await invoiceLinesOf(jobId)).names).toEqual([
      "Service call",
      "Service call fee credited",
    ]);
    expect((await invoiceLinesOf(r.jobId)).names).toEqual([
      "Rekey six cylinders",
    ]);
    const [dep] = await db
      .select()
      .from(depositRequests)
      .where(eq(depositRequests.id, depositId));
    expect(dep?.jobId).toBe(r.jobId);
    const [est] = await db
      .select()
      .from(estimates)
      .where(eq(estimates.id, estimateId));
    expect(est?.jobId).toBe(r.jobId);
    const after = await workState(estimateId);
    expect(after).toMatchObject({
      mode: "later",
      originJob: { id: jobId },
      canMoveBack: true,
      canScheduleLater: false,
    });
    // The visit's tech still sees it (the follow-up has no one assigned yet).
    await expect(
      assertEstimateAccess(tech, estimateId, "read"),
    ).resolves.toBeTruthy();
    const acts = await execRows<{ kind: string }>(
      sql`select kind from activity where kind in ('estimate.work_later','job.work_moved') and (entity_id = ${estimateId} or entity_id = ${jobId} or entity_id = ${r.jobId})`,
    );
    expect(acts.map((a) => a.kind).sort()).toEqual([
      "estimate.work_later",
      "job.work_moved",
      "job.work_moved",
    ]);
  });

  it("Move it back: the lines return, the follow-up is cancelled quietly", async () => {
    const { jobId, estimateId, depositId } = await approvedJob();
    const r = await inTx((tx) =>
      scheduleEstimateLaterTx(tx, estimateId, SYSTEM_ACTOR),
    );
    await inTx((tx) => moveEstimateBackTx(tx, estimateId, SYSTEM_ACTOR));
    expect((await invoiceLinesOf(jobId)).names).toEqual([
      "Rekey six cylinders",
      "Service call",
      "Service call fee credited",
    ]);
    const [follow] = await db.select().from(jobs).where(eq(jobs.id, r.jobId));
    expect(follow?.status).toBe("cancelled");
    const [fInv] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.jobId, r.jobId));
    expect(fInv?.status).toBe("void");
    const [dep] = await db
      .select()
      .from(depositRequests)
      .where(eq(depositRequests.id, depositId));
    expect(dep?.jobId).toBe(jobId);
    // No job.cancelled: the customer never heard of the follow-up.
    const [ev] = await execRows<{ n: number }>(
      sql`select count(*)::int as n from events where type = 'job.cancelled' and entity_id = ${r.jobId}`,
    );
    expect(Number(ev?.n)).toBe(0);
    expect(await workState(estimateId)).toMatchObject({
      mode: "now",
      job: { id: jobId },
      canScheduleLater: true,
    });
  });

  it("a paid deposit locks the choice", async () => {
    const { estimateId, depositId } = await approvedJob();
    await db
      .update(depositRequests)
      .set({ status: "paid" })
      .where(eq(depositRequests.id, depositId));
    const st = await workState(estimateId);
    expect(st).toMatchObject({ canScheduleLater: false, depositPaid: true });
    expect(st?.locked).toContain("deposit is paid");
    await expect(
      inTx((tx) => scheduleEstimateLaterTx(tx, estimateId, SYSTEM_ACTOR)),
    ).rejects.toThrow(/deposit is paid/);
  });

  it("once the follow-up is booked, the work can't move back", async () => {
    const { estimateId } = await approvedJob();
    const r = await inTx((tx) =>
      scheduleEstimateLaterTx(tx, estimateId, SYSTEM_ACTOR),
    );
    await db
      .update(jobs)
      .set({ status: "scheduled" })
      .where(eq(jobs.id, r.jobId));
    expect(await workState(estimateId)).toMatchObject({
      mode: "later",
      canMoveBack: false,
    });
    await expect(
      inTx((tx) => moveEstimateBackTx(tx, estimateId, SYSTEM_ACTOR)),
    ).rejects.toThrow(/stays on it/);
  });
});
