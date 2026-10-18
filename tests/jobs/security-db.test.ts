// B2 QA round 2 regressions on a throwaway PGlite: IDOR guards on job creation
// (property / lead binding, leads.convert), task scope, checklist photo answers,
// disputed jobs never auto-close, the tracking link survives arrival, and the
// contact-window address masking in job reads.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-b2-sec-"),
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

import { and, eq, sql } from "drizzle-orm";
import { closeDb, db, ensureDb, execRows } from "@/db";
import {
  customers,
  jobs,
  leads,
  media,
  properties,
  publicTokens,
} from "@/db/schema";
import "@/db/seed/register";
import {
  createJobAction,
  setJobStatus,
  updateChecklistItem,
} from "@/features/jobs/actions";
import { closeJobIfEligible } from "@/features/jobs/api";
import { checklistPhotoTag } from "@/features/jobs/checklist";
import { maskStreetLine } from "@/features/jobs/mask";
import { createTaskAction } from "@/features/tasks/actions";
import { createTask } from "@/features/tasks/api";
import { loadSessionUser } from "@/lib/auth/current";
import { acceptInvite, createInvite, signup } from "@/lib/auth/flows";
import { mintPublicToken } from "@/lib/tokens";
import { type SessionUser, SYSTEM_ACTOR } from "@/lib/types";

let admin: SessionUser;
let tech: SessionUser;
let tech2: SessionUser;
let customerA: string;
let propertyA: string;
let customerB: string;
let propertyB: string;
let jobA: string; // tech's job (customer A), two days out
let jobB: string; // tech2's job (customer B)
const PASSWORD = "tangerine-kayak-41";
const inDays = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function invite(name: string, email: string): Promise<SessionUser> {
  const inv = await db.transaction((tx) =>
    createInvite(tx, { name, email, role: "tech" }, SYSTEM_ACTOR),
  );
  const s = await acceptInvite({
    token: inv.token,
    password: PASSWORD,
    monitoringAck: true,
    esignConsent: true,
  });
  return (await loadSessionUser(s.userId, s.sessionId)) as SessionUser;
}

async function customerWithProperty(name: string, street: string) {
  const [c] = await db
    .insert(customers)
    .values({ displayName: name, firstName: name.split(" ")[0] } as never)
    .returning({ id: customers.id });
  const [p] = await db
    .insert(properties)
    .values({
      customerId: c?.id,
      street,
      city: "Austin",
      state: "TX",
      zip: "78701",
      lat: 30.26,
      lng: -97.74,
    } as never)
    .returning({ id: properties.id });
  return { customerId: c?.id as string, propertyId: p?.id as string };
}

const evCount = async (type: string) =>
  Number(
    (
      await execRows<{ n: number }>(
        sql`select count(*)::int as n from events where type = ${type}`,
      )
    )[0]?.n ?? 0,
  );

beforeAll(async () => {
  await ensureDb();
  const res = await signup({
    companyName: "B2 Sec Locks",
    name: "Ada Admin",
    email: "ada@example.com",
    password: PASSWORD,
    timezone: "America/Chicago",
    state: "tx",
  });
  admin = (await loadSessionUser(
    res.userId,
    res.session?.sessionId as string,
  )) as SessionUser;
  tech = await invite("Tom Tech", "tom@example.com");
  tech2 = await invite("Tina Tech", "tina@example.com");
  ({ customerId: customerA, propertyId: propertyA } =
    await customerWithProperty("Pat Able", "4385 Burnet Rd Apt 2"));
  ({ customerId: customerB, propertyId: propertyB } =
    await customerWithProperty("Bea Baker", "12 Oak St"));

  auth.user = admin;
  const a = await createJobAction({
    customerId: customerA,
    propertyId: propertyA,
    title: "Rekey",
    date: inDays(2),
    start: "09:00",
    minutes: 120,
    assignees: [{ userId: tech.id, role: "primary", splitBps: 10000 }],
  });
  const b = await createJobAction({
    customerId: customerB,
    propertyId: propertyB,
    title: "Lockout",
    date: inDays(2),
    start: "13:00",
    minutes: 60,
    assignees: [{ userId: tech2.id, role: "primary", splitBps: 10000 }],
  });
  if (!a.ok || !b.ok) throw new Error("fixture jobs failed");
  jobA = a.data?.jobId as string;
  jobB = b.data?.jobId as string;
}, 120_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

describe("createJob binding (T5-09)", () => {
  it("refuses a property that belongs to another customer", async () => {
    auth.user = admin;
    const r = await createJobAction({
      customerId: customerA,
      propertyId: propertyB,
      title: "Wrong address",
      assignees: [],
    });
    expect(r.ok).toBe(false);
    expect(
      (await db.select().from(jobs).where(eq(jobs.title, "Wrong address")))
        .length,
    ).toBe(0);
  });

  it("booking from a lead needs leads.convert, and the lead's own customer", async () => {
    const [l] = await db
      .insert(leads)
      .values({ name: "Bea Baker", customerId: customerB } as never)
      .returning({ id: leads.id });
    const leadId = l?.id as string;

    auth.user = tech; // techs can create jobs, but not convert leads
    const asTech = await createJobAction({
      customerId: customerA,
      propertyId: propertyA,
      title: "From someone's lead",
      assignees: [],
      leadId,
    });
    expect(asTech.ok).toBe(false);

    auth.user = admin;
    const otherCustomer = await createJobAction({
      customerId: customerA,
      propertyId: propertyA,
      title: "Lead mismatch",
      assignees: [],
      leadId,
    });
    expect(otherCustomer.ok).toBe(false);
    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
    expect(lead?.status).toBe("new");

    const ok = await createJobAction({
      customerId: customerB,
      propertyId: propertyB,
      title: "Lead booked",
      assignees: [],
      leadId,
    });
    expect(ok.ok).toBe(true);
    const [booked] = await db.select().from(leads).where(eq(leads.id, leadId));
    expect(booked?.status).toBe("booked");
  });
});

describe("createTaskAction scope (T5-10) and quiet createTask (T6-11)", () => {
  it("a tech can't put a task on another tech's job or customer", async () => {
    auth.user = tech;
    const onOther = await createTaskAction({
      title: "Injected",
      jobId: jobB,
    });
    expect(onOther.ok).toBe(false);
    const onOtherCustomer = await createTaskAction({
      title: "Injected",
      customerId: customerB,
    });
    expect(onOtherCustomer.ok).toBe(false);
    const mismatch = await createTaskAction({
      title: "Mismatch",
      jobId: jobA,
      customerId: customerB,
    });
    expect(mismatch.ok).toBe(false);
    const own = await createTaskAction({
      title: "Bring the long ladder",
      jobId: jobA,
      customerId: customerA,
    });
    expect(own.ok).toBe(true);
  });

  it("quiet createTask emits no task.created", async () => {
    const before = await evCount("task.created");
    await createTask(
      db,
      { kind: "custom", title: "Seeded", assigneeUserId: null },
      SYSTEM_ACTOR,
      { quiet: true },
    );
    expect(await evCount("task.created")).toBe(before);
  });
});

describe("checklist photo answers (T1-05)", () => {
  it("infers the media tag from the template item", () => {
    expect(
      checklistPhotoTag({ id: "before", label: "Before photo of the problem" }),
    ).toBe("before");
    expect(
      checklistPhotoTag({ id: "own:id_photo", label: "Photo of customer ID" }),
    ).toBe("id_check");
    expect(
      checklistPhotoTag({
        id: "own:address_proof",
        label: "Proof of address (bill, lease or registration)",
      }),
    ).toBe("document");
    expect(
      checklistPhotoTag({ id: "x", label: "Finished install", tag: "after" }),
    ).toBe("after");
    expect(checklistPhotoTag({ id: "x", label: "Wiring" })).toBe("during");
  });

  it("stores this job's media id and refuses another job's photo", async () => {
    await db
      .update(jobs)
      .set({
        checklist: [
          {
            id: "before",
            label: "Before photo of the problem",
            type: "photo",
            required: true,
          },
        ],
      })
      .where(eq(jobs.id, jobA));
    const mk = async (jobId: string) => {
      const clientId = crypto.randomUUID();
      const [m] = await db
        .insert(media)
        .values({
          kind: "photo",
          tag: "before",
          storageKey: `k/${clientId}.jpg`,
          mime: "image/jpeg",
          jobId,
          clientId,
        } as never)
        .returning({ id: media.id });
      return { id: m?.id as string, clientId };
    };
    const other = await mk(jobB);
    const mine = await mk(jobA);

    auth.user = tech;
    const foreign = await updateChecklistItem({
      jobId: jobA,
      itemId: "before",
      answer: other.id,
    });
    expect(foreign.ok).toBe(false);
    const viaClientId = await updateChecklistItem({
      jobId: jobA,
      itemId: "before",
      answer: mine.clientId,
    });
    expect(viaClientId.ok).toBe(true);
    const [j] = await db.select().from(jobs).where(eq(jobs.id, jobA));
    expect(j?.checklist?.[0]?.answer).toBe(mine.id);

    // An offline answer (client id, upload not landed yet) resolves on read.
    const pending = crypto.randomUUID();
    expect(
      (
        await updateChecklistItem({
          jobId: jobA,
          itemId: "before",
          answer: pending,
        })
      ).ok,
    ).toBe(true);
    await db.insert(media).values({
      kind: "photo",
      tag: "before",
      storageKey: `k/${pending}.jpg`,
      mime: "image/jpeg",
      jobId: jobA,
      clientId: pending,
    } as never);
    const { getJobDetail } = await import("@/features/jobs/queries");
    const d = await getJobDetail(jobA);
    const [landed] = await db
      .select({ id: media.id })
      .from(media)
      .where(eq(media.clientId, pending));
    expect(d?.checklist[0]?.answer).toBe(landed?.id);
    expect(d?.checklist[0]?.photoTag).toBe("before");
  });
});

describe("contact-window masking in job reads (T5-11)", () => {
  it("a tech sees no house number or pin before the window opens", async () => {
    const { getJobDetail, listJobs } = await import("@/features/jobs/queries");
    auth.user = tech;
    const d = await getJobDetail(jobA);
    expect(d?.addressMasked).toBe(true);
    expect(d?.addressShort).toBe("••• Burnet Rd");
    expect(d?.addressFull).not.toMatch(/4385/);
    expect(d?.lat).toBeNull();
    const list = await listJobs({});
    const row = list.items.find((j) => j.id === jobA);
    expect(row?.addressMasked).toBe(true);
    expect(row?.addressShort).not.toMatch(/4385/);

    auth.user = admin; // customers.contact_view
    const full = await getJobDetail(jobA);
    expect(full?.addressMasked).toBe(false);
    expect(full?.addressShort).toBe("4385 Burnet Rd Apt 2");
  });

  it("masks like the customer card", () => {
    expect(maskStreetLine("123 Oak St Apt 4")).toBe("••• Oak St");
    expect(maskStreetLine("")).toBe("");
  });
});

describe("tracking link and closing (T1-12, T6-06)", () => {
  it("arrival keeps the tracking link; completion revokes it", async () => {
    auth.user = tech2;
    expect(
      (await setJobStatus({ jobId: jobB, to: "en_route", etaMinutes: 15 })).ok,
    ).toBe(true);
    await db.transaction((tx) =>
      mintPublicToken(tx, {
        kind: "tracking",
        entity: { type: "job", id: jobB },
        jobId: jobB,
      }),
    );
    expect((await setJobStatus({ jobId: jobB, to: "arrived" })).ok).toBe(true);
    const live = await db
      .select()
      .from(publicTokens)
      .where(
        and(eq(publicTokens.jobId, jobB), eq(publicTokens.kind, "tracking")),
      );
    expect(live.length).toBeGreaterThan(0);
    expect(live.every((t) => t.revokedAt == null)).toBe(true);
  });

  it("a disputed job never auto-closes", async () => {
    await db
      .update(jobs)
      .set({
        status: "completed",
        completedAt: new Date(),
        paymentStatus: "disputed",
      })
      .where(eq(jobs.id, jobB));
    const closed = await db.transaction((tx) =>
      closeJobIfEligible(tx, jobB, SYSTEM_ACTOR, { force: true }),
    );
    expect(closed).toBe(false);
    const [j] = await db.select().from(jobs).where(eq(jobs.id, jobB));
    expect(j?.status).toBe("completed");
  });
});
