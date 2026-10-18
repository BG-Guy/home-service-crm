// B2 integration tests on a throwaway PGlite: create/assign/status flow through
// action(), clientId replay (offline outbox idempotency), guards on real rows,
// after-arrival cancel review, contact window, confirm idempotency.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-b2-test-"),
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
  approvals,
  customers,
  jobStatusEvents,
  jobs,
  properties,
} from "@/db/schema";
import "@/db/seed/register";
import {
  createJobAction,
  scheduleJob,
  setJobStatus,
} from "@/features/jobs/actions";
import { confirmJob, getContactWindowJob } from "@/features/jobs/api";
import { loadSessionUser } from "@/lib/auth/current";
import { acceptInvite, createInvite, signup } from "@/lib/auth/flows";
import { type SessionUser, SYSTEM_ACTOR } from "@/lib/types";

let admin: SessionUser;
let tech: SessionUser;
let tech2: SessionUser;
let customerId: string;
let propertyId: string;
const PASSWORD = "tangerine-kayak-41";
const tomorrow = () => {
  const d = new Date(Date.now() + 86_400_000);
  return d.toISOString().slice(0, 10);
};

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
    companyName: "B2 Locks",
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
  const [c] = await db
    .insert(customers)
    .values({
      displayName: "Pat Customer",
      firstName: "Pat",
      phone: "+15125550142",
    } as never)
    .returning({ id: customers.id });
  customerId = c?.id as string;
  const [p] = await db
    .insert(properties)
    .values({
      customerId,
      street: "100 Congress Ave",
      city: "Austin",
      state: "TX",
      zip: "78701",
      lat: 30.2639,
      lng: -97.7442,
    } as never)
    .returning({ id: properties.id });
  propertyId = p?.id as string;
}, 120_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

describe("jobs flow", () => {
  let jobId: string;

  it("creates a job once per clientId and schedules it with an assignee", async () => {
    auth.user = admin;
    const clientId = crypto.randomUUID();
    const input = {
      customerId,
      propertyId,
      title: "Rekey front door",
      date: tomorrow(),
      start: "09:00",
      minutes: 120,
      assignees: [
        { userId: tech.id, role: "primary" as const, splitBps: 10000 },
      ],
      clientId,
    };
    const a = await createJobAction(input);
    const b = await createJobAction(input);
    expect(a.ok).toBe(true);
    expect(b).toEqual(a);
    if (!a.ok || !a.data) throw new Error("create failed");
    jobId = a.data.jobId;
    expect(a.data.status).toBe("scheduled");
    expect(a.data.number).toMatch(/^J-\d+/);
    expect((await db.select().from(jobs)).length).toBe(1);
    expect(await evCount("job.created")).toBe(1);
    expect(await evCount("job.scheduled")).toBe(1);
  });

  it("a tech who isn't assigned can't move the job", async () => {
    auth.user = tech2;
    const r = await setJobStatus({ jobId, to: "en_route", etaMinutes: 20 });
    expect(r.ok).toBe(false);
  });

  it("on my way replays by clientId without a second status event", async () => {
    auth.user = tech;
    const clientId = crypto.randomUUID();
    const input = {
      jobId,
      to: "en_route" as const,
      etaMinutes: 20,
      clientId,
      clientTs: new Date().toISOString(),
    };
    const a = await setJobStatus(input);
    const b = await setJobStatus(input);
    expect(a.ok && a.data).toMatchObject({
      status: "done",
      from: "scheduled",
      to: "en_route",
    });
    expect(b).toEqual(a);
    const rows = await db
      .select()
      .from(jobStatusEvents)
      .where(
        and(
          eq(jobStatusEvents.jobId, jobId),
          eq(jobStatusEvents.toStatus, "en_route"),
        ),
      );
    expect(rows.length).toBe(1);
    expect(rows[0]?.etaMinutes).toBe(20);
    expect(await evCount("job.en_route")).toBe(1);
  });

  it("arrival far from the property warns but never blocks", async () => {
    const r = await setJobStatus({
      jobId,
      to: "arrived",
      geo: { lat: 30.4, lng: -97.7, accuracyM: 10 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok || r.data?.status !== "done") throw new Error("arrive failed");
    expect(r.data.warnings.join(" ")).toMatch(/from the property/);
    const [ev] = await db
      .select()
      .from(jobStatusEvents)
      .where(
        and(
          eq(jobStatusEvents.jobId, jobId),
          eq(jobStatusEvents.toStatus, "arrived"),
        ),
      );
    expect(ev?.distanceM).toBeGreaterThan(300);
    expect(ev?.lat).toBeCloseTo(30.4);
  });

  it("start then complete; required checklist blocks until overridden by an admin", async () => {
    expect((await setJobStatus({ jobId, to: "in_progress" })).ok).toBe(true);
    await db
      .update(jobs)
      .set({
        checklist: [
          { id: "test", label: "Test the lock", type: "check", required: true },
        ],
      })
      .where(eq(jobs.id, jobId));
    const blocked = await setJobStatus({ jobId, to: "completed" });
    expect(blocked.ok && blocked.data).toMatchObject({ status: "blocked" });
    const noPerm = await setJobStatus({
      jobId,
      to: "completed",
      overrideReason: "Customer had to leave",
    });
    expect(noPerm.ok).toBe(false);
    auth.user = admin;
    const done = await setJobStatus({
      jobId,
      to: "completed",
      overrideReason: "Customer had to leave",
    });
    expect(done.ok && done.data).toMatchObject({
      status: "done",
      to: "completed",
    });
    const [j] = await db.select().from(jobs).where(eq(jobs.id, jobId));
    expect(j?.status).toBe("completed");
    expect(
      (j?.custom as Record<string, unknown>).complete_override,
    ).toBeTruthy();
    expect(await evCount("job.completed")).toBe(1);
    expect(await evCount("job.status_changed")).toBe(5);
  });

  it("contact window is open for the assigned tech after completion", async () => {
    const w = await getContactWindowJob(tech.id, customerId);
    expect(w?.jobId).toBe(jobId);
    expect(await getContactWindowJob(tech2.id, customerId)).toBeNull();
  });
});

describe("after-arrival cancel and confirmations", () => {
  let jobId: string;
  it("tech cancel after arrival needs note + photo and goes to admin review", async () => {
    auth.user = admin;
    const c = await createJobAction({
      customerId,
      propertyId,
      title: "Lockout",
      date: tomorrow(),
      start: "13:00",
      assignees: [{ userId: tech.id, role: "primary", splitBps: 10000 }],
    });
    if (!c.ok || !c.data) throw new Error("create failed");
    jobId = c.data.jobId;
    auth.user = tech;
    expect((await setJobStatus({ jobId, to: "arrived" })).ok).toBe(true);
    const noPhoto = await setJobStatus({
      jobId,
      to: "cancelled",
      reason: "no_access",
      note: "Gate locked",
    });
    expect(noPhoto.ok).toBe(false);
    const ok = await setJobStatus({
      jobId,
      to: "cancelled",
      reason: "no_access",
      note: "Gate locked",
      photoClientIds: [crypto.randomUUID()],
    });
    expect(ok.ok).toBe(true);
    const [j] = await db.select().from(jobs).where(eq(jobs.id, jobId));
    expect(j?.status).toBe("cancelled");
    expect(j?.cancelReviewStatus).toBe("pending");
    const appr = await db
      .select()
      .from(approvals)
      .where(eq(approvals.entityId, jobId));
    expect(appr.map((a) => a.entityType)).toEqual(["job_cancel"]);
    expect(await evCount("job.cancel_review_requested")).toBe(1);
  });

  it("assign moves an unscheduled job to scheduled; confirm is idempotent", async () => {
    auth.user = admin;
    const c = await createJobAction({
      customerId,
      propertyId,
      title: "Install smart lock",
    });
    if (!c.ok || !c.data) throw new Error("create failed");
    expect(c.data.status).toBe("unscheduled");
    const s = await scheduleJob({
      jobId: c.data.jobId,
      date: tomorrow(),
      start: "10:00",
      minutes: 60,
      assignees: [
        { userId: tech.id, role: "primary", splitBps: 6000 },
        { userId: tech2.id, role: "helper", splitBps: 4000 },
      ],
    });
    expect(s.ok && s.data).toMatchObject({
      status: "scheduled",
      changed: true,
    });
    await db.transaction((tx) =>
      confirmJob(tx, c.data?.jobId as string, "portal", SYSTEM_ACTOR),
    );
    await db.transaction((tx) =>
      confirmJob(tx, c.data?.jobId as string, "portal", SYSTEM_ACTOR),
    );
    const [j] = await db.select().from(jobs).where(eq(jobs.id, c.data.jobId));
    expect(j?.status).toBe("confirmed");
    expect(await evCount("job.confirmed")).toBe(1);
    // Rescheduling a confirmed job sends it back to scheduled (needs reconfirmation).
    const r = await scheduleJob({
      jobId: c.data.jobId,
      date: tomorrow(),
      start: "14:00",
      minutes: 60,
    });
    expect(r.ok && r.data).toMatchObject({ status: "scheduled" });
    expect(await evCount("job.rescheduled")).toBe(1);
  });
});

describe("read DAL (real SQL, row scope)", () => {
  it("lists, details, board, assign options, My Day, tasks, time", async () => {
    const {
      listJobs,
      getJobDetail,
      getStatusEvents,
      listMyDay,
      listCustomerJobs,
    } = await import("@/features/jobs/queries");
    const { loadBoard } = await import("@/features/jobs/schedule-queries");
    const { loadAssignOptions } = await import(
      "@/features/jobs/dispatch-reads"
    );
    const { listTasks } = await import("@/features/tasks/queries");
    const { listTimeEntries } = await import("@/features/time/queries");

    auth.user = admin;
    const all = await listJobs({});
    expect(all.items.length).toBe(3);
    const filtered = await listJobs({
      status: ["cancelled"],
      cancelledAfterArrival: true,
      q: "Lock",
    });
    expect(filtered.items.map((j) => j.title)).toEqual(["Lockout"]);
    const upcoming = await listJobs({
      view: "upcoming",
      unassigned: false,
      unconfirmed: true,
    });
    expect(upcoming.items.every((j) => j.status === "scheduled")).toBe(true);
    const id = all.items.find((j) => j.title === "Rekey front door")
      ?.id as string;
    const d = await getJobDetail(id);
    expect(d?.assignees[0]?.userId).toBe(tech.id);
    expect((await getStatusEvents(id)).map((e) => e.to)[0]).toBe("completed");
    const board = await loadBoard({ view: "week" });
    expect(board.days.length).toBe(7);
    expect(board.techs.map((t) => t.id)).toEqual(
      expect.arrayContaining([tech.id, tech2.id]),
    );
    const day = await loadBoard({ view: "day", date: tomorrow() });
    expect(day.jobs.length).toBeGreaterThan(0);
    // Map layout pins: the property's geocode rides along on every board job.
    expect(day.jobs.every((j) => j.lat === 30.2639 && j.lng === -97.7442)).toBe(
      true,
    );
    // A dispatcher role without customers.contact_view gets no house number, so no pin.
    auth.user = {
      ...admin,
      perms: new Set(
        [...admin.perms].filter((p) => p !== "customers.contact_view"),
      ),
    };
    const maskedDay = await loadBoard({ view: "day", date: tomorrow() });
    expect(maskedDay.jobs.length).toBe(day.jobs.length);
    expect(
      maskedDay.jobs.every(
        (j) => j.addressMasked && j.lat === null && j.lng === null,
      ),
    ).toBe(true);
    auth.user = admin;
    const opts = await loadAssignOptions({ jobId: id });
    expect(opts.ok && opts.data?.techs.length).toBeGreaterThan(1);
    const cj = await listCustomerJobs(customerId, admin, 5);
    expect(cj.upcoming.length + cj.past.length).toBe(3);

    // Techs only see their own jobs.
    auth.user = tech2;
    const mine = await listJobs({});
    expect(
      mine.items.every((j) => j.assignees.some((a) => a.userId === tech2.id)),
    ).toBe(true);
    expect(await getJobDetail(id)).toBeNull();
    const myDay = await listMyDay(tech2, tomorrow());
    expect(myDay.today.length).toBe(1);
    // Outside the contact window a tech's route card gets no pin (like no house number).
    expect(myDay.today[0]).toMatchObject({
      addressMasked: true,
      lat: null,
      lng: null,
    });

    auth.user = tech;
    // Inside it (the job finished minutes ago) the pin comes with the address.
    const own = await listJobs({});
    expect(own.items.find((j) => j.title === "Rekey front door")).toMatchObject(
      { addressMasked: false, lat: 30.2639, lng: -97.7442 },
    );
    expect(await listTasks({ scope: "all" })).toEqual([]);
    const te = await listTimeEntries(
      tech.id,
      new Date(0),
      new Date(Date.now() + 86_400_000),
      tech,
    );
    expect(te).toEqual([]);
    await expect(
      listTimeEntries(tech2.id, new Date(0), new Date(), tech),
    ).rejects.toThrow();
  });
});

describe("time clock and tasks", () => {
  it("clocks in once per clientId, logs a break, clocks out; emits clock events", async () => {
    const { clockIn, clockOut, logBreak } = await import(
      "@/features/time/actions"
    );
    const { getClockStatuses, getHoursWorked } = await import(
      "@/features/time/api"
    );
    auth.user = tech;
    const clientId = crypto.randomUUID();
    const a = await clockIn({
      geo: { lat: 30.26, lng: -97.74 },
      clientId,
      clientTs: new Date().toISOString(),
    });
    const b = await clockIn({
      geo: { lat: 30.26, lng: -97.74 },
      clientId,
      clientTs: new Date().toISOString(),
    });
    expect(a.ok).toBe(true);
    expect(b).toEqual(a);
    expect((await getClockStatuses([tech.id]))[tech.id]?.clockedIn).toBe(true);
    expect((await logBreak({ minutes: 15 })).ok).toBe(true);
    expect((await clockOut({ geo: null })).ok).toBe(true);
    expect((await clockOut({ geo: null })).ok).toBe(false);
    expect((await getClockStatuses([tech.id]))[tech.id]?.clockedIn).toBe(false);
    const h = await getHoursWorked(
      tech.id,
      new Date(Date.now() - 3600_000),
      new Date(Date.now() + 60_000),
    );
    expect(h.entries.length).toBe(1);
    expect(await evCount("time.clocked_in")).toBe(1);
    expect(await evCount("time.clocked_out")).toBe(1);
  });

  it("creates, finishes and reopens a task; office queue needs tasks.view_all", async () => {
    const { createTaskAction, setTaskStatus } = await import(
      "@/features/tasks/actions"
    );
    const { listTasks } = await import("@/features/tasks/queries");
    auth.user = tech;
    const forbidden = await createTaskAction({
      title: "Queue it",
      assigneeUserId: null,
    });
    expect(forbidden.ok).toBe(false);
    const t = await createTaskAction({
      title: "Restock pins",
      dueDate: tomorrow(),
    });
    expect(t.ok).toBe(true);
    const open = await listTasks({ scope: "mine" });
    expect(open.map((x) => x.title)).toContain("Restock pins");
    const id = open.find((x) => x.title === "Restock pins")?.id as string;
    expect((await setTaskStatus({ taskId: id, status: "done" })).ok).toBe(true);
    expect(
      (await listTasks({ scope: "mine", status: "closed" })).map((x) => x.id),
    ).toContain(id);
    expect((await setTaskStatus({ taskId: id, status: "open" })).ok).toBe(true);
    auth.user = tech2;
    expect((await setTaskStatus({ taskId: id, status: "done" })).ok).toBe(
      false,
    );
  });
});
