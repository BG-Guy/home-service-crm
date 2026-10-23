// Leads-flow redesign (D) on a private, throwaway PGlite: the way back for every
// change (reverse steps, Reopen to the previous status, a booked lead reopening
// only once its job is cancelled, Undo), take over + release, the one lead count,
// phone leads answered (missed-lead automations skip them), wrong number stopping
// the follow-ups, repeat callers (contract 3.2) and editing contact details.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-d-leads-"),
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
  return {
    ...actual,
    getCurrentUser: async () => auth.user,
    requireUser: async (perm?: string | string[]) => {
      if (!auth.user) throw new Error("NEXT_REDIRECT /login");
      for (const p of perm ? (Array.isArray(perm) ? perm : [perm]) : []) {
        if (!auth.user.perms.has(p as never)) {
          const { ForbiddenError } = await import("@/lib/errors");
          throw new ForbiddenError(undefined, p);
        }
      }
      return auth.user;
    },
  };
});

import { eq, sql } from "drizzle-orm";
import { closeDb, db, ensureDb, execRows } from "@/db";
import { jobs, leads } from "@/db/schema";
import "@/db/seed/register";
import { POST } from "@/app/api/v1/leads/route";
import {
  claimLead,
  createLeadAndCustomer,
  createLeadSource,
  loadLeadCard,
  logLeadCall,
  lookupCaller,
  markLeadLost,
  markLeadNotSpam,
  markLeadSpam,
  releaseLead,
  reopenLead,
  setLeadStatus,
  undoLeadChange,
  updateLead,
} from "@/features/leads/actions";
import { getLeadPrefill, markLeadConverted } from "@/features/leads/api";
import { badges } from "@/features/leads/badges";
import { leadCounts, listLeads } from "@/features/leads/queries";
import { loadSessionUser } from "@/lib/auth/current";
import { acceptInvite, createInvite, signup } from "@/lib/auth/flows";
import { processEvents } from "@/lib/events";
import { type SessionUser, SYSTEM_ACTOR } from "@/lib/types";

let admin: SessionUser;
let office: SessionUser;
let sk = "";
let phoneSource = "";
let ip = 0;
const PASSWORD = "tangerine-kayak-41";

/** A web lead through the JSON API (status new, customer + property). */
async function webLead(name: string, phone: string, extra = {}) {
  const r = await POST(
    new Request("https://crm.test/api/v1/leads", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `10.9.0.${++ip}`,
        authorization: `Bearer ${sk}`,
      },
      body: JSON.stringify({
        name,
        phone,
        address: "12 Oak St, Austin, TX 78701",
        service: `Rekey ${ip}`,
        ...extra,
      }),
    }),
  );
  const body = await r.json();
  if (!body.id) throw new Error(`web lead failed: ${JSON.stringify(body)}`);
  return body.id as string;
}

const lead = async (id: string) =>
  (await db.select().from(leads).where(eq(leads.id, id)))[0];

const ok = <T>(r: { ok: true; data?: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.data as T;
};

const sends = (leadId: string) =>
  execRows<{ template_key: string; status: string }>(
    sql`select template_key, status from scheduled_messages
        where entity_type = 'lead' and entity_id = ${leadId}`,
  );

beforeAll(async () => {
  await ensureDb();
  const res = await signup({
    companyName: "Test Locks",
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
  const inv = await db.transaction((tx) =>
    createInvite(
      tx,
      { name: "Olive Office", email: "olive@example.com", role: "office" },
      SYSTEM_ACTOR,
    ),
  );
  const s = await acceptInvite({
    token: inv.token,
    password: PASSWORD,
    monitoringAck: true,
    esignConsent: true,
  });
  office = (await loadSessionUser(s.userId, s.sessionId)) as SessionUser;
  auth.user = admin;
  const api = ok(
    await createLeadSource({
      name: "Partner API",
      kind: "referral",
      integrationKind: "json_api",
    }),
  );
  sk = api.secrets.secretKey as string;
  phoneSource = ok(
    await createLeadSource({
      name: "Phone call",
      kind: "phone",
      integrationKind: "plain_form",
    }),
  ).id;
}, 120_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

const caller = (over: Record<string, unknown> = {}) => ({
  intent: "lead" as const,
  sourceId: phoneSource,
  name: "Carla Caller",
  phone: "(512) 555-0300",
  street: "40 Elm St",
  city: "Austin",
  state: "TX",
  zip: "78702",
  service: "Rekey",
  smsConsent: false,
  ...over,
});

describe("phone leads count as answered", () => {
  it("stamps the first response, is contacted and skips the missed-lead automations", async () => {
    auth.user = admin;
    const r = ok(await createLeadAndCustomer(caller()));
    expect(r.needsChoice).toBe(false);
    const l = await lead(r.leadId as string);
    expect(l?.status).toBe("contacted");
    expect(l?.firstResponseAt).toBeTruthy();
    expect(l?.firstResponseBy).toBe(admin.id);
    expect(l?.assignedUserId).toBe(admin.id);
    await processEvents();
    const s = await sends(r.leadId as string);
    expect(
      s.filter((x) =>
        [
          "lead.ack",
          "lead.ack_after_hours",
          "lead.not_reached",
          "staff.lead_sla",
        ].includes(x.template_key),
      ),
    ).toEqual([]);
  });

  it("a web lead still gets them (control), and a wrong number stops the follow-ups", async () => {
    const id = await webLead("Wendy Web", "(512) 555-0301");
    await processEvents();
    const before = await sends(id);
    expect(before.some((x) => x.template_key === "lead.not_reached")).toBe(
      true,
    );
    expect(before.some((x) => x.template_key === "staff.lead_sla")).toBe(true);
    const call = ok(await logLeadCall({ leadId: id, outcome: "wrong_number" }));
    expect(call.followUpsStopped).toBe(true);
    const after = await sends(id);
    expect(
      after.filter(
        (x) => x.template_key === "lead.not_reached" && x.status !== "canceled",
      ),
    ).toEqual([]);
  });
});

describe("repeat callers ask first (contract 3.2)", () => {
  it("returns the open lead instead of merging, then updates it or starts a new one", async () => {
    auth.user = admin;
    const phone = "(512) 555-0310";
    const first = ok(await createLeadAndCustomer(caller({ phone })));
    const a = first.leadId as string;
    const look = await lookupCaller(phone);
    expect(look.openLeads.map((o) => o.id)).toContain(a);
    expect(look.matches.length).toBe(1);

    const count = async () =>
      Number(
        (
          await execRows<{ n: number }>(
            sql`select count(*)::int as n from leads where phone = '+15125550310'`,
          )
        )[0]?.n,
      );
    expect(await count()).toBe(1);
    const ask = ok(
      await createLeadAndCustomer(caller({ phone, notes: "Back door too" })),
    );
    expect(ask.needsChoice).toBe(true);
    expect(ask.leadId).toBeNull();
    expect(ask.openLeads.map((o) => o.id)).toContain(a);
    expect(await count()).toBe(1);

    const merged = ok(
      await createLeadAndCustomer(
        caller({
          phone,
          notes: "Back door too",
          street: "77 New Rd",
          mergeIntoLeadId: a,
        }),
      ),
    );
    expect(merged).toMatchObject({ leadId: a, merged: true });
    const la = await lead(a);
    expect(la?.notes).toContain("Back door too");
    expect(la?.address?.street).toBe("77 New Rd");
    expect(await count()).toBe(1);

    // "Start a new one" for the SAME service: a second lead, same customer.
    const fresh = ok(
      await createLeadAndCustomer(caller({ phone, forceNew: true })),
    );
    expect(fresh.merged).toBe(false);
    expect(fresh.leadId).not.toBe(a);
    expect(await count()).toBe(2);
    const lb = await lead(fresh.leadId as string);
    expect(lb?.customerId).toBe(la?.customerId);
    expect(lb?.isReturning).toBe(true);
  });

  it("keeps the booking prefs typed on the call for Book", async () => {
    const r = ok(
      await createLeadAndCustomer(
        caller({
          phone: "(512) 555-0320",
          kind: "service",
          priority: "urgent",
          afterHours: true,
          preferredDate: "2026-11-02",
          preferredWindow: "morning",
        }),
      ),
    );
    const p = await getLeadPrefill(r.leadId as string, admin);
    expect(p).toMatchObject({
      kind: "service",
      priority: "urgent",
      afterHours: true,
      preferredDate: "2026-11-02",
      preferredWindow: "morning",
    });
  });
});

describe("every change has its way back", () => {
  it("steps and their reverse, with Undo", async () => {
    auth.user = admin;
    const id = await webLead("Sam Steps", "(512) 555-0330");
    const q = ok(await setLeadStatus({ leadId: id, status: "qualified" }));
    expect((await lead(id))?.status).toBe("qualified");
    // Undo puts back exactly what was there (New), not what Unqualify sets.
    ok(await undoLeadChange({ leadId: id, eventId: q.eventId as string }));
    expect((await lead(id))?.status).toBe("new");
    ok(await setLeadStatus({ leadId: id, status: "contacted" }));
    ok(await setLeadStatus({ leadId: id, status: "qualified" }));
    // Unqualify → Contacted; Not contacted → New.
    ok(await setLeadStatus({ leadId: id, status: "contacted" }));
    expect((await lead(id))?.status).toBe("contacted");
    ok(await setLeadStatus({ leadId: id, status: "new" }));
    expect((await lead(id))?.status).toBe("new");
  });

  it("Reopen returns a lost lead to the status it had before; Undo of Lost too", async () => {
    const id = await webLead("Rita Reopen", "(512) 555-0331");
    ok(await setLeadStatus({ leadId: id, status: "qualified" }));
    const lost = ok(await markLeadLost({ leadId: id, reason: "price" }));
    expect((await lead(id))?.lostReason).toBe("price");
    const back = ok(await reopenLead({ leadId: id }));
    expect(back.status).toBe("qualified");
    expect((await lead(id))?.lostReason).toBeNull();
    // That Lost can't be undone anymore: the lead moved on.
    const stale = await undoLeadChange({
      leadId: id,
      eventId: lost.eventId as string,
    });
    expect(stale.ok).toBe(false);
    // Undo of Reopen: lost again, with its reason.
    ok(await undoLeadChange({ leadId: id, eventId: back.eventId as string }));
    const l = await lead(id);
    expect(l?.status).toBe("lost");
    expect(l?.lostReason).toBe("price");
    // A fresh Lost undone: back to Qualified, no reason.
    ok(await reopenLead({ leadId: id }));
    const lost2 = ok(await markLeadLost({ leadId: id, reason: "timing" }));
    ok(await undoLeadChange({ leadId: id, eventId: lost2.eventId as string }));
    const l2 = await lead(id);
    expect(l2?.status).toBe("qualified");
    expect(l2?.lostReason).toBeNull();
  });

  it("Spam ↔ Not spam: Undo keeps a Check lead in Check; Not spam goes back where it was", async () => {
    const id = await webLead("Chuck Check", "(512) 555-0332");
    await db.update(leads).set({ spamScore: 60 }).where(eq(leads.id, id));
    const spam = ok(await markLeadSpam({ leadId: id }));
    expect((await lead(id))?.status).toBe("spam");
    ok(await undoLeadChange({ leadId: id, eventId: spam.eventId as string }));
    expect(await lead(id)).toMatchObject({ status: "new", spamScore: 60 });
    ok(await setLeadStatus({ leadId: id, status: "contacted" }));
    ok(await markLeadSpam({ leadId: id }));
    const ns = ok(await markLeadNotSpam({ leadId: id }));
    expect(ns.status).toBe("contacted");
    expect(await lead(id)).toMatchObject({ status: "contacted", spamScore: 0 });
  });

  it("a booked lead reopens only once its job is cancelled", async () => {
    const id = await webLead("Bea Booked", "(512) 555-0333");
    ok(await setLeadStatus({ leadId: id, status: "qualified" }));
    const l = await lead(id);
    const [job] = await db
      .insert(jobs)
      .values({
        number: "J-9001",
        customerId: l?.customerId as string,
        propertyId: l?.propertyId as string,
        title: "Rekey",
        status: "scheduled",
        leadId: id,
      })
      .returning({ id: jobs.id });
    await db.transaction((tx) =>
      markLeadConverted(tx, id, { jobId: job?.id }, SYSTEM_ACTOR),
    );
    expect((await lead(id))?.status).toBe("booked");
    const card = ok(await loadLeadCard(id));
    expect(card.reopen).toMatchObject({ ok: false });
    const early = await reopenLead({ leadId: id });
    expect(early.ok).toBe(false);
    await db
      .update(jobs)
      .set({ status: "cancelled" })
      .where(eq(jobs.id, job?.id as string));
    expect(ok(await loadLeadCard(id)).reopen).toEqual({
      ok: true,
      to: "qualified",
    });
    const r = ok(await reopenLead({ leadId: id }));
    expect(r.status).toBe("qualified");
    expect((await lead(id))?.convertedJobId).toBeNull();
    // Undo: booked again, with the (cancelled) job it had.
    ok(await undoLeadChange({ leadId: id, eventId: r.eventId as string }));
    expect(await lead(id)).toMatchObject({
      status: "booked",
      convertedJobId: job?.id,
    });
  });

  it("Claim ↔ Release; Take over tells the person who had it; Undo gives it back", async () => {
    const id = await webLead("Tara Takeover", "(512) 555-0334");
    auth.user = admin;
    ok(await claimLead({ leadId: id }));
    ok(await releaseLead({ leadId: id }));
    expect((await lead(id))?.assignedUserId).toBeNull();
    auth.user = office;
    ok(await claimLead({ leadId: id }));
    auth.user = admin;
    expect((await releaseLead({ leadId: id })).ok).toBe(false);
    expect((await claimLead({ leadId: id })).ok).toBe(false);
    const t = ok(await claimLead({ leadId: id, force: true }));
    expect(t.previousUserId).toBe(office.id);
    expect((await lead(id))?.assignedUserId).toBe(admin.id);
    const told = await execRows<{ n: number }>(
      sql`select count(*)::int as n from notifications
          where user_id = ${office.id} and entity_id = ${id}`,
    );
    expect(Number(told[0]?.n)).toBe(1);
    ok(await releaseLead({ leadId: id, giveBackTo: office.id }));
    expect((await lead(id))?.assignedUserId).toBe(office.id);
  });
});

describe("one count everywhere", () => {
  it("the Leads badge equals the New chip (new leads outside Check)", async () => {
    auth.user = admin;
    await webLead("Nina New", "(512) 555-0340");
    const flagged = await webLead("Fred Flagged", "(512) 555-0341");
    await db.update(leads).set({ spamScore: 90 }).where(eq(leads.id, flagged));
    const badge = await badges["leads.new"]?.(admin);
    const counts = await leadCounts(admin);
    const [want] = await execRows<{ n: number }>(
      sql`select count(*)::int as n from leads where status = 'new' and spam_score < 50`,
    );
    expect(badge).toBe(counts.new);
    expect(counts.new).toBe(Number(want?.n));
    const { items } = await listLeads(admin, { view: "new" });
    expect(items.length).toBe(counts.new);
    expect(items.some((i) => i.id === flagged)).toBe(false);
    // Office sees the same number (no "unclaimed or mine" split anymore).
    expect(await badges["leads.new"]?.(office)).toBe(badge);
  });
});

describe("Edit lead fixes the contact details", () => {
  it("changes the phone, email and address (the address lands as a property)", async () => {
    auth.user = admin;
    const id = await webLead("Eddie Edit", "(512) 555-0350");
    const before = await lead(id);
    const res = ok(
      await updateLead({
        leadId: id,
        name: "Eddie Edit",
        phone: "(512) 555-0359",
        email: "Eddie@Example.com",
        street: "9 Elm St",
        city: "Austin",
        state: "tx",
        zip: "78702",
      }),
    );
    const l = await lead(id);
    expect(l?.phone).toBe("+15125550359");
    expect(l?.email).toBe("eddie@example.com");
    expect(l?.address).toMatchObject({
      street: "9 Elm St",
      zip: "78702",
      state: "TX",
    });
    expect(l?.propertyId).not.toBe(before?.propertyId);
    // The customer made from the same typo is fixed too.
    expect(res.customerFields).toEqual(["phone"]);
    const [c] = await execRows<{ phone: string }>(
      sql`select phone from customers where id = ${l?.customerId}`,
    );
    expect(c?.phone).toBe("+15125550359");
    const bad = await updateLead({ leadId: id, phone: "12" });
    expect(bad.ok).toBe(false);
  });
});

describe("the lead card's light loader", () => {
  it("returns the box plus last contact and the way back", async () => {
    auth.user = admin;
    const id = await webLead("Lena Loader", "(512) 555-0360");
    ok(await logLeadCall({ leadId: id, outcome: "no_answer" }));
    const card = ok(await loadLeadCard(id));
    expect(card).toMatchObject({
      id,
      status: "contacted",
      lastContact: { channel: "call", outcome: "no_answer" },
      reopen: null,
    });
    expect(card.street).toBe("12 Oak St");
    ok(await markLeadLost({ leadId: id, reason: "price" }));
    const lost = ok(await loadLeadCard(id));
    expect(lost).toMatchObject({
      previousStatus: "contacted",
      reopen: { ok: true, to: "contacted" },
    });
    expect(
      (await loadLeadCard("00000000-0000-4000-8000-000000000000")).ok,
    ).toBe(false);
  });
});
