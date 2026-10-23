// Needs a tech (leads flow item 9, build SPEC 3.6) on a throwaway PGlite: the
// count behind the Assign badge, the hub queue (every day from today, soonest
// first, the same count in its header) and hubHrefForJob opening the hub on a
// booked job's own day.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-needs-tech-"),
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
  const check = async (perm?: string) => {
    if (!auth.user) throw new Error("NEXT_REDIRECT /login");
    if (perm && !auth.user.perms.has(perm as never)) {
      const { ForbiddenError } = await import("@/lib/errors");
      throw new ForbiddenError(undefined, perm);
    }
    return auth.user;
  };
  return {
    ...actual,
    getCurrentUser: async () => auth.user,
    requireUser: (perm?: string) => check(perm),
  };
});

import { eq, inArray } from "drizzle-orm";
import { closeDb, db, ensureDb } from "@/db";
import {
  customers,
  jobAssignments,
  jobs,
  properties,
  timeOff,
  users,
} from "@/db/schema";
import "@/db/seed/register";
import { badges } from "@/features/jobs/badges";
import { hubHrefForJob } from "@/features/jobs/dispatch/href";
import { countNeedsTech } from "@/features/jobs/dispatch/needs-tech";
import { loadDispatchHub } from "@/features/jobs/dispatch/queries";
import { NEEDS_TECH_BADGE } from "@/features/jobs/nav";
import { loadSessionUser } from "@/lib/auth/current";
import { acceptInvite, createInvite, signup } from "@/lib/auth/flows";
import {
  addDaysToKey,
  dateKey,
  parseDateKey,
  zonedTimeToUtc,
} from "@/lib/time";
import { type SessionUser, SYSTEM_ACTOR } from "@/lib/types";

const TZ = "America/Chicago";
const PASSWORD = "tangerine-kayak-41";
let admin: SessionUser;
let tech: SessionUser;
let tech2: SessionUser;
let customerId: string;
let propertyId: string;
const ids: Record<string, string> = {};

const today = () => dateKey(new Date(), TZ);
/** A local wall-clock time `days` from today in the company zone. */
const at = (days: number, hour: number) =>
  zonedTimeToUtc({ ...parseDateKey(addDaysToKey(today(), days)), hour }, TZ);

async function addJob(
  number: string,
  opts: {
    days?: number;
    hour?: number;
    hours?: number;
    status?: string;
    windowless?: boolean;
    undated?: boolean;
    assign?: "primary" | "helper";
  } = {},
) {
  const start = opts.undated ? null : at(opts.days ?? 1, opts.hour ?? 8);
  const end = start
    ? new Date(start.getTime() + (opts.hours ?? 2) * 3_600_000)
    : null;
  const [row] = await db
    .insert(jobs)
    .values({
      number,
      customerId,
      propertyId,
      title: `Rekey ${number}`,
      status: opts.status ?? "unscheduled",
      scheduledStart: start,
      scheduledEnd: end,
      windowStart: opts.windowless ? null : start,
      windowEnd: opts.windowless ? null : end,
    } as never)
    .returning({ id: jobs.id });
  const id = row?.id as string;
  ids[number] = id;
  if (opts.assign)
    await db
      .insert(jobAssignments)
      .values({ jobId: id, userId: tech.id, role: opts.assign } as never);
  return id;
}

beforeAll(async () => {
  await ensureDb();
  const res = await signup({
    companyName: "Needs Tech Locks",
    name: "Ada Admin",
    email: "ada@example.com",
    password: PASSWORD,
    timezone: TZ,
    state: "tx",
  });
  admin = (await loadSessionUser(
    res.userId,
    res.session?.sessionId as string,
  )) as SessionUser;
  const invite = async (name: string, email: string) => {
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
  };
  tech = await invite("Tom Tech", "tom@example.com");
  tech2 = await invite("Tina Tech", "tina@example.com");
  const [c] = await db
    .insert(customers)
    .values({ displayName: "Noah Smith", phone: "+15125550142" } as never)
    .returning({ id: customers.id });
  customerId = c?.id as string;
  const [p] = await db
    .insert(properties)
    .values({
      customerId,
      street: "4417 Duval St",
      city: "Austin",
      state: "TX",
      zip: "78751",
      lat: 30.3077,
      lng: -97.7275,
    } as never)
    .returning({ id: properties.id });
  propertyId = p?.id as string;

  // Inserted out of order on purpose: the queue sorts soonest first.
  await addJob("J-T04", { days: 5, hour: 10 }); // in five days
  await addJob("J-T12", { days: 4, hour: 9, windowless: true }); // exact time only
  await addJob("J-T03", { days: 1, hour: 13 }); // tomorrow 1–3 PM
  await addJob("J-T01", { days: 0, hour: 0, hours: 1 }); // today, even if passed
  await addJob("J-T02", { days: 1, hour: 8 }); // tomorrow 8–10 AM
  // Never counted:
  await addJob("J-T05", { days: -1, hour: 10 }); // yesterday
  await addJob("J-T06", { days: 2, assign: "primary" }); // has a tech
  await addJob("J-T07", { days: 2, assign: "helper" }); // a helper is a tech too
  await addJob("J-T08", { days: 3, status: "cancelled" });
  await addJob("J-T09", { days: 3, status: "closed" });
  await addJob("J-T10", { days: 3, status: "completed" });
  await addJob("J-T11", { undated: true }); // not booked yet
}, 120_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

const NEEDS = ["J-T01", "J-T02", "J-T03", "J-T12", "J-T04"];

describe("needs a tech: the count", () => {
  it("counts booked jobs from today on with nobody assigned", async () => {
    expect(await countNeedsTech()).toBe(NEEDS.length);
  });

  it("drops a job once a tech is on it", async () => {
    await db
      .insert(jobAssignments)
      .values({ jobId: ids["J-T03"], userId: tech.id } as never);
    expect(await countNeedsTech()).toBe(NEEDS.length - 1);
    await db
      .delete(jobAssignments)
      .where(eq(jobAssignments.jobId, ids["J-T03"] as string));
    expect(await countNeedsTech()).toBe(NEEDS.length);
  });

  it("is the Assign badge, for people who assign", async () => {
    const counter = badges[NEEDS_TECH_BADGE];
    expect(counter).toBeTypeOf("function");
    expect(await counter?.(admin)).toBe(NEEDS.length);
    expect(tech.perms.has("jobs.assign")).toBe(false);
    expect(await counter?.(tech)).toBe(0);
  });
});

describe("needs a tech: the hub queue", () => {
  it("lists every such job across days, soonest first, with the badge's count", async () => {
    auth.user = admin;
    const hub = await loadDispatchHub({});
    expect(hub.needsTech.map((j) => j.number)).toEqual(NEEDS);
    expect(hub.needsTechCount).toBe(NEEDS.length);
    expect(hub.needsTechCount).toBe(await countNeedsTech());
    // Each row has its day and window, service and street.
    const first = hub.needsTech[0];
    expect(first?.dayKey).toBe(today());
    expect(first?.start).toBe(at(0, 0).toISOString());
    expect(first?.end).toBe(at(0, 1).toISOString());
    expect(first?.street).toBe("4417 Duval St");
    expect(hub.needsTech[1]?.dayKey).toBe(addDaysToKey(today(), 1));
    // Undated jobs stay in the hub, apart and uncounted.
    expect(hub.undated.map((j) => j.number)).toEqual(["J-T11"]);
  });

  it("opens on a booked job's own day from hubHrefForJob", async () => {
    auth.user = admin;
    const id = ids["J-T04"] as string;
    const day = addDaysToKey(today(), 5);
    const href = hubHrefForJob(id, day);
    expect(href).toBe(`/dispatch?date=${day}&job=${id}`);
    const q = new URL(href, "http://x").searchParams;

    const hub = await loadDispatchHub({
      date: q.get("date") ?? undefined,
      job: q.get("job") ?? undefined,
    });
    expect(hub.job?.id).toBe(id);
    expect(hub.date).toBe(day);
    expect(hub.movedToJobDay).toBe(false);
    expect(hub.job?.assigneeIds).toEqual([]);
    // Every tech is ranked for it (the office still picks: no auto-assign).
    expect(hub.recs.map((r) => r.techId)).toContain(tech.id);

    // Without a date, or with the wrong one, it still lands on the job's day.
    const bare = await loadDispatchHub({ job: id });
    expect(bare.date).toBe(day);
    expect(bare.movedToJobDay).toBe(false);
    const wrong = await loadDispatchHub({ date: today(), job: id });
    expect(wrong.date).toBe(day);
    expect(wrong.movedToJobDay).toBe(true);
  });

  it("ranks a tech who is on time off in the window last, with why", async () => {
    auth.user = admin;
    // Both work every day 8–5 (so the weekday doesn't matter).
    const everyDay = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
      day,
      start: "08:00",
      end: "17:00",
    }));
    await db
      .update(users)
      .set({ workHours: everyDay } as never)
      .where(inArray(users.id, [tech.id, tech2.id]));
    // Tom is out 9 AM – 1 PM on J-T04's day; its window is 10–12.
    await db.insert(timeOff).values({
      userId: tech.id,
      startsAt: at(5, 9),
      endsAt: at(5, 13),
      note: "Dentist",
    } as never);
    const hub = await loadDispatchHub({ job: ids["J-T04"] });
    expect(hub.recs.map((r) => r.techId)).toEqual([tech2.id, tech.id]);
    const tom = hub.recs.find((r) => r.techId === tech.id);
    expect(tom?.rank).toBe(2);
    expect(tom?.fits).toBe(false);
    expect(tom?.reasons[0]).toBe("Time off");
    expect(hub.recs[0]?.reasons).not.toContain("Time off");
  });
});
