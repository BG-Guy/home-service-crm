// B5 QA round 2 guard tests on a throwaway PGlite:
// - T5-04: the activity timeline is row-scoped (invoice, estimate, vehicle, tool, lead,
//   other techs' job rows on a shared customer).
// - T5-06: the composer never mints portal links for a job/lead outside the viewer's
//   scope or belonging to another customer.
// - T2-08: composer templates fit the context they are opened in.
// - T2-17: seeded outbox links follow APP_URL; T3-13 reply phone; T5-17 https review link.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-b5-guards-"),
);
process.env.PGLITE_DIR = path.join(root, "pglite");
process.env.UPLOADS_DIR = path.join(root, "uploads");
process.env.CRM_DISABLE_BACKGROUND = "1";
process.env.CRON_PIGGYBACK = "0";
process.env.AI_PROVIDER = "none";
process.env.MESSAGING_SMS_DRIVER = "link";

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

import { count, eq } from "drizzle-orm";
import { closeDb, db, ensureDb } from "@/db";
import {
  company,
  customers,
  estimates,
  invoices,
  jobAssignments,
  jobs,
  leads,
  properties,
  publicTokens,
  scheduledMessages,
  tools,
  vehicles,
} from "@/db/schema";
import "@/db/seed/register";
import {
  loadComposer,
  prepareTemplate,
  saveMessagingSettings,
  sendMessage,
} from "@/features/messaging/actions";
import { rebaseAppLinks } from "@/features/messaging/links";
import { getComposerData, listOutbox } from "@/features/messaging/queries";
import { loadActivity } from "@/features/notify/actions";
import { safeHttpsUrl } from "@/features/reviews/url";
import { writeActivity } from "@/lib/activity";
import { loadSessionUser } from "@/lib/auth/current";
import { acceptInvite, createInvite, signup } from "@/lib/auth/flows";
import { getSettings, parseSettings } from "@/lib/settings";
import { type SessionUser, SYSTEM_ACTOR } from "@/lib/types";

let admin: SessionUser;
let tech: SessionUser;
let tech2: SessionUser;
let custA: string;
let custB: string;
let jobA: string; // custA, tech
let jobC: string; // custA, tech2
let jobB: string; // custB, tech2
let invA: string;
let invB: string;
let estB: string;
let leadA: string;
const PASSWORD = "tangerine-kayak-41";
let n = 0;

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

async function customer(name: string, email: string) {
  const [c] = await db
    .insert(customers)
    .values({
      displayName: name,
      firstName: name.split(" ")[0],
      phone: "+15125550142",
      email,
      smsStatus: "transactional",
    } as never)
    .returning({ id: customers.id });
  const [p] = await db
    .insert(properties)
    .values({
      customerId: c?.id,
      street: "100 Congress Ave",
      city: "Austin",
      state: "TX",
      zip: "78701",
    } as never)
    .returning({ id: properties.id });
  return { customerId: c?.id as string, propertyId: p?.id as string };
}

async function jobFor(
  c: { customerId: string; propertyId: string },
  techId: string,
): Promise<string> {
  n++;
  const start = new Date(Date.now() + 3 * 24 * 3600_000);
  const [j] = await db
    .insert(jobs)
    .values({
      number: `J-G${n}`,
      customerId: c.customerId,
      propertyId: c.propertyId,
      title: "Rekey",
      status: "scheduled",
      windowStart: start,
      windowEnd: new Date(start.getTime() + 2 * 3600_000),
      scheduledStart: start,
    } as never)
    .returning({ id: jobs.id });
  await db
    .insert(jobAssignments)
    .values({ jobId: j?.id as string, userId: techId, role: "primary" });
  return j?.id as string;
}

async function invoiceFor(jobId: string, customerId: string): Promise<string> {
  n++;
  const [i] = await db
    .insert(invoices)
    .values({ number: `INV-G${n}`, jobId, customerId } as never)
    .returning({ id: invoices.id });
  return i?.id as string;
}

const tokenCount = async () =>
  Number((await db.select({ n: count() }).from(publicTokens))[0]?.n ?? 0);

beforeAll(async () => {
  await ensureDb();
  const res = await signup({
    companyName: "B5 Locks",
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
  const a = await customer("Pat Customer", "pat@example.com");
  const b = await customer("Quinn Other", "quinn@example.com");
  custA = a.customerId;
  custB = b.customerId;
  jobA = await jobFor(a, tech.id);
  jobC = await jobFor(a, tech2.id);
  jobB = await jobFor(b, tech2.id);
  invA = await invoiceFor(jobA, custA);
  invB = await invoiceFor(jobB, custB);
  const [e] = await db
    .insert(estimates)
    .values({
      number: "E-G1",
      jobId: jobB,
      customerId: custB,
      createdBy: tech2.id,
    } as never)
    .returning({ id: estimates.id });
  estB = e?.id as string;
  const [l] = await db
    .insert(leads)
    .values({ customerId: custA, name: "Pat Lead" } as never)
    .returning({ id: leads.id });
  leadA = l?.id as string;
  await db.transaction(async (tx) => {
    await writeActivity(tx, {
      entity: { type: "job", id: jobA },
      customerId: custA,
      kind: "job.note_a",
      summary: "Row on my job",
      actorUserId: null,
    });
    await writeActivity(tx, {
      entity: { type: "job", id: jobC },
      customerId: custA,
      kind: "job.note_c",
      summary: "Row on another tech's job",
      actorUserId: null,
    });
    await writeActivity(tx, {
      entity: { type: "customer", id: custA },
      kind: "customer.note",
      summary: "Customer-level row",
      actorUserId: null,
    });
    await writeActivity(tx, {
      entity: { type: "invoice", id: invB },
      customerId: custB,
      jobId: jobB,
      kind: "invoice.issued",
      summary: "Invoice of someone else",
      actorUserId: null,
    });
  });
}, 120_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

// ------------------------------------------------------------------ T5-04

describe("T5-04 activity timeline row scope", () => {
  type ActivityInput = {
    customerId?: string;
    entityType?: "invoice" | "estimate" | "vehicle" | "tool" | "lead";
    entityId?: string;
    filter: "all";
  };
  const load = (input: ActivityInput) => loadActivity(input);

  it("a tech can't read another tech's invoice, estimate, vehicle or tool timeline", async () => {
    const [v2] = await db
      .insert(vehicles)
      .values({ nickname: "Van 2", assignedUserId: tech2.id } as never)
      .returning({ id: vehicles.id });
    const [t2] = await db
      .insert(tools)
      .values({ name: "Drill", currentUserId: tech2.id } as never)
      .returning({ id: tools.id });
    auth.user = tech;
    for (const [entityType, entityId] of [
      ["invoice", invB],
      ["estimate", estB],
      ["vehicle", v2?.id as string],
      ["tool", t2?.id as string],
      ["lead", leadA],
    ] as const) {
      const r = await load({ entityType, entityId, filter: "all" });
      expect({ entityType, ok: r.ok }).toEqual({ entityType, ok: false });
    }
  });

  it("…but can read their own", async () => {
    const [v1] = await db
      .insert(vehicles)
      .values({ nickname: "Van 1", assignedUserId: tech.id } as never)
      .returning({ id: vehicles.id });
    auth.user = tech;
    expect(
      (await load({ entityType: "invoice", entityId: invA, filter: "all" })).ok,
    ).toBe(true);
    expect(
      (
        await load({
          entityType: "vehicle",
          entityId: v1?.id as string,
          filter: "all",
        })
      ).ok,
    ).toBe(true);
    auth.user = admin;
    expect(
      (await load({ entityType: "invoice", entityId: invB, filter: "all" })).ok,
    ).toBe(true);
  });

  it("a shared customer's timeline hides rows of jobs the tech isn't on", async () => {
    auth.user = tech;
    const r = await load({ customerId: custA, filter: "all" });
    expect(r.ok).toBe(true);
    const summaries = r.ok ? r.data?.items.map((i) => i.summary) : [];
    expect(summaries).toContain("Row on my job");
    expect(summaries).toContain("Customer-level row");
    expect(summaries).not.toContain("Row on another tech's job");
    auth.user = admin;
    const all = await load({ customerId: custA, filter: "all" });
    expect(all.ok ? all.data?.items.map((i) => i.summary) : []).toContain(
      "Row on another tech's job",
    );
  });
});

// ------------------------------------------------------------------ T5-06

describe("T5-06 composer link minting", () => {
  it("refuses a job of another customer or another tech, and mints nothing", async () => {
    auth.user = tech;
    const before = await tokenCount();
    for (const jobId of [jobB, jobC]) {
      const r = await prepareTemplate({
        customerId: custA,
        jobId,
        templateKey: "job.link",
        channel: "sms",
      });
      expect(r.ok).toBe(false);
    }
    expect(await tokenCount()).toBe(before);
  });

  it("refuses a lead the viewer can't see or of another customer", async () => {
    auth.user = tech;
    expect(
      (
        await prepareTemplate({
          customerId: custA,
          leadId: leadA,
          templateKey: "lead.no_answer",
          channel: "sms",
        })
      ).ok,
    ).toBe(false);
    auth.user = admin;
    expect(
      (
        await prepareTemplate({
          customerId: custB,
          leadId: leadA,
          templateKey: "lead.no_answer",
          channel: "sms",
        })
      ).ok,
    ).toBe(false);
  });

  it("sendMessage and loadComposer apply the same binding", async () => {
    auth.user = admin;
    const s = await sendMessage({
      customerId: custB,
      jobId: jobA,
      channel: "email",
      body: "Hello",
    });
    expect(s.ok).toBe(false);
    auth.user = tech;
    const l = await loadComposer({ customerId: custA, jobId: jobB });
    expect(l.ok).toBe(false);
  });

  it("still works for the tech's own job", async () => {
    auth.user = tech;
    const before = await tokenCount();
    const r = await prepareTemplate({
      customerId: custA,
      jobId: jobA,
      templateKey: "job.link",
      channel: "sms",
    });
    expect(r.ok).toBe(true);
    expect(r.ok ? r.data?.body : "").toMatch(/\/j\/[A-Za-z0-9_-]{16,}/);
    expect(await tokenCount()).toBe(before + 1);
  });
});

// ------------------------------------------------------------------ T2-08

describe("T2-08 composer templates fit the context", () => {
  it("a plain customer thread offers no job, invoice or estimate templates", async () => {
    // "Call us back at {{company.phone}}" needs a company phone to be offered.
    expect(
      (await getComposerData(custA, admin))?.templates.map((t) => t.key),
    ).not.toContain("lead.no_answer");
    await db.update(company).set({ phone: "+15125550000" });
    const d = await getComposerData(custA, admin);
    const keys = d?.templates.map((t) => t.key) ?? [];
    expect(keys).toEqual(expect.arrayContaining(["lead.no_answer"]));
    for (const k of [
      "job.checkin", // no finished work yet
      "job.link",
      "job.booked",
      "job.reminder_24h",
      "invoice.pay_link",
      "invoice.sent",
      "estimate.sent",
    ])
      expect(keys).not.toContain(k);
  });

  it("a scheduled job offers job templates, but not invoice ones without an open invoice", async () => {
    const d = await getComposerData(custA, admin, { jobId: jobA });
    const keys = d?.templates.map((t) => t.key) ?? [];
    expect(keys).toEqual(
      expect.arrayContaining(["job.link", "job.booked", "job.reminder_24h"]),
    );
    expect(keys).not.toContain("invoice.pay_link"); // invoice is a draft
    expect(keys).not.toContain("job.running_late"); // tech isn't en route
    expect(keys).not.toContain("estimate.sent");
  });

  it("an issued unpaid invoice and a sent estimate unlock their templates", async () => {
    await db
      .update(invoices)
      .set({
        status: "issued",
        issuedAt: new Date(),
        dueAt: new Date(Date.now() + 7 * 86_400_000),
        totalCents: 12_500,
        subtotalCents: 12_500,
      })
      .where(eq(invoices.id, invB));
    await db
      .update(estimates)
      .set({ status: "sent" })
      .where(eq(estimates.id, estB));
    const d = await getComposerData(custB, admin, { jobId: jobB });
    const keys = d?.templates.map((t) => t.key) ?? [];
    expect(keys).toEqual(
      expect.arrayContaining(["invoice.pay_link", "estimate.sent"]),
    );
  });
});

// ------------------------------------------------------------------ T2-17

describe("T2-17 outbox links follow APP_URL", () => {
  it("rebaseAppLinks swaps only the origin of our own token links", () => {
    const base = "https://crm.example.com";
    expect(
      rebaseAppLinks(
        "Pay: http://localhost:3000/p/abcdefghijklmnop. Receipt http://localhost:3000/i/zyxwvutsrqponmlk?receipt=42 or https://maps.google.com/x",
        base,
      ),
    ).toBe(
      "Pay: https://crm.example.com/p/abcdefghijklmnop. Receipt https://crm.example.com/i/zyxwvutsrqponmlk?receipt=42 or https://maps.google.com/x",
    );
    const same = `Tap ${base}/j/abcdefghijklmnop`;
    expect(rebaseAppLinks(same, base)).toBe(same);
  });

  it("an outbox card rendered under another origin shows the current one", async () => {
    const prev = process.env.APP_URL;
    process.env.APP_URL = "https://crm.example.com";
    try {
      await db.insert(scheduledMessages).values({
        dedupeKey: "test:seeded-card",
        templateKey: "job.reminder_24h",
        channel: "sms",
        purpose: "transactional",
        audienceType: "customer",
        recipientCustomerId: custA,
        toAddress: "+15125550142",
        entityType: "job",
        entityId: jobA,
        jobId: jobA,
        sendAt: new Date(),
        status: "pending_tap",
        driver: "link",
        assignedUserId: admin.id,
        renderedBody:
          "Reminder tomorrow. Tap http://localhost:3000/j/seedtoken12345678",
      } as never);
      auth.user = admin;
      const cards = await listOutbox("mine");
      const card = cards.find((c) => c.body.includes("seedtoken12345678"));
      expect(card?.body).toBe(
        "Reminder tomorrow. Tap https://crm.example.com/j/seedtoken12345678",
      );
    } finally {
      if (prev === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = prev;
    }
  });
});

// ------------------------------------------------------------------ T3-13 / T5-17

describe("T3-13 reply phone", () => {
  const base = {
    tech_texts_from: "tech_phone" as const,
    link_delimiter: "auto" as const,
    whatsapp_enabled: false,
    email_from_name: null,
    outbox_owner_by_template: {},
    daily_digest_time: "07:30",
    approval_batch_minutes: 15,
  };

  it("rejects text that isn't a phone number", async () => {
    auth.user = admin;
    const r = await saveMessagingSettings({ ...base, reply_phone: "call us!" });
    expect(r.ok).toBe(false);
    expect(r.ok ? null : r.fieldErrors?.reply_phone?.[0]).toMatch(/phone/i);
  });

  it("stores a valid number as E.164 and texts show it formatted", async () => {
    auth.user = admin;
    const r = await saveMessagingSettings({
      ...base,
      reply_phone: "(512) 555-0100",
    });
    expect(r.ok).toBe(true);
    expect((await getSettings()).messaging.reply_phone).toBe("+15125550100");
  });
});

describe("T5-17 review link is https only", () => {
  it("safeHttpsUrl", () => {
    expect(safeHttpsUrl("https://g.page/r/abc/review")).toBe(
      "https://g.page/r/abc/review",
    );
    expect(safeHttpsUrl("http://g.page/r/abc")).toBeNull();
    expect(safeHttpsUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpsUrl("//evil.example")).toBeNull();
    expect(safeHttpsUrl("")).toBeNull();
  });

  it("a stored non-https link is dropped when settings are read", () => {
    expect(
      parseSettings({ reviews: { google_url: "http://evil.example/r" } })
        .reviews.google_url,
    ).toBeNull();
    expect(
      parseSettings({ reviews: { google_url: "https://g.page/r/ok/review" } })
        .reviews.google_url,
    ).toBe("https://g.page/r/ok/review");
  });
});
