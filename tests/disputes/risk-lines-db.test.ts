// QA2 re-check (J-1071): a second part raised the job to Medium 30 ("No signed
// estimate for a $322.58 job", "Signed estimate required (risk)"), and removing the
// line left it Medium 30. Risk now recomputes on every draft-invoice line change
// (invoice.lines_changed), up and down. The completion controls never drop below
// the band the work started under. Throwaway PGlite (TEST_PGLITE_ROOT).
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-risk-lines-"),
);
process.env.PGLITE_DIR = path.join(root, "pglite");
process.env.UPLOADS_DIR = path.join(root, "uploads");
process.env.CRM_DISABLE_BACKGROUND = "1";
process.env.CRON_PIGGYBACK = "0";
process.env.AI_PROVIDER = "none";

const auth = vi.hoisted(() => ({
  user: null as null | import("@/lib/types").SessionUser,
}));
vi.mock("@/lib/auth/current", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/current")>();
  const check = async (perm?: string | string[], any = false) => {
    if (!auth.user) throw new Error("NEXT_REDIRECT /login");
    const list = perm ? (Array.isArray(perm) ? perm : [perm]) : [];
    const ok = any
      ? list.some((p) => auth.user?.perms.has(p as never))
      : list.every((p) => auth.user?.perms.has(p as never));
    if (list.length && !ok) {
      const { ForbiddenError } = await import("@/lib/errors");
      throw new ForbiddenError(undefined, list[0]);
    }
    return auth.user;
  };
  return {
    ...actual,
    getCurrentUser: async () => auth.user,
    requireUser: (perm?: string | string[]) => check(perm),
    requireAnyPerm: (perms: string[]) => check(perms, true),
  };
});

import { desc, eq, sql } from "drizzle-orm";
import { closeDb, db, ensureDb, execRows } from "@/db";
import { customers, jobs, properties, riskAssessments } from "@/db/schema";
import "@/db/seed/register";
import { evaluateTransitionControls } from "@/features/disputes/api";
import { handlers as disputeHandlers } from "@/features/disputes/events";
import { addJobLine, removeJobLine } from "@/features/invoices/api";
import { createJobAction } from "@/features/jobs/actions";
import { loadSessionUser } from "@/lib/auth/current";
import { signup } from "@/lib/auth/flows";
import type { Actor, SessionUser } from "@/lib/types";

const PASSWORD = "tangerine-kayak-41";
let admin: SessionUser;
let actor: Actor;
let customerId = "";
let propertyId = "";

beforeAll(async () => {
  await ensureDb();
  const s = await signup({
    companyName: "Risk Lines HVAC",
    name: "Ada Admin",
    email: "ada@example.com",
    password: PASSWORD,
    timezone: "America/Chicago",
    state: "tx",
  });
  admin = (await loadSessionUser(
    s.userId,
    s.session?.sessionId as string,
  )) as SessionUser;
  auth.user = admin;
  actor = { kind: "user", userId: admin.id };
  const [c] = await db
    .insert(customers)
    .values({
      displayName: "Riley Risk",
      firstName: "Riley",
      phone: "+17375553199",
    } as never)
    .returning({ id: customers.id });
  customerId = c?.id as string;
  const [p] = await db
    .insert(properties)
    .values({
      customerId,
      street: "500 Congress Ave",
      city: "Austin",
      state: "TX",
      zip: "78701",
    })
    .returning({ id: properties.id });
  propertyId = p?.id as string;
}, 120_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

const handler = () => {
  const h = disputeHandlers.find(
    (x) => x.name === "disputes.risk_lines_changed",
  );
  if (!h) throw new Error("no disputes.risk_lines_changed handler");
  expect(h.event).toBe("invoice.lines_changed");
  return h;
};

/** Run the risk handler for the job's latest invoice.lines_changed event. */
async function runLinesChanged(jobId: string) {
  const [ev] = await execRows<{ id: number; payload: Record<string, unknown> }>(
    sql`select id, payload from events where type = 'invoice.lines_changed' and payload->>'job_id' = ${jobId} order by id desc limit 1`,
  );
  if (!ev) throw new Error("no invoice.lines_changed event");
  await db.transaction((tx) =>
    handler().run(
      {
        id: ev.id,
        type: "invoice.lines_changed",
        entity: { type: "invoice", id: ev.payload.invoice_id },
        payload: ev.payload,
        actorUserId: admin.id,
        createdAt: new Date(),
      } as never,
      { tx, now: new Date() } as never,
    ),
  );
}

const part = (name: string) => ({
  type: "part" as const,
  name,
  qty: 1,
  unitPriceCents: 16129,
  taxable: false,
});

async function newJob(): Promise<string> {
  const r = await createJobAction({
    customerId,
    propertyId,
    title: "Thermostat swap",
  } as never);
  if (!r.ok) throw new Error(r.error);
  return (r.data as { jobId: string }).jobId;
}

const jobRisk = async (jobId: string) => {
  const [j] = await db
    .select({ band: jobs.riskBand, score: jobs.riskScore })
    .from(jobs)
    .where(eq(jobs.id, jobId));
  const [a] = await db
    .select({ signals: riskAssessments.signals })
    .from(riskAssessments)
    .where(eq(riskAssessments.jobId, jobId))
    .orderBy(desc(riskAssessments.computedAt))
    .limit(1);
  return {
    band: j?.band ?? null,
    score: j?.score ?? 0,
    keys: (a?.signals ?? []).map((s) => s.key),
  };
};

describe("risk follows draft-invoice line changes", () => {
  it("a second part raises it to Medium; removing it brings it back down", async () => {
    const jobId = await newJob();
    await db.transaction((tx) =>
      addJobLine(tx, jobId, part("Thermostat"), actor),
    );
    await runLinesChanged(jobId);
    const one = await jobRisk(jobId);
    expect(one.keys).not.toContain("no_signed_estimate");
    expect(one.band).toBe("low");

    const second = await db.transaction((tx) =>
      addJobLine(tx, jobId, part("Thermostat 2"), actor),
    );
    await runLinesChanged(jobId);
    const two = await jobRisk(jobId);
    expect(two.keys).toContain("no_signed_estimate"); // $322.58 ≥ $250
    expect(two.band).toBe("medium");
    expect(two.score).toBeGreaterThanOrEqual(30);

    await db.transaction((tx) => removeJobLine(tx, second.lineItemId, actor));
    await runLinesChanged(jobId);
    const back = await jobRisk(jobId);
    expect(back.keys).not.toContain("no_signed_estimate");
    expect(back.band).toBe("low");
    expect(back.score).toBe(one.score);
  });
});

describe("completion controls after the band drops", () => {
  /** In progress since `startedAt`, with the start transition's assessment. */
  async function startedAt(jobId: string, band: "low" | "medium") {
    const at = new Date(Date.now() - 30 * 60_000);
    await db
      .update(jobs)
      .set({ status: "in_progress", startedAt: at, updatedAt: new Date() })
      .where(eq(jobs.id, jobId));
    await db.insert(riskAssessments).values({
      jobId,
      score: band === "medium" ? 30 : 0,
      band,
      signals: [],
      trigger: "manual",
      computedAt: at,
    });
  }
  const signedEstimateMissing = async (jobId: string) =>
    (await evaluateTransitionControls(jobId, "completed")).missing.some(
      (m) => m.key === "signed_estimate",
    );

  it("J-1071 shape: started Low, a line made it Medium, removed again: the requirement drops", async () => {
    const jobId = await newJob();
    await db.transaction((tx) =>
      addJobLine(tx, jobId, part("Thermostat"), actor),
    );
    await runLinesChanged(jobId);
    await startedAt(jobId, "low");
    const second = await db.transaction((tx) =>
      addJobLine(tx, jobId, part("Thermostat 2"), actor),
    );
    await runLinesChanged(jobId);
    expect((await jobRisk(jobId)).band).toBe("medium");
    expect(await signedEstimateMissing(jobId)).toBe(true);
    await db.transaction((tx) => removeJobLine(tx, second.lineItemId, actor));
    await runLinesChanged(jobId);
    expect((await jobRisk(jobId)).band).toBe("low");
    expect(await signedEstimateMissing(jobId)).toBe(false);
  });

  it("work that started under Medium keeps its requirement after a line is removed", async () => {
    const jobId = await newJob();
    await db.transaction((tx) =>
      addJobLine(tx, jobId, part("Thermostat"), actor),
    );
    const second = await db.transaction((tx) =>
      addJobLine(tx, jobId, part("Thermostat 2"), actor),
    );
    await runLinesChanged(jobId);
    expect((await jobRisk(jobId)).band).toBe("medium");
    await startedAt(jobId, "medium");
    await db.transaction((tx) => removeJobLine(tx, second.lineItemId, actor));
    await runLinesChanged(jobId);
    expect((await jobRisk(jobId)).band).toBe("low"); // the risk itself is honest
    expect(await signedEstimateMissing(jobId)).toBe(true); // the start's controls stay
  });
});
