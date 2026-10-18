// B1 customers regression tests (QA round 2) on a throwaway PGlite:
// T2-02 duplicate check SQL, T5-07/T5-08 call guards (IDOR + contact window),
// T5-11 address masking, T2-09 consent carried on merge, T2-24 one call activity.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-b1-customers-"),
);
process.env.PGLITE_DIR = path.join(root, "pglite");
process.env.UPLOADS_DIR = path.join(root, "uploads");
process.env.CRM_DISABLE_BACKGROUND = "1";
process.env.CRON_PIGGYBACK = "0";
process.env.AI_PROVIDER = "none";
process.env.GEOCODER = "none";
process.env.APP_URL = "https://crm.test";

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
import {
  checkCustomerDuplicates,
  createCustomer,
  logCustomerCall,
  mergeCustomers,
  quickCreateCustomer,
  startCustomerCall,
} from "@/features/customers/actions";
import { getPropertyBrief, logCall } from "@/features/customers/api";
import { getCustomerDetail, listCustomers } from "@/features/customers/queries";
import { globalSearch } from "@/features/customers/search";
import { recordConsent } from "@/features/messaging/api";
import { loadSessionUser } from "@/lib/auth/current";
import { acceptInvite, createInvite, signup } from "@/lib/auth/flows";
import { type SessionUser, SYSTEM_ACTOR } from "@/lib/types";

const PASSWORD = "tangerine-kayak-41";
let admin: SessionUser;
let tech: SessionUser;
let jobN = 0;

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

async function customerWithProperty(
  name: string,
  phone: string,
  street: string,
): Promise<{ customerId: string; propertyId: string }> {
  const [c] = await db
    .insert(customers)
    .values({ displayName: name, firstName: name, phone } as never)
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
      accessNotes: "Side gate",
      siteContactName: "Sam Site",
      siteContactPhone: "+15125550999",
    } as never)
    .returning({ id: properties.id });
  return { customerId: c?.id as string, propertyId: p?.id as string };
}

/** A job for the customer assigned to `userId`, starting `startInMs` from now. */
async function jobFor(
  c: { customerId: string; propertyId: string },
  userId: string,
  startInMs: number,
): Promise<string> {
  const start = new Date(Date.now() + startInMs);
  const [j] = await db
    .insert(jobs)
    .values({
      number: `T-${++jobN}`,
      customerId: c.customerId,
      propertyId: c.propertyId,
      title: "Rekey",
      status: "scheduled",
      scheduledStart: start,
      scheduledEnd: new Date(start.getTime() + 3600_000),
    } as never)
    .returning({ id: jobs.id });
  await db
    .insert(jobAssignments)
    .values({ jobId: j?.id as string, userId } as never);
  return j?.id as string;
}

const as = (u: SessionUser) => {
  auth.user = u;
};

beforeAll(async () => {
  await ensureDb();
  const res = await signup({
    companyName: "B1 Locks",
    name: "Ada Admin",
    email: "ada@example.com",
    password: PASSWORD,
    timezone: "America/Chicago",
    state: "TX",
  });
  admin = (await loadSessionUser(
    res.userId,
    res.session?.sessionId as string,
  )) as SessionUser;
  tech = await invite("Tom Tech", "tom@example.com");
}, 120_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

describe("T2-02: create customer + duplicate check (union SQL)", () => {
  it("creates a customer with phone + email + address", async () => {
    as(admin);
    const r = await createCustomer({
      smsConsent: false,
      force: false,
      language: "en",
      firstName: "Paula",
      lastName: "Diaz",
      phone: "(512) 555-0101",
      email: "paula@example.com",
      address: {
        street: "12 Oak St",
        city: "Austin",
        state: "TX",
        zip: "78701",
      },
    });
    expect(r.ok).toBe(true);
    expect(r.ok && r.data?.customerId).toBeTruthy();
  });

  it("a second customer with the same phone, email and address gets the duplicate prompt, not a 500", async () => {
    as(admin);
    const r = await createCustomer({
      smsConsent: false,
      force: false,
      language: "en",
      firstName: "Paula",
      phone: "512-555-0101",
      email: "PAULA@example.com",
      address: {
        street: "12 Oak Street",
        city: "Austin",
        state: "TX",
        zip: "78701",
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data?.customerId).toBeNull();
    expect(r.data?.duplicates.map((d) => d.reason)).toContain("phone");
    const live = await checkCustomerDuplicates({
      phone: "5125550101",
      email: "paula@example.com",
      street: "12 Oak St",
      zip: "78701",
    });
    expect(live.length).toBe(1);
    expect(live[0]?.reason).toBe("phone");
    const quick = await quickCreateCustomer({
      force: false,
      name: "Paula D",
      email: "paula@example.com",
      address: "12 Oak St, Austin, TX 78701",
    });
    expect(quick.ok && quick.data?.duplicates.length).toBe(1);
  });
});

describe("T5-07 / T5-08: call actions are bound to the customer and the window", () => {
  let mine: { customerId: string; propertyId: string };
  let other: { customerId: string; propertyId: string };
  let myJob: string;
  let otherJob: string;

  beforeAll(async () => {
    mine = await customerWithProperty(
      "Mona",
      "+15125550201",
      "100 Congress Ave",
    );
    other = await customerWithProperty(
      "Otto",
      "+15125550202",
      "200 Lamar Blvd",
    );
    myJob = await jobFor(mine, tech.id, 30 * 86_400_000); // next month: outside the window
    otherJob = await jobFor(other, admin.id, 3600_000);
    await db.insert(leads).values({
      name: "Otto",
      phone: "+15125550202",
      customerId: other.customerId,
      status: "new",
    } as never);
  });

  it("logCustomerCall: another customer's id with my jobId is refused (no lead response)", async () => {
    as(tech);
    const r = await logCustomerCall({
      customerId: other.customerId,
      jobId: myJob,
      outcome: "connected",
    });
    expect(r.ok).toBe(false);
    const [l] = await db
      .select()
      .from(leads)
      .where(eq(leads.customerId, other.customerId));
    expect(l?.firstResponseAt).toBeNull();
  });

  it("logCustomerCall: my customer with someone else's job is refused; my own job works", async () => {
    as(tech);
    const bad = await logCustomerCall({
      customerId: mine.customerId,
      jobId: otherJob,
      outcome: "connected",
    });
    expect(bad.ok).toBe(false);
    const ok = await logCustomerCall({
      customerId: mine.customerId,
      jobId: myJob,
      outcome: "no_answer",
    });
    expect(ok.ok).toBe(true);
  });

  it("startCustomerCall: outside the contact window a tech gets no number", async () => {
    as(tech);
    const r = await startCustomerCall({ customerId: mine.customerId });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/2 hours before/);
  });

  it("startCustomerCall: inside the window the tech can dial; a site phone must belong to the customer", async () => {
    as(tech);
    await db
      .update(jobs)
      .set({ scheduledStart: new Date(Date.now() + 3600_000) })
      .where(eq(jobs.id, myJob));
    const ok = await startCustomerCall({ customerId: mine.customerId });
    expect(ok.ok && ok.data?.tel).toBe("tel:+15125550201");
    const site = await startCustomerCall({
      customerId: mine.customerId,
      which: "site",
      propertyId: mine.propertyId,
    });
    expect(site.ok && site.data?.tel).toBe("tel:+15125550999");
    as(admin);
    const cross = await startCustomerCall({
      customerId: mine.customerId,
      which: "site",
      propertyId: other.propertyId,
    });
    expect(cross.ok).toBe(false);
    // Back outside the window for the masking tests below.
    await db
      .update(jobs)
      .set({ scheduledStart: new Date(Date.now() + 30 * 86_400_000) })
      .where(eq(jobs.id, myJob));
  });

  it("T5-11: outside the window the tech sees no house number, pin, access notes or site phone", async () => {
    const brief = await getPropertyBrief(mine.propertyId, tech);
    expect(brief?.masked).toBe(true);
    expect(brief?.street).toBe("••• Congress Ave");
    expect(brief?.addressShort).not.toMatch(/100/);
    expect(brief?.lat).toBeNull();
    expect(brief?.accessNotes).toBeNull();
    expect(brief?.siteContactPhone).toBe("•••• 0999");
    const full = await getPropertyBrief(mine.propertyId, admin);
    expect(full?.masked).toBeFalsy();
    expect(full?.street).toBe("100 Congress Ave");

    as(tech);
    const detail = await getCustomerDetail(mine.customerId);
    expect(detail.contactRevealed).toBe(false);
    expect(detail.phone).toBeNull();
    expect(detail.properties[0]?.addressLine).not.toMatch(/100/);
    expect(detail.properties[0]?.accessNotes).toBeNull();
    const list = await listCustomers({});
    const row = list.items.find((i) => i.id === mine.customerId);
    expect(row?.addressShort).toBe("••• Congress Ave");
    expect(row?.phoneDisplay).toBe("•••• 0201");
    const hits = await globalSearch("Congress", tech);
    const hit = hits.find((h) => h.id === mine.customerId);
    expect(hit?.subtitle ?? "").not.toMatch(/100|Congress/);
  });

  it("T5-11: inside the window the brief is complete", async () => {
    await db
      .update(jobs)
      .set({ scheduledStart: new Date(Date.now() + 3600_000) })
      .where(eq(jobs.id, myJob));
    const brief = await getPropertyBrief(mine.propertyId, tech);
    expect(brief?.masked).toBeFalsy();
    expect(brief?.street).toBe("100 Congress Ave");
    expect(brief?.accessNotes).toBe("Side gate");
  });
});

describe("T2-09: merge keeps SMS consent and opt-outs", () => {
  const consent = (
    customerId: string,
    phone: string,
    purpose: "transactional" | "marketing",
    action: "grant" | "revoke",
  ) =>
    db.transaction((tx) =>
      recordConsent(
        tx,
        {
          customerId,
          address: phone,
          channel: "sms",
          purpose,
          action,
          source: action === "revoke" ? "sms_keyword" : "web_form",
          textShown: "I agree to receive text messages from B1 Locks",
        },
        SYSTEM_ACTOR,
      ),
    );
  const status = async (id: string) =>
    (
      await db
        .select({ s: customers.smsStatus })
        .from(customers)
        .where(eq(customers.id, id))
    )[0]?.s;

  it("an opt-out on the merged-away record wins on the survivor", async () => {
    as(admin);
    const a = await customerWithProperty("Gina", "+15125550301", "1 A St");
    const b = await customerWithProperty("Gina B", "+15125550302", "2 B St");
    await consent(a.customerId, "+15125550301", "transactional", "grant");
    await consent(b.customerId, "+15125550302", "transactional", "grant");
    await consent(b.customerId, "+15125550302", "transactional", "revoke");
    expect(await status(b.customerId)).toBe("opted_out");
    const r = await mergeCustomers({
      survivorId: a.customerId,
      mergedId: b.customerId,
    });
    expect(r.ok).toBe(true);
    expect(await status(a.customerId)).toBe("opted_out");
    const rows = await execRows<{ action: string; source: string }>(
      sql`select action, source from consent_events where customer_id = ${a.customerId}
          order by created_at desc, id desc limit 1`,
    );
    expect(rows[0]).toMatchObject({ action: "revoke", source: "sms_keyword" });
  });

  it("consent the survivor lacks carries over; the survivor's opt-out is never undone", async () => {
    as(admin);
    const s = await customerWithProperty("Hal", "+15125550401", "3 C St");
    const m = await customerWithProperty("Hal B", "+15125550402", "4 D St");
    await consent(m.customerId, "+15125550402", "marketing", "grant");
    const r = await mergeCustomers({
      survivorId: s.customerId,
      mergedId: m.customerId,
    });
    expect(r.ok).toBe(true);
    expect(await status(s.customerId)).toBe("marketing");

    const s2 = await customerWithProperty("Ivy", "+15125550501", "5 E St");
    const m2 = await customerWithProperty("Ivy B", "+15125550502", "6 F St");
    await consent(s2.customerId, "+15125550501", "transactional", "revoke");
    await consent(m2.customerId, "+15125550502", "marketing", "grant");
    const r2 = await mergeCustomers({
      survivorId: s2.customerId,
      mergedId: m2.customerId,
    });
    expect(r2.ok).toBe(true);
    expect(await status(s2.customerId)).toBe("opted_out");
  });
});

describe("T2-24: a lead call is one activity row", () => {
  it("logCall with a lead and a customer writes a single call.logged row", async () => {
    const c = await customerWithProperty("Lea", "+15125550601", "7 G St");
    const [l] = await db
      .insert(leads)
      .values({
        name: "Lea",
        phone: "+15125550601",
        customerId: c.customerId,
        status: "new",
      } as never)
      .returning({ id: leads.id });
    const { callId } = await db.transaction((tx) =>
      logCall(
        tx,
        {
          customerId: c.customerId,
          leadId: l?.id,
          userId: admin.id,
          direction: "out",
          outcome: "connected",
        },
        { kind: "user", userId: admin.id },
      ),
    );
    const rows = await execRows<{ n: number }>(
      sql`select count(*)::int as n from activity
          where kind = 'call.logged' and data->>'call_id' = ${callId}`,
    );
    expect(Number(rows[0]?.n)).toBe(1);
    const cust = await execRows<{ n: number }>(
      sql`select count(*)::int as n from activity
          where kind = 'call.logged' and customer_id = ${c.customerId}`,
    );
    expect(Number(cust[0]?.n)).toBe(1);
  });
});
