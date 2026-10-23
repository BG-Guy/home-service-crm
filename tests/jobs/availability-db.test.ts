// Booking availability loader (src/features/jobs/availability/index.ts) on a
// throwaway PGlite: techs' working hours, time off across midnight, booked jobs with
// their assignees and lengths, a booked job nobody is on yet, the daily cap, the
// service ZIPs, a typed address and a property without coordinates, weekends, the
// job type's length, one day vs the range, and the read action's permission.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-avail-test-"),
);
process.env.PGLITE_DIR = path.join(root, "pglite");
process.env.UPLOADS_DIR = path.join(root, "uploads");
process.env.CRM_DISABLE_BACKGROUND = "1";
process.env.CRON_PIGGYBACK = "0";
process.env.AI_PROVIDER = "none";
process.env.GEOCODER = "none";

const auth = vi.hoisted(() => ({
  user: null as null | import("@/lib/types").SessionUser,
}));
vi.mock("@/lib/auth/current", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/current")>();
  const check = async (perm?: string | string[]) => {
    if (!auth.user) throw new Error("NEXT_REDIRECT /login");
    const list = perm ? (Array.isArray(perm) ? perm : [perm]) : [];
    if (!list.every((p) => auth.user?.perms.has(p as never))) {
      const { ForbiddenError } = await import("@/lib/errors");
      throw new ForbiddenError(undefined, list[0]);
    }
    return auth.user;
  };
  return {
    ...actual,
    getCurrentUser: async () => auth.user,
    requireUser: (perm?: string | string[]) => check(perm),
  };
});

import { eq } from "drizzle-orm";
import { closeDb, db, ensureDb } from "@/db";
import {
  customers,
  properties,
  serviceTypes,
  timeOff,
  users,
} from "@/db/schema";
import "@/db/seed/register";
import { createJobAction } from "@/features/jobs/actions";
import {
  getAvailability,
  getDayAvailability,
  getTechWorkDays,
} from "@/features/jobs/availability";
import { fetchDayWindows } from "@/features/jobs/availability/actions";
import type {
  DayAvailability,
  WindowSlot,
} from "@/features/jobs/availability/types";
import { arrivalFit } from "@/features/jobs/dispatch/recommend";
import { loadSessionUser } from "@/lib/auth/current";
import { acceptInvite, createInvite, signup } from "@/lib/auth/flows";
import { updateSettings } from "@/lib/settings";
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
let tom: SessionUser;
let tina: SessionUser;
const ids: Record<string, string> = {};

/** First Tue–Thu at least two days out, and the Saturday after it. */
const today = dateKey(new Date(), TZ);
let D = addDaysToKey(today, 2);
const weekday = (k: string) => new Date(`${k}T12:00:00Z`).getUTCDay();
while (![2, 3, 4].includes(weekday(D))) D = addDaysToKey(D, 1);
let SAT = D;
while (weekday(SAT) !== 6) SAT = addDaysToKey(SAT, 1);
const local = (date: string, hour: number) =>
  zonedTimeToUtc({ ...parseDateKey(date), hour }, TZ);

const win = (d: DayAvailability | null | undefined, start: string) => {
  const w = d?.windows.find((x) => x.start === start);
  if (!w) throw new Error(`no ${start} window`);
  return w;
};
const who = (w: WindowSlot) =>
  [w.suggested, ...w.alternatives]
    .filter(Boolean)
    .map((t) => t?.name)
    .sort();

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

const patch = (p: Parameters<typeof updateSettings>[1]) =>
  db.transaction((tx) => updateSettings(tx, p, SYSTEM_ACTOR));

beforeAll(async () => {
  await ensureDb();
  const res = await signup({
    companyName: "Avail Locks",
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
  tom = await invite("Tom Tech", "tom@example.com");
  tina = await invite("Tina Tech", "tina@example.com");
  const home = (lat: number, lng: number) => ({
    street: "1 Home St",
    city: "Austin",
    state: "TX",
    zip: "78701",
    lat,
    lng,
  });
  await db
    .update(users)
    .set({ homeBase: home(30.26, -97.74) })
    .where(eq(users.id, tom.id));
  await db
    .update(users)
    .set({ homeBase: home(30.27, -97.75) })
    .where(eq(users.id, tina.id));

  const [c] = await db
    .insert(customers)
    .values({
      displayName: "Pat Customer",
      firstName: "Pat",
      phone: "+15125550142",
    } as never)
    .returning({ id: customers.id });
  ids.customer = c?.id as string;
  const props = await db
    .insert(properties)
    .values(
      [
        ["job", "100 Congress Ave", "78701", 30.2639, -97.7442],
        ["toms", "200 Lavaca St", "78701", 30.2672, -97.747],
        ["far", "5 Far Rd", "78750", 30.45, -97.8],
        ["blank", "300 W 6th St", "78701", null, null],
      ].map(([, street, zip, lat, lng]) => ({
        customerId: ids.customer,
        street,
        city: "Austin",
        state: "TX",
        zip,
        lat,
        lng,
      })) as never,
    )
    .returning({ id: properties.id });
  ["job", "toms", "far", "blank"].forEach((k, i) => {
    ids[k] = props[i]?.id as string;
  });

  auth.user = admin;
  const book = async (
    start: string,
    assignee: string | null,
    propertyId = ids.toms as string,
  ) => {
    const r = await createJobAction({
      customerId: ids.customer as string,
      propertyId,
      title: `Job ${start}`,
      date: D,
      start,
      minutes: 120,
      assignees: assignee
        ? [{ userId: assignee, role: "primary" as const, splitBps: 10000 }]
        : [],
      clientId: crypto.randomUUID(),
    });
    if (!r.ok) throw new Error(JSON.stringify(r));
  };
  await book("08:00", tom.id); // Tom: 8–10
  await book("14:00", null); // booked, needs a tech: 2–4
  // Tina is off 8 AM–noon on D; Tom from noon two days later to 10 AM the next.
  await db.insert(timeOff).values([
    { userId: tina.id, startsAt: local(D, 8), endsAt: local(D, 12) },
    {
      userId: tom.id,
      startsAt: local(addDaysToKey(D, 2), 12),
      endsAt: local(addDaysToKey(D, 3), 10),
    },
  ]);
}, 120_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

describe("getAvailability (loader)", () => {
  it("reads the day's routes, time off and the booked job nobody is on", async () => {
    const d = await getDayAvailability({ propertyId: ids.job }, D);
    expect(d?.windows.map((w) => `${w.start}-${w.end}`)).toEqual([
      "08:00-10:00",
      "10:00-12:00",
      "12:00-14:00",
      "14:00-16:00",
      "16:00-17:00",
    ]);
    // Tom is on a job, Tina is off.
    expect(win(d, "08:00")).toMatchObject({ status: "full", reason: "full" });
    // Tina is off until noon; Tom is free after his 8–10 job and a short drive.
    expect(who(win(d, "10:00"))).toEqual(["Tom Tech"]);
    expect(win(d, "10:00").suggested?.reasons).toContain("1 job that day");
    expect(who(win(d, "12:00"))).toEqual(["Tina Tech", "Tom Tech"]);
    // The booked 2–4 job takes one of them (the hub's first pick: Tina, no jobs yet).
    expect(who(win(d, "14:00"))).toEqual(["Tom Tech"]);
    // A 90-minute service call can't start 4–5 and end by 5.
    expect(win(d, "16:00").status).toBe("full");
    expect(d?.openings).toBe(3);
    // Open, or one of the 3 soonest open days.
    expect(["open", "best"]).toContain(d?.status);
  });

  it("answers one day the same as the range it's in", async () => {
    const range = await getAvailability({
      from: today,
      to: addDaysToKey(D, 6),
      propertyId: ids.job,
      withWindows: true,
    });
    const day = await getDayAvailability({ propertyId: ids.job }, D);
    expect(range.find((x) => x.date === D)).toEqual(day);
    expect(range[0]?.date).toBe(today);
    const statuses = new Set(range.map((x) => x.status));
    expect(
      [...statuses].every((s) =>
        ["best", "open", "limited", "full"].includes(s),
      ),
    ).toBe(true);
    expect(range.filter((x) => x.status === "best").length).toBeLessThanOrEqual(
      3,
    );
    const lean = await getAvailability({
      from: D,
      to: D,
      propertyId: ids.job,
    });
    expect(lean[0]?.windows).toEqual([]);
    expect(lean[0]?.status).toBe(day?.status);
  });

  it("splits time off across midnight", async () => {
    const d2 = await getDayAvailability(
      { propertyId: ids.job },
      addDaysToKey(D, 2),
    );
    const d3 = await getDayAvailability(
      { propertyId: ids.job },
      addDaysToKey(D, 3),
    );
    if (
      weekday(addDaysToKey(D, 2)) !== 6 &&
      weekday(addDaysToKey(D, 2)) !== 0
    ) {
      expect(who(win(d2, "08:00"))).toContain("Tom Tech");
      expect(who(win(d2, "12:00"))).toEqual(["Tina Tech"]);
    }
    if (
      weekday(addDaysToKey(D, 3)) !== 6 &&
      weekday(addDaysToKey(D, 3)) !== 0
    ) {
      expect(who(win(d3, "08:00"))).toEqual(["Tina Tech"]);
      expect(who(win(d3, "10:00"))).toContain("Tom Tech");
    }
  });

  it("applies the daily cap from settings", async () => {
    await patch({ jobs: { daily_job_cap: 1 } });
    try {
      // Tom has his job; the booked 2–4 job goes to Tina: both are at the cap.
      const d = await getDayAvailability({ propertyId: ids.job }, D);
      expect(d).toMatchObject({ status: "full", openings: 0, reason: "full" });
    } finally {
      await patch({ jobs: { daily_job_cap: 6 } });
    }
  });

  it("gives an address outside the service ZIPs no windows", async () => {
    await patch({ company: { service_zips: ["78701", "78702"] } });
    try {
      const out = await getAvailability({
        from: D,
        to: addDaysToKey(D, 2),
        propertyId: ids.far,
        withWindows: true,
      });
      expect(out.map((x) => x.reason)).toEqual([
        "outside_area",
        "outside_area",
        "outside_area",
      ]);
      expect(out.every((x) => x.windows.length === 0)).toBe(true);
      const typed = await getDayAvailability(
        { address: { street: "9 Somewhere Ln", zip: "78750" } },
        D,
      );
      expect(typed?.reason).toBe("outside_area");
      const inside = await getDayAvailability({ propertyId: ids.job }, D);
      expect(inside?.openings).toBe(3);
    } finally {
      await patch({ company: { service_zips: [] } });
    }
  });

  it("locates a typed address and a property without coordinates", async () => {
    const saved = await getDayAvailability({ propertyId: ids.job }, D);
    // Same street and ZIP as a saved property: its coordinates.
    const typed = await getDayAvailability(
      { address: { street: "100  congress ave", zip: "78701" } },
      D,
    );
    expect(win(typed, "12:00").suggested?.extraMiles).toBe(
      win(saved, "12:00").suggested?.extraMiles,
    );
    // No coordinates and no geocoder: the middle of the ZIP's known properties.
    const blank = await getDayAvailability({ propertyId: ids.blank }, D);
    expect(win(blank, "12:00").suggested?.extraMiles).not.toBeNull();
    // Nothing known at all: still bookable, ranked by load.
    const nowhere = await getDayAvailability(
      { address: { street: "1 Unknown Rd", zip: "99999" } },
      D,
    );
    expect(win(nowhere, "12:00").suggested?.extraMiles).toBeNull();
    expect(win(nowhere, "12:00").status).toBe("open");
  });

  it("closes weekends unless a tech works them", async () => {
    const closed = await getDayAvailability({ propertyId: ids.job }, SAT);
    expect(closed).toMatchObject({
      status: "full",
      reason: "closed",
      windows: [],
    });
    const weekdays = [1, 2, 3, 4, 5].map((day) => ({
      day,
      start: "08:00",
      end: "17:00",
    }));
    await db
      .update(users)
      .set({
        workHours: [...weekdays, { day: 6, start: "09:00", end: "13:00" }],
      })
      .where(eq(users.id, tina.id));
    try {
      const sat = await getDayAvailability({ propertyId: ids.job }, SAT);
      expect(sat?.windows.map((w) => w.start)).toEqual(["09:00", "11:00"]);
      expect(sat?.openings).toBe(2);
      expect(who(win(sat, "09:00"))).toEqual(["Tina Tech"]);
      expect(win(sat, "09:00").afterHours).toBe(true);
    } finally {
      await db
        .update(users)
        .set({ workHours: null })
        .where(eq(users.id, tina.id));
    }
  });

  it("uses the job's length: a project, an estimate", async () => {
    const free = addDaysToKey(D, 1); // a weekday with nothing booked
    const [project] = await db
      .select({ id: serviceTypes.id })
      .from(serviceTypes)
      .where(eq(serviceTypes.kind, "project"))
      .limit(1);
    const half = await getDayAvailability(
      { propertyId: ids.job, serviceTypeId: project?.id },
      free,
    );
    // 4 hours must end by 5 PM: arrivals 8–10, 10–12, 12–2 only.
    expect(
      half?.windows.filter((w) => w.status === "open").map((w) => w.start),
    ).toEqual(["08:00", "10:00", "12:00"]);
    const estimate = await getDayAvailability(
      { propertyId: ids.job, kind: "estimate" },
      free,
    );
    expect(estimate?.openings).toBe(5);
  });
});

describe("getTechWorkDays (for the Assign hub)", () => {
  it("gives each tech's hours and time off that day, so arrivalFit agrees with the calendar", async () => {
    const days = await getTechWorkDays(D);
    const span = (h: number) => local(D, h).getTime();
    expect(days[tom.id]).toEqual({
      shifts: [{ start: span(8), end: span(17) }],
      blocks: [],
    });
    expect(days[tina.id]?.blocks).toEqual([{ start: span(8), end: span(12) }]);
    // Tina's 10–12: off (the calendar left her out of that window).
    const fit = arrivalFit(
      {
        lat: 30.2639,
        lng: -97.7442,
        from: span(10),
        to: span(12),
        durationMin: 90,
      },
      {
        shifts: days[tina.id]?.shifts ?? [],
        blocks: days[tina.id]?.blocks,
        stops: [],
      },
      { dayStart: span(7), dayEnd: span(20) },
    );
    expect(fit.miss).toBe("time_off");
    const weekend = await getTechWorkDays(SAT);
    expect(weekend[tina.id]?.shifts).toEqual([]);
    expect(await getTechWorkDays("soon")).toEqual({});
  });
});

describe("fetchDayWindows (read action)", () => {
  it("returns the day for a user who can create jobs", async () => {
    auth.user = admin;
    const d = await fetchDayWindows({ propertyId: ids.job, date: D });
    expect(d?.windows.length).toBe(5);
    expect(
      await fetchDayWindows({ propertyId: ids.job, date: "soon" }),
    ).toBeNull();
    expect(await fetchDayWindows({ date: D })).toBeNull();
  });

  it("refuses a tech without jobs.create", async () => {
    auth.user = { ...tom, perms: new Set() } as SessionUser;
    await expect(
      fetchDayWindows({ propertyId: ids.job, date: D }),
    ).rejects.toThrow();
    auth.user = admin;
  });
});
