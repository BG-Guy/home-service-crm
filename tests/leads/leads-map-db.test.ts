// Lead map data on a throwaway PGlite (leads-flow item 10): which open leads show
// as pins and why the others can't (coverage by reason), today's jobs as markers
// (jobs permissions and the contact window), the `leads.map_backfill` pass that
// gives open leads with an address a property (and its geocode job), and intake
// queueing one more geocode for a matched property that never got a position.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-leads-map-"),
);
process.env.PGLITE_DIR = path.join(root, "pglite");
process.env.UPLOADS_DIR = path.join(root, "uploads");
process.env.CRM_DISABLE_BACKGROUND = "1";
process.env.CRON_PIGGYBACK = "0";
process.env.AI_PROVIDER = "none";
// The default geocoder (Census): jobs get queued, never run here (no network).
delete process.env.GEOCODER;

import { eq, sql } from "drizzle-orm";
import { closeDb, db, ensureDb, execRows } from "@/db";
import {
  customers,
  jobAssignments,
  jobs,
  leads,
  properties,
} from "@/db/schema";
import "@/db/seed/register";
import { processLead } from "@/features/leads/intake/process";
import { runMapBackfill } from "@/features/leads/map-backfill";
import { requeueGeocode } from "@/features/leads/map-geocode";
import { getLeadsMapData } from "@/features/leads/map-queries";
import { loadSessionUser } from "@/lib/auth/current";
import { acceptInvite, createInvite, signup } from "@/lib/auth/flows";
import {
  addDaysToKey,
  dateKey,
  parseDateKey,
  zonedTimeToUtc,
} from "@/lib/time";
import { type SessionUser, SYSTEM_ACTOR } from "@/lib/types";

const PASSWORD = "tangerine-kayak-41";
const TZ = "America/Denver";
const MIN = 60_000;
let admin: SessionUser;
let tech: SessionUser;
const id: Record<string, string> = {};

const denver = (street: string, zip: string) => ({
  street,
  city: "Denver",
  state: "CO",
  zip,
});

async function geocodeJobs(propertyId: string) {
  return execRows<{ dedupe_key: string; status: string }>(
    sql`select dedupe_key, status from job_queue
        where kind = 'geocode' and payload->>'propertyId' = ${propertyId}
        order by id`,
  );
}

beforeAll(async () => {
  await ensureDb();
  const res = await signup({
    companyName: "Map Locks",
    name: "Ada Admin",
    email: "ada@example.com",
    password: PASSWORD,
    timezone: TZ,
    state: "co",
  });
  admin = (await loadSessionUser(
    res.userId,
    res.session?.sessionId as string,
  )) as SessionUser;
  const inv = await db.transaction((tx) =>
    createInvite(
      tx,
      { name: "Tom Tech", email: "tom@example.com", role: "tech" },
      SYSTEM_ACTOR,
    ),
  );
  const s = await acceptInvite({
    token: inv.token,
    password: PASSWORD,
    monitoringAck: true,
    esignConsent: true,
  });
  tech = (await loadSessionUser(s.userId, s.sessionId)) as SessionUser;

  const cs = await db
    .insert(customers)
    .values([
      { displayName: "Pat Placed", phone: "+13035550101" },
      { displayName: "Gil Pending", phone: "+13035550102" },
      { displayName: "Ivy Intake", phone: "+13035550103" },
    ] as never)
    .returning({ id: customers.id });
  [id.c1, id.c2, id.c3] = cs.map((c) => c.id) as [string, string, string];
  const ps = await db
    .insert(properties)
    .values([
      {
        customerId: id.c1,
        ...denver("100 Larimer St", "80202"),
        lat: 39.7525,
        lng: -104.9995,
        geocodeStatus: "ok",
      },
      { customerId: id.c2, ...denver("200 Pending St", "80205") },
      {
        customerId: id.c2,
        ...denver("300 Nowhere Rd", "80211"),
        geocodeStatus: "failed",
      },
      { customerId: id.c3, ...denver("400 Intake Ave", "80206") },
      {
        customerId: id.c3,
        ...denver("410 Jobsite Way", "80206"),
        lat: 39.7312,
        lng: -104.9411,
        geocodeStatus: "ok",
      },
    ] as never)
    .returning({ id: properties.id });
  [id.p1, id.p2, id.p3, id.p4, id.p5] = ps.map((p) => p.id) as [
    string,
    string,
    string,
    string,
    string,
  ];

  const at = (m: number) => new Date(Date.now() - m * MIN);
  const ls = await db
    .insert(leads)
    .values([
      // On the map (its property is placed).
      {
        status: "new",
        name: "Pat Placed",
        phone: "+13035550101",
        customerId: id.c1,
        propertyId: id.p1,
        address: denver("100 Larimer St", "80202"),
        createdAt: at(5),
      },
      // Waiting for the geocoder.
      {
        status: "contacted",
        name: "Gil Pending",
        phone: "+13035550102",
        customerId: id.c2,
        propertyId: id.p2,
        address: denver("200 Pending St", "80205"),
        createdAt: at(50),
        firstResponseAt: at(45),
      },
      // An address, no customer yet (a walk-in saved before intake made one).
      {
        status: "new",
        name: "Wally Walkin",
        phone: "+13035550104",
        address: denver("500 Walk In Ave", "80211"),
        smsConsent: true,
        createdAt: at(8),
      },
      // No address at all.
      { status: "new", name: "Nora Noaddr", phone: "+13035550105" },
      // "Check" (flagged) and closed leads aren't in the inbox, so not counted.
      {
        status: "new",
        name: "xkcd zzpt",
        phone: "+13035550106",
        spamScore: 80,
        address: denver("600 Spam St", "80202"),
      },
      {
        status: "lost",
        name: "Pat Placed",
        phone: "+13035550101",
        customerId: id.c1,
        propertyId: id.p1,
      },
      // A customer, an address on file, but the lead never got the property.
      {
        status: "qualified",
        name: "Pat Placed",
        phone: "+13035550101",
        customerId: id.c1,
        address: denver("100 Larimer St", "80202"),
        createdAt: at(120),
      },
      // The geocoder couldn't find it.
      {
        status: "new",
        name: "Gil Pending",
        phone: "+13035550102",
        customerId: id.c2,
        propertyId: id.p3,
        address: denver("300 Nowhere Rd", "80211"),
      },
    ] as never)
    .returning({ id: leads.id });
  ls.forEach((l, i) => {
    id[`l${i + 1}`] = l.id;
  });

  // Today's jobs (company zone): one for the tech that already started, one for
  // nobody later today, one cancelled, one tomorrow, one at an unplaced address.
  const now = Date.now();
  const today = dateKey(new Date(now), TZ);
  const dayStart = zonedTimeToUtc(parseDateKey(today), TZ).getTime();
  const tomorrow = zonedTimeToUtc(
    parseDateKey(addDaysToKey(today, 1)),
    TZ,
  ).getTime();
  const started = Math.max(dayStart + MIN, now - 30 * MIN);
  const later = Math.min(tomorrow - 2 * 60 * MIN, now + 3 * 60 * MIN);
  const job = (
    n: number,
    o: { start: number; customerId: string; propertyId: string } & Record<
      string,
      unknown
    >,
  ) => ({
    number: `J-${n}`,
    title: `Job ${n}`,
    status: "scheduled",
    windowStart: new Date(o.start),
    windowEnd: new Date(o.start + 2 * 60 * MIN),
    ...o,
  });
  const js = await db
    .insert(jobs)
    .values([
      job(1, { start: started, customerId: id.c1, propertyId: id.p1 }),
      job(2, {
        start: Math.max(later, started + MIN),
        customerId: id.c3,
        propertyId: id.p5,
      }),
      job(3, {
        start: started,
        customerId: id.c1,
        propertyId: id.p1,
        status: "cancelled",
      }),
      job(4, {
        start: tomorrow + 10 * 60 * MIN,
        customerId: id.c1,
        propertyId: id.p1,
      }),
      job(5, { start: started, customerId: id.c2, propertyId: id.p2 }),
    ] as never)
    .returning({ id: jobs.id, number: jobs.number });
  for (const j of js) id[j.number] = j.id;
  await db.insert(jobAssignments).values({
    jobId: id["J-1"] as string,
    userId: tech.id,
    role: "primary",
    splitBps: 10000,
  } as never);
}, 120_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

describe("getLeadsMapData", () => {
  it("pins the open leads that have a position and counts the rest by reason", async () => {
    const d = await getLeadsMapData(admin);
    expect(d.points.map((p) => p.id)).toEqual([id.l1]);
    expect(d.points[0]).toMatchObject({
      initials: "PP",
      name: "Pat P.",
      seed: id.c1,
      lat: 39.7525,
      lng: -104.9995,
    });
    expect(d.coverage).toEqual({
      total: 6,
      placed: 1,
      missing: { no_address: 1, no_property: 2, pending: 1, failed: 1 },
    });
    expect(d.setupHref).toBe("/settings/map");
  });

  it("shows today's jobs with a position (cancelled, tomorrow and unplaced left out)", async () => {
    const d = await getLeadsMapData(admin);
    expect(d.jobs.map((j) => j.id).sort()).toEqual(
      [id["J-1"], id["J-2"]].sort(),
    );
    expect(d.jobs.find((j) => j.id === id["J-1"])?.label).toMatch(
      /^J-1 · Job 1 · /,
    );
  });

  it("follows the jobs permissions and the contact window", async () => {
    // Someone who sees leads and only their own jobs, without customers.contact_view:
    // their job already started (inside the contact window), nobody else's.
    const own = {
      ...tech,
      perms: new Set(["leads.view", "jobs.view_own"]),
    } as unknown as SessionUser;
    expect((await getLeadsMapData(own)).jobs.map((j) => j.id)).toEqual([
      id["J-1"],
    ]);
    const noJobs = {
      ...tech,
      perms: new Set(["leads.view"]),
    } as unknown as SessionUser;
    expect((await getLeadsMapData(noJobs)).jobs).toEqual([]);
    await expect(getLeadsMapData(tech)).rejects.toThrow();
  });
});

describe("leads.map_backfill", () => {
  it("gives open leads with an address a property (and a customer when they have none)", async () => {
    const r = await runMapBackfill(new Date());
    expect(r).toMatchObject({ linked: 2, customers: 1 });
    const [walkIn] = await db
      .select()
      .from(leads)
      .where(eq(leads.id, id.l3 as string));
    expect(walkIn?.customerId).toBeTruthy();
    expect(walkIn?.propertyId).toBeTruthy();
    const [c] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, walkIn?.customerId as string));
    expect(c).toMatchObject({
      displayName: "Wally Walkin",
      phone: "+13035550104",
    });
    // Its new property waits for the geocoder: a job is queued.
    expect(await geocodeJobs(walkIn?.propertyId as string)).toEqual([
      { dedupe_key: `geocode:${walkIn?.propertyId}:v0`, status: "queued" },
    ]);
    // The qualified lead found its customer's placed property: on the map at once.
    const [q] = await db
      .select({ propertyId: leads.propertyId })
      .from(leads)
      .where(eq(leads.id, id.l7 as string));
    expect(q?.propertyId).toBe(id.p1);
    // The SMS consent on the walk-in carries over to its new customer.
    const consent = await execRows<{ n: number }>(
      sql`select count(*)::int as n from consent_events where customer_id = ${walkIn?.customerId}`,
    );
    expect(Number(consent[0]?.n)).toBeGreaterThan(0);
    // "Check" and closed leads are left alone.
    const [check] = await db
      .select({ customerId: leads.customerId })
      .from(leads)
      .where(eq(leads.id, id.l5 as string));
    expect(check?.customerId).toBeNull();
  });

  it("gives a lead property that never got a position one more geocode try", async () => {
    // p2 (Gil's) had no job: the first pass queued one for today.
    const keys = (await geocodeJobs(id.p2 as string)).map((j) => j.dedupe_key);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(
      new RegExp(`^geocode:${id.p2}:retry-\\d{4}-\\d{2}-\\d{2}$`),
    );
  });

  it("is a no-op the second time", async () => {
    expect(await runMapBackfill(new Date())).toEqual({
      linked: 0,
      customers: 0,
      requeued: 0,
    });
    const d = await getLeadsMapData(admin);
    expect(d.coverage).toEqual({
      total: 6,
      placed: 2,
      missing: { no_address: 1, no_property: 0, pending: 2, failed: 1 },
    });
  });

  it("queues nothing when no geocoder is set up", async () => {
    process.env.GEOCODER = "none";
    try {
      expect(await requeueGeocode(db, id.p4 as string)).toBe(false);
    } finally {
      delete process.env.GEOCODER;
    }
    expect(await geocodeJobs(id.p4 as string)).toEqual([]);
  });
});

describe("intake (step 7)", () => {
  it("queues a geocode for a matched property that never got a position", async () => {
    const out = await processLead({
      auth: {
        kind: "manual",
        source: null,
        actor: { kind: "user", userId: admin.id },
      },
      channel: "manual",
      raw: {
        name: "Ivy Intake",
        phone: "+13035550103",
        street: "400 Intake Ave",
        city: "Denver",
        state: "CO",
        zip: "80206",
        service: "Rekey 2 locks",
      },
      ip: null,
      userAgent: null,
      origin: null,
      referer: null,
    });
    expect(out.status).toBe("created");
    const [lead] = await db
      .select({ propertyId: leads.propertyId })
      .from(leads)
      .where(eq(leads.id, (out as { leadId: string }).leadId));
    expect(lead?.propertyId).toBe(id.p4);
    expect((await geocodeJobs(id.p4 as string)).map((j) => j.status)).toEqual([
      "queued",
    ]);
  });
});
