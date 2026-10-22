// Schedule map view reads on a throwaway PGlite: one day of routes (window order,
// no-location and unassigned jobs, cancelled left out), the board's permission
// (schedule.view_all) and the contact window for a tech who can open the schedule.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-smap-test-"),
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
import { customers, jobs, properties } from "@/db/schema";
import "@/db/seed/register";
import { createJobAction } from "@/features/jobs/actions";
import { loadScheduleMap } from "@/features/jobs/schedule-map/queries";
import { loadSessionUser } from "@/lib/auth/current";
import { acceptInvite, createInvite, signup } from "@/lib/auth/flows";
import { type SessionUser, SYSTEM_ACTOR } from "@/lib/types";

const PASSWORD = "tangerine-kayak-41";
// Tomorrow (UTC date): always more than 2 h away in the company zone, so a
// tech is outside every job's contact window.
const day = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
let admin: SessionUser;
let tech: SessionUser;
let tech2: SessionUser;
const ids: Record<string, string> = {};

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

beforeAll(async () => {
  await ensureDb();
  const res = await signup({
    companyName: "Map Locks",
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
  const customerId = c?.id as string;
  const props = await db
    .insert(properties)
    .values([
      {
        customerId,
        street: "100 Congress Ave",
        city: "Austin",
        state: "TX",
        zip: "78701",
        lat: 30.2639,
        lng: -97.7442,
      },
      {
        customerId,
        street: "200 Lamar Blvd",
        city: "Austin",
        state: "TX",
        zip: "78703",
        lat: null,
        lng: null,
      },
    ] as never)
    .returning({ id: properties.id });
  const [located, unknown] = props.map((p) => p.id) as [string, string];
  auth.user = admin;
  const make = async (
    key: string,
    start: string,
    propertyId: string,
    assignees: string[],
  ) => {
    const r = await createJobAction({
      customerId,
      propertyId,
      title: `Job ${key}`,
      date: day,
      start,
      minutes: 120,
      assignees: assignees.map((userId, i) => ({
        userId,
        role: i === 0 ? ("primary" as const) : ("helper" as const),
        splitBps: i === 0 ? 10000 : 0,
      })),
      clientId: crypto.randomUUID(),
    });
    if (!r.ok || !r.data) throw new Error(`create ${key} failed`);
    ids[key] = r.data.jobId;
  };
  await make("late", "13:00", located, [tech.id]);
  await make("early", "09:00", located, [tech.id]);
  await make("noLoc", "11:00", unknown, [tech.id]);
  await make("other", "08:00", located, [tech2.id, tech.id]);
  await make("open", "15:00", located, []);
  await make("gone", "10:00", located, [tech.id]);
  await db
    .update(jobs)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(jobs.id, ids.gone as string));
}, 120_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

describe("schedule map day", () => {
  it("orders each tech's stops by window, keeps unassigned and no-location jobs", async () => {
    auth.user = admin;
    const d = await loadScheduleMap({ date: day, userAgent: "Mozilla/5.0" });
    expect(d.date).toBe(day);
    const byId = new Map(d.jobs.map((j) => [j.id, j]));
    expect(byId.has(ids.gone as string)).toBe(false);
    expect(d.jobs).toHaveLength(5);
    const t = d.techs.find((x) => x.id === tech.id);
    // Tom: the helper job at 8, then 9, 11 (no location), 13.
    expect(t?.jobIds).toEqual([ids.other, ids.early, ids.noLoc, ids.late]);
    expect(t?.firstMin).toBe(8 * 60);
    expect(t?.lastMin).toBe(15 * 60);
    expect(d.techs.find((x) => x.id === tech2.id)?.jobIds).toEqual([ids.other]);
    // Same address all day and no home base: no miles to count.
    expect(t?.miles).toBe(0);
    const open = byId.get(ids.open as string);
    expect(open?.techIds).toEqual([]);
    expect(byId.get(ids.other as string)?.techIds).toEqual([tech2.id, tech.id]);
    const noLoc = byId.get(ids.noLoc as string);
    expect(noLoc?.lat).toBeNull();
    expect(noLoc?.address).toBe("200 Lamar Blvd, Austin");
    const early = byId.get(ids.early as string);
    expect(early).toMatchObject({
      startMin: 9 * 60,
      endMin: 11 * 60,
      lat: 30.2639,
      address: "100 Congress Ave, Austin",
      phoneLabel: "(512) 555-0142",
      canCall: true,
      customerShort: "Pat C.",
    });
    expect(early?.navHref).toContain("destination=30.2639,-97.7442");
    expect(d.setupHref).toBe("/settings/map");
    expect(d.canAssign).toBe(true);
    // The timeline spans the windows ± 1 h: 7a to 6p.
    expect([d.dayStartMin, d.dayEndMin]).toEqual([7 * 60, 18 * 60]);
  });

  it("needs the schedule permission", async () => {
    auth.user = tech;
    await expect(loadScheduleMap({ date: day })).rejects.toThrow();
  });

  it("masks contact details outside the window for a tech who can open the schedule", async () => {
    auth.user = {
      ...tech,
      perms: new Set([...tech.perms, "schedule.view_all"]),
    } as SessionUser;
    expect(auth.user.perms.has("customers.contact_view")).toBe(false);
    const d = await loadScheduleMap({ date: day });
    const early = d.jobs.find((j) => j.id === ids.early);
    expect(early).toMatchObject({
      lat: null,
      lng: null,
      navHref: null,
      canCall: false,
      canText: false,
      phoneLabel: "•••• 0142",
    });
    expect(early?.address).toBe("••• Congress Ave, Austin");
    // Without a location the stop stays on the route, unnumbered on the map.
    expect(d.techs.find((x) => x.id === tech.id)?.jobIds).toHaveLength(4);
    expect(d.setupHref).toBeNull();
    expect(d.canAssign).toBe(false);
  });
});
