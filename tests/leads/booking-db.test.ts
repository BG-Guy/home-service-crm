// bookLead (contract 3.3) on a throwaway PGlite: any saved lead is booked into a
// 2-hour arrival window with the job type, urgency, after-hours, the customer's
// notes and the day they asked for; nobody is assigned (the Assign hub picks the
// tech, and job.scheduled — the customer's confirmation — fires only then); the
// lead is marked booked; the lockout keeps its ⚖️ ownership checklist.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-booking-test-"),
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
  const check = async (perm?: string | readonly string[], any = false) => {
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
    requireUser: (perm?: string | readonly string[]) => check(perm),
    requireAnyPerm: (perms: string[]) => check(perms, true),
  };
});

import { and, eq, sql } from "drizzle-orm";
import { closeDb, db, ensureDb, execRows } from "@/db";
import {
  customers,
  jobAssignments,
  jobs,
  leads,
  properties,
  serviceTypes,
} from "@/db/schema";
import "@/db/seed/register";
import { listJobLines } from "@/features/invoices/api";
import { LEAD_QUOTE_LINE_DESCRIPTION } from "@/features/invoices/lead-quote";
import { scheduleJob } from "@/features/jobs/actions";
import { bookLead } from "@/features/leads/booking-actions";
import { getBookingDone } from "@/features/leads/booking-queries";
import { loadSessionUser } from "@/lib/auth/current";
import { acceptInvite, createInvite, signup } from "@/lib/auth/flows";
import { addDaysToKey, dateKey, zonedParts } from "@/lib/time";
import { type SessionUser, SYSTEM_ACTOR } from "@/lib/types";

const TZ = "America/Chicago";
const PASSWORD = "tangerine-kayak-41";
let admin: SessionUser;
let tech: SessionUser;
let customerId: string;
let propertyId: string;
const ids = { estimate: "", service: "", project: "", lockout: "" };
const today = () => dateKey(new Date(), TZ);
const tomorrow = () => addDaysToKey(today(), 1);

const evCount = async (type: string, entityId?: string) =>
  Number(
    (
      await execRows<{ n: number }>(
        entityId
          ? sql`select count(*)::int as n from events where type = ${type} and entity_id = ${entityId}`
          : sql`select count(*)::int as n from events where type = ${type}`,
      )
    )[0]?.n ?? 0,
  );

async function newLead(
  over: Partial<typeof leads.$inferInsert> = {},
): Promise<string> {
  const [l] = await db
    .insert(leads)
    .values({
      status: "new",
      customerId,
      propertyId,
      name: "Dana Whitfield",
      phone: "+13035550190",
      ...over,
    } as never)
    .returning({ id: leads.id });
  return l?.id as string;
}

beforeAll(async () => {
  await ensureDb();
  const res = await signup({
    companyName: "Booking Locks",
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

  const [c] = await db
    .insert(customers)
    .values({
      displayName: "Dana Whitfield",
      firstName: "Dana",
      phone: "+13035550190",
    } as never)
    .returning({ id: customers.id });
  customerId = c?.id as string;
  const [p] = await db
    .insert(properties)
    .values({
      customerId,
      street: "1450 Gaylord St",
      city: "Denver",
      state: "CO",
      zip: "80206",
      lat: 39.7392,
      lng: -104.9612,
    } as never)
    .returning({ id: properties.id });
  propertyId = p?.id as string;

  // The base seed's three job types, plus a trade job under Service call.
  const rows = await db
    .select({ id: serviceTypes.id, kind: serviceTypes.kind })
    .from(serviceTypes)
    .where(eq(serviceTypes.active, true));
  for (const k of ["estimate", "service", "project"] as const)
    ids[k] = rows.find((r) => r.kind === k)?.id ?? "";
  const [lock] = await db
    .insert(serviceTypes)
    .values({
      name: "Lockout",
      kind: "service",
      defaultDurationMin: 45,
      defaultPriceCents: 12_500,
      requiresOwnershipCheck: true,
      sort: 10,
    })
    .returning({ id: serviceTypes.id });
  ids.lockout = lock?.id as string;
}, 120_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

describe("bookLead", () => {
  let leadId: string;
  let jobId: string;

  it("books the lead into its window with what was typed, and no tech", async () => {
    expect(ids.estimate && ids.service && ids.project).toBeTruthy();
    auth.user = admin;
    leadId = await newLead({
      serviceTypeId: ids.lockout,
      serviceText: "Lockout",
      notes: "Keys locked inside.",
      quotedPriceCents: 12_500,
      preferredDate: tomorrow(),
      preferredWindow: "Morning",
    });
    const input = {
      leadId,
      kind: "service" as const,
      serviceTypeId: ids.lockout,
      windowDate: tomorrow(),
      windowStart: "08:00",
      windowEnd: "10:00",
      priority: "urgent" as const,
      afterHours: true,
      customerNotes: "Keys locked inside. Side gate code 4412.",
      clientId: crypto.randomUUID(),
    };
    const r = await bookLead(input);
    expect(r.ok).toBe(true);
    if (!r.ok || !r.data) throw new Error("booking failed");
    jobId = r.data.jobId;
    expect(r.data.number).toMatch(/^J-\d+/);

    // Same clientId (a double tap, an offline replay): the same answer, one job.
    expect(await bookLead(input)).toEqual(r);
    expect(
      (await db.select().from(jobs).where(eq(jobs.leadId, leadId))).length,
    ).toBe(1);

    const [j] = await db.select().from(jobs).where(eq(jobs.id, jobId));
    if (!j?.windowStart || !j.windowEnd) throw new Error("no window");
    const s = zonedParts(j.windowStart, TZ);
    const e = zonedParts(j.windowEnd, TZ);
    expect(dateKey(j.windowStart, TZ)).toBe(tomorrow());
    expect([s.hour, s.minute, e.hour, e.minute]).toEqual([8, 0, 10, 0]);
    expect(j).toMatchObject({
      status: "unscheduled",
      serviceTypeId: ids.lockout,
      title: "Lockout",
      priority: "urgent",
      afterHours: true,
      customerNotes: "Keys locked inside. Side gate code 4412.",
      leadId,
      customerId,
      propertyId,
    });
    expect(j.custom).toMatchObject({
      requested_date: tomorrow(),
      requested_window: "Morning",
    });
    // ⚖️ The lockout keeps its proof-of-ownership checklist.
    expect(
      (j.checklist ?? []).filter((i) => i.id.startsWith("own:")).length,
    ).toBeGreaterThan(0);

    // Nobody assigned; the confirmation waits for the hub.
    expect(
      await db
        .select()
        .from(jobAssignments)
        .where(eq(jobAssignments.jobId, jobId)),
    ).toHaveLength(0);
    expect(await evCount("job.created", jobId)).toBe(1);
    expect(await evCount("job.scheduled", jobId)).toBe(0);

    // The lead is booked (markLeadConverted) and the quote is the first line.
    const [l] = await db.select().from(leads).where(eq(leads.id, leadId));
    expect(l).toMatchObject({ status: "booked", convertedJobId: jobId });
    expect(await evCount("lead.converted", leadId)).toBe(1);
    const lines = await listJobLines(jobId);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      unitPriceCents: 12_500,
      description: LEAD_QUOTE_LINE_DESCRIPTION,
    });

    // The Done screen reads it in one go.
    const done = await getBookingDone(jobId);
    expect(done).toMatchObject({
      date: tomorrow(),
      start: "08:00",
      end: "10:00",
      techName: null,
      serviceName: "Lockout",
    });
  });

  it("books it once: a second booking is refused", async () => {
    auth.user = admin;
    const r = await bookLead({
      leadId,
      kind: "service",
      serviceTypeId: ids.lockout,
      windowDate: tomorrow(),
      windowStart: "10:00",
      windowEnd: "12:00",
    });
    expect(r).toMatchObject({
      ok: false,
      error: "This lead is already booked.",
    });
  });

  it("assigning a tech in the hub schedules it and sends the confirmation event", async () => {
    auth.user = admin;
    const r = await scheduleJob({
      jobId,
      assignees: [{ userId: tech.id, role: "primary", splitBps: 10000 }],
    });
    expect(r.ok).toBe(true);
    const [j] = await db.select().from(jobs).where(eq(jobs.id, jobId));
    expect(j?.status).toBe("scheduled");
    expect(await evCount("job.scheduled", jobId)).toBe(1);
  });

  it("no chip: the card's own row, titled with what they typed", async () => {
    auth.user = admin;
    const id = await newLead({ serviceText: "Garage door won't close" });
    const r = await bookLead({
      leadId: id,
      kind: "estimate",
      serviceTypeId: null,
      windowDate: tomorrow(),
      windowStart: "12:00",
      windowEnd: "14:00",
    });
    expect(r.ok).toBe(true);
    if (!r.ok || !r.data) throw new Error("booking failed");
    const [j] = await db.select().from(jobs).where(eq(jobs.id, r.data.jobId));
    expect(j).toMatchObject({
      serviceTypeId: ids.estimate,
      title: "Garage door won't close",
      priority: "normal",
      afterHours: false,
      customerNotes: null,
    });
  });

  it("a chip must sit under its card", async () => {
    auth.user = admin;
    const id = await newLead();
    const r = await bookLead({
      leadId: id,
      kind: "estimate",
      serviceTypeId: ids.lockout,
      windowDate: tomorrow(),
      windowStart: "08:00",
      windowEnd: "10:00",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fieldErrors?.serviceTypeId?.[0]).toMatch(/isn't a Free estimate/);
    const [l] = await db.select().from(leads).where(eq(leads.id, id));
    expect(l?.status).toBe("new");
  });

  it("refuses past days and windows, and spam", async () => {
    auth.user = admin;
    const id = await newLead();
    const past = await bookLead({
      leadId: id,
      kind: "service",
      windowDate: addDaysToKey(today(), -1),
      windowStart: "08:00",
      windowEnd: "10:00",
    });
    expect(past).toMatchObject({ ok: false });
    const early = await bookLead({
      leadId: id,
      kind: "service",
      windowDate: today(),
      windowStart: "00:00",
      windowEnd: "00:30",
    });
    expect(early).toMatchObject({ ok: false });

    const spam = await newLead({ status: "spam" });
    expect(
      await bookLead({
        leadId: spam,
        kind: "service",
        windowDate: tomorrow(),
        windowStart: "08:00",
        windowEnd: "10:00",
      }),
    ).toMatchObject({ ok: false, error: "Mark this lead as not spam first." });
  });

  it("books a flagged lead with no customer yet, linking it to a customer", async () => {
    // The owner kept booking allowed for flagged ("Check") leads, so booking makes
    // the customer the way Looks legit would.
    auth.user = admin;
    const bare = await newLead({ customerId: null, propertyId: null });
    const r = await bookLead({
      leadId: bare,
      kind: "service",
      windowDate: tomorrow(),
      windowStart: "10:00",
      windowEnd: "12:00",
    });
    expect(r.ok).toBe(true);
    const [l] = await db.select().from(leads).where(eq(leads.id, bare));
    expect(l?.customerId).toBeTruthy();
    expect(l?.status).toBe("booked");
    expect(
      await db.select().from(jobs).where(eq(jobs.leadId, bare)),
    ).toHaveLength(1);
  });

  it("refuses a lead with no name, phone or email", async () => {
    auth.user = admin;
    const empty = await newLead({
      customerId: null,
      propertyId: null,
      name: null,
      phone: null,
    });
    const r = await bookLead({
      leadId: empty,
      kind: "service",
      windowDate: tomorrow(),
      windowStart: "10:00",
      windowEnd: "12:00",
    });
    expect(r).toMatchObject({ ok: false });
    expect(
      await db
        .select()
        .from(jobs)
        .where(and(eq(jobs.leadId, empty))),
    ).toHaveLength(0);
  });

  it("needs leads.convert and jobs.create", async () => {
    auth.user = tech;
    const id = await newLead();
    const r = await bookLead({
      leadId: id,
      kind: "service",
      windowDate: tomorrow(),
      windowStart: "08:00",
      windowEnd: "10:00",
    });
    expect(r.ok).toBe(false);
  });
});
