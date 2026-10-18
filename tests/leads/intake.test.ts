// B1 lead intake integration tests on a private, throwaway PGlite: the §8.3 pipeline
// through the real route handlers (JSON API, form post, hooks), dedupe windows,
// spam handling, CORS, and the lead actions (claim / call / lost / convert).
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-b1-leads-"),
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
import { leadEvents, leadSources, leads } from "@/db/schema";
import "@/db/seed/register";
import { POST as hookPost } from "@/app/api/v1/hooks/[preset]/[secret]/route";
import {
  GET as formGet,
  POST as formPost,
} from "@/app/api/v1/leads/f/[publicKey]/route";
import { OPTIONS, POST } from "@/app/api/v1/leads/route";
import {
  claimLead,
  createApiKey,
  createLeadSource,
  logLeadCall,
  markLeadLost,
  markLeadNotSpam,
  prepareLeadConversion,
} from "@/features/leads/actions";
import { runLeadSla } from "@/features/leads/cron";
import { signTs } from "@/features/leads/intake/spam";
import { tsSecret } from "@/features/leads/keys";
import { leadCounts, listLeads } from "@/features/leads/queries";
import { loadSessionUser } from "@/lib/auth/current";
import { signup } from "@/lib/auth/flows";
import type { SessionUser } from "@/lib/types";

let admin: SessionUser;
let pk = "";
let sk = "";
let plainPk = "";
let hookSecret = "";
let ip = 0;

const nextIp = () => `10.0.0.${++ip}`;

function jsonReq(body: unknown, headers: Record<string, string>) {
  return new Request("https://crm.test/api/v1/leads", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": nextIp(),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function formReq(
  key: string,
  fields: Record<string, string>,
  h: Record<string, string> = {},
) {
  return new Request(`https://crm.test/api/v1/leads/f/${key}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-forwarded-for": nextIp(),
      ...h,
    },
    body: new URLSearchParams(fields).toString(),
  });
}

const ctx = (publicKey: string) => ({ params: Promise.resolve({ publicKey }) });

beforeAll(async () => {
  await ensureDb();
  const res = await signup({
    companyName: "Test Locks",
    name: "Ada Admin",
    email: "ada@example.com",
    password: "tangerine-kayak-41",
    timezone: "America/Chicago",
    state: "TX",
  });
  admin = (await loadSessionUser(
    res.userId,
    res.session?.sessionId as string,
  )) as SessionUser;
  auth.user = admin;
  const web = await createLeadSource({
    name: "Website",
    kind: "website",
    integrationKind: "js_snippet",
    allowedOrigins: ["acme.example"],
  });
  if (!web.ok) throw new Error(web.error);
  pk = web.data?.secrets.publicKey as string;
  const api = await createLeadSource({
    name: "Partner API",
    kind: "referral",
    integrationKind: "json_api",
  });
  if (!api.ok) throw new Error(api.error);
  sk = api.data?.secrets.secretKey as string;
  const plain = await createLeadSource({
    name: "Static site",
    kind: "website",
    integrationKind: "plain_form",
  });
  if (!plain.ok) throw new Error(plain.error);
  plainPk = plain.data?.secrets.publicKey as string;
  const tt = await createLeadSource({
    name: "Thumbtack",
    kind: "thumbtack",
    integrationKind: "preset",
    preset: "thumbtack",
  });
  if (!tt.ok) throw new Error(tt.error);
  hookSecret = tt.data?.secrets.hookSecret as string;
}, 120_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

describe("JSON API (POST /api/v1/leads)", () => {
  it("rejects calls without a key", async () => {
    const r = await POST(jsonReq({ name: "X" }, {}));
    expect(r.status).toBe(401);
  });

  it("creates a lead + customer with a secret key (201)", async () => {
    const r = await POST(
      jsonReq(
        {
          name: "Dana Lee",
          phone: "(512) 555-7788",
          address: "12 Oak St, Austin, TX 78701",
          service_type: "Rekey",
          price: "$149",
          preferred_date: "2026-10-20",
          notes: "3 locks",
          external_id: "site-4411",
          sms_consent: true,
          utm_source: "google",
          favorite_color: "blue",
        },
        { authorization: `Bearer ${sk}` },
      ),
    );
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.status).toBe("created");
    expect(body.customer_id).toBeTruthy();
    const [l] = await db.select().from(leads).where(eq(leads.id, body.id));
    expect(l?.phone).toBe("+15125557788");
    expect(l?.quotedPriceCents).toBe(14900);
    expect(l?.preferredDate).toBe("2026-10-20");
    expect(l?.extra).toMatchObject({ favorite_color: "blue" });
    expect(l?.attribution).toMatchObject({ utm_source: "google" });
    expect(l?.propertyId).toBeTruthy();
    const ev = await db
      .select()
      .from(leadEvents)
      .where(eq(leadEvents.leadId, body.id));
    expect(ev.some((e) => e.kind === "received")).toBe(true);
    const consent = await execRows<{ n: number }>(
      sql`select count(*)::int as n from consent_events where customer_id = ${body.customer_id}`,
    );
    expect(Number(consent[0]?.n)).toBeGreaterThanOrEqual(1);
  });

  it("same external_id → merged (200), no duplicate", async () => {
    const r = await POST(
      jsonReq(
        { name: "Dana Lee", phone: "5125557788", external_id: "site-4411" },
        { authorization: `Bearer ${sk}` },
      ),
    );
    expect(r.status).toBe(200);
    expect((await r.json()).status).toBe("merged");
    const n = await execRows<{ n: number }>(
      sql`select count(*)::int as n from leads where external_id = 'site-4411'`,
    );
    expect(Number(n[0]?.n)).toBe(1);
  });

  it("double submit within 10 min (phone+service) → merged", async () => {
    const a = await POST(
      jsonReq(
        { name: "Sam Ray", phone: "512-555-0142", service: "Lockout" },
        { authorization: `Bearer ${sk}` },
      ),
    );
    expect(a.status).toBe(201);
    const b = await POST(
      jsonReq(
        { name: "Sam Ray", phone: "+1 512 555 0142", service: "lockout" },
        { authorization: `Bearer ${sk}` },
      ),
    );
    expect(b.status).toBe(200);
    expect((await b.json()).status).toBe("merged");
  });

  it("returning customer with an open lead for the same service → touch + returning", async () => {
    // Age the existing lead past the 10-minute dedupe window.
    await db.execute(
      sql`update leads set created_at = now() - interval '2 hours', dedupe_hash = null where phone = '+15125550142'`,
    );
    const r = await POST(
      jsonReq(
        { name: "Sam Ray", phone: "5125550142", service: "Lockout" },
        { authorization: `Bearer ${sk}` },
      ),
    );
    expect(r.status).toBe(200);
    const id = (await r.json()).id as string;
    const [l] = await db.select().from(leads).where(eq(leads.id, id));
    expect(l?.isReturning).toBe(true);
    const touches = await db
      .select()
      .from(leadEvents)
      .where(eq(leadEvents.leadId, id));
    expect(touches.filter((t) => t.kind === "touch").length).toBeGreaterThan(0);
  });

  it("400 with field errors for a malformed phone (JSON only)", async () => {
    const r = await POST(
      jsonReq(
        { name: "Bad", phone: "12", email: "nope" },
        { authorization: `Bearer ${sk}` },
      ),
    );
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.errors.phone).toBeTruthy();
    expect(body.errors.email).toBeTruthy();
  });

  it("public key from a disallowed origin → 403; allowed origin → CORS echo", async () => {
    const bad = await POST(
      jsonReq(
        {
          name: "Eve",
          phone: "5125550199",
          _ts: signTs(tsSecret(), pk, Date.now() - 10_000),
        },
        { "x-site-key": pk, origin: "https://evil.example" },
      ),
    );
    expect(bad.status).toBe(403);
    const ok = await POST(
      jsonReq(
        {
          name: "Ann Fox",
          phone: "5125550188",
          _ts: signTs(tsSecret(), pk, Date.now() - 10_000),
        },
        { "x-site-key": pk, origin: "https://www.acme.example" },
      ),
    );
    // Site-key (browser) callers get a uniform 200 "received" (T5-18): no ids, and
    // no hint whether the person is already a customer.
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ status: "received" });
    const again = await POST(
      jsonReq(
        {
          name: "Ann Fox",
          phone: "5125550188",
          _ts: signTs(tsSecret(), pk, Date.now() - 10_000),
        },
        { "x-site-key": pk, origin: "https://www.acme.example" },
      ),
    );
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ status: "received" });
    expect(ok.headers.get("access-control-allow-origin")).toBe(
      "https://www.acme.example",
    );
    const pre = await OPTIONS(
      new Request("https://crm.test/api/v1/leads", {
        method: "OPTIONS",
        headers: { origin: "https://www.acme.example" },
      }),
    );
    expect(pre.status).toBe(204);
    expect(pre.headers.get("vary")).toContain("Origin");
    expect(pre.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("general API key (api_keys) works", async () => {
    const k = await createApiKey({ name: "Zapier", scopes: ["leads:write"] });
    if (!k.ok) throw new Error(k.error);
    const r = await POST(
      jsonReq(
        { name: "Kim Park", phone: "5125550177", source: "Partner API" },
        { authorization: `Bearer ${k.data?.key}` },
      ),
    );
    expect(r.status).toBe(201);
  });

  // QA2 re-check: an empty JSON body made an "Unknown · Service not given" lead in
  // Check and notified the office ("New lead: service request").
  it("no phone or email → uniform 200, kept as spam, never notifies", async () => {
    const createdEvents = async () =>
      Number(
        (
          await execRows<{ n: number }>(
            sql`select count(*)::int as n from events where type = 'lead.created'`,
          )
        )[0]?.n ?? 0,
      );
    const before = await createdEvents();
    const empty = await POST(
      jsonReq({}, { "x-site-key": pk, origin: "https://www.acme.example" }),
    );
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ status: "received" });
    const nameOnly = await POST(
      jsonReq(
        { name: "Nobody Reachable", service: "Lockout" },
        { authorization: `Bearer ${sk}` },
      ),
    );
    expect(nameOnly.status).toBe(200);
    expect(await nameOnly.json()).toEqual({ status: "received" });
    const rows = await execRows<{
      name: string | null;
      status: string;
      spam_reason: string | null;
      customer_id: string | null;
    }>(
      sql`select name, status, spam_reason, customer_id from leads where phone is null and email is null order by created_at desc limit 2`,
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.status).toBe("spam");
      expect(r.spam_reason).toBe("no_contact");
      expect(r.customer_id).toBeNull();
    }
    expect(rows.map((r) => r.name)).toEqual(
      expect.arrayContaining([null, "Nobody Reachable"]),
    );
    expect(await createdEvents()).toBe(before);
  });

  it("a mistyped phone (no email) on a form stays a lead in Check, not spam", async () => {
    const r = await formPost(
      formReq(plainPk, { name: "Tia Typo", phone: "555-12" }),
      ctx(plainPk),
    );
    expect(r.status).toBe(303);
    const [l] = await db.select().from(leads).where(eq(leads.name, "Tia Typo"));
    expect(l?.status).toBe("new");
    expect(l?.spamReason ?? "").not.toContain("no_contact,");
  });

  it("body over 32 KB → 413", async () => {
    const r = await POST(
      jsonReq(
        { name: "Big", notes: "x".repeat(40_000) },
        { authorization: `Bearer ${sk}` },
      ),
    );
    expect(r.status).toBe(413);
  });

  it("chunked multipart body without Content-Length is capped too (T5-18)", async () => {
    const enc = new TextEncoder();
    const boundary = "----crmtest";
    const big = "x".repeat(8_000);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent === 0)
          c.enqueue(
            enc.encode(
              `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nBig\r\n--${boundary}\r\nContent-Disposition: form-data; name="notes"\r\n\r\n`,
            ),
          );
        if (sent < 10) {
          c.enqueue(enc.encode(big));
          sent++;
        } else {
          c.enqueue(enc.encode(`\r\n--${boundary}--\r\n`));
          c.close();
        }
      },
    });
    const r = await POST(
      new Request("https://crm.test/api/v1/leads", {
        method: "POST",
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
          authorization: `Bearer ${sk}`,
          "x-forwarded-for": nextIp(),
        },
        body: stream,
        duplex: "half",
      } as RequestInit & { duplex: "half" }),
    );
    expect(r.status).toBe(413);
  });
});

describe("form endpoint (POST /api/v1/leads/f/[pk])", () => {
  it("plain HTML form without _ts is NOT spam; 303 to the hosted thanks page", async () => {
    const r = await formPost(
      formReq(plainPk, {
        name: "Pat Static",
        phone: "512 555 0166",
        service_type: "Lockout",
        sms_consent: "on",
        company_website: "",
      }),
      ctx(plainPk),
    );
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe(
      `https://crm.test/f/${plainPk}/thanks`,
    );
    const [l] = await db
      .select()
      .from(leads)
      .where(eq(leads.phone, "+15125550166"));
    expect(l?.status).toBe("new");
    expect(l?.smsConsent).toBe(true);
  });

  it("honeypot filled → stored as spam, fake 303 success", async () => {
    const r = await formPost(
      formReq(plainPk, {
        name: "Bot",
        phone: "5125550155",
        company_website: "http://x.y",
      }),
      ctx(plainPk),
    );
    expect(r.status).toBe(303);
    const [l] = await db
      .select()
      .from(leads)
      .where(eq(leads.phone, "+15125550155"));
    expect(l?.status).toBe("spam");
    expect(l?.customerId).toBeNull();
  });

  it("snippet source (require_ts) without _ts → Check, never spam (QA2 T2-04); with a valid _ts → lead", async () => {
    const h = { origin: "https://acme.example" };
    const plain = await formPost(
      formReq(
        pk,
        { name: "No Ts", phone: "5125550144", sms_consent: "on" },
        { ...h, referer: "https://acme.example/contact?x=1#top" },
      ),
      ctx(pk),
    );
    expect(plain.status).toBe(303);
    const [check] = await db
      .select()
      .from(leads)
      .where(eq(leads.phone, "+15125550144"));
    expect(check?.status).toBe("new");
    expect(check?.spamScore).toBeGreaterThanOrEqual(50);
    expect(check?.spamReason).toContain("ts_missing");
    expect(check?.customerId).toBeNull();
    // Shows under "Check", not in the inbox.
    const inCheck = await listLeads(admin, { view: "check" });
    expect(inCheck.items.some((i) => i.id === check?.id)).toBe(true);
    const inInbox = await listLeads(admin, { view: "inbox" });
    expect(inInbox.items.some((i) => i.id === check?.id)).toBe(false);
    // Page URL from the Referer; consent text names the business (T2-13).
    expect(check?.attribution).toMatchObject({
      page_url: "https://acme.example/contact?x=1",
    });
    expect(String(check?.extra?._consent_text)).toContain(
      "text messages from Test Locks",
    );
    // "Looks legit" creates the customer and records consent with the original evidence.
    const ok = await markLeadNotSpam({ leadId: check?.id as string });
    expect(ok.ok).toBe(true);
    const ce = await execRows<{
      text_shown: string;
      page_url: string | null;
      ip: string | null;
    }>(
      sql`select text_shown, page_url, ip from consent_events
          where customer_id = ${ok.ok ? ok.data?.customerId : null} and channel = 'sms'`,
    );
    expect(ce[0]?.text_shown).toContain("from Test Locks");
    expect(ce[0]?.page_url).toBe("https://acme.example/contact?x=1");
    expect(ce[0]?.ip).toMatch(/^10\.0\.0\./);
    // A tampered _ts is still hard spam.
    await formPost(
      formReq(
        pk,
        {
          name: "Forged",
          phone: "5125550145",
          _ts: "1760000000000.AAAAAAAAAAAAAAAAAAAAAA",
        },
        h,
      ),
      ctx(pk),
    );
    const [forged] = await db
      .select()
      .from(leads)
      .where(eq(leads.phone, "+15125550145"));
    expect(forged?.status).toBe("spam");
    expect(forged?.spamReason).toBe("ts_bad_signature");
    const ts = signTs(tsSecret(), pk, Date.now() - 5_000);
    const r = await formPost(
      formReq(
        pk,
        { name: "Has Ts", phone: "5125550133", _ts: ts },
        {
          ...h,
          "x-requested-with": "crm-embed",
        },
      ),
      ctx(pk),
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: "received" });
    const [real] = await db
      .select()
      .from(leads)
      .where(eq(leads.phone, "+15125550133"));
    expect(real?.status).toBe("new");
    expect(real?.customerId).toBeTruthy();
    expect(r.headers.get("access-control-allow-origin")).toBe(
      "https://acme.example",
    );
  });

  it("GET returns a signed _ts and the consent wording", async () => {
    const r = await formGet(
      new Request(`https://crm.test/api/v1/leads/f/${pk}`, {
        headers: { origin: "https://acme.example" },
      }),
      ctx(pk),
    );
    const body = await r.json();
    expect(body.ts).toMatch(/^\d+\./);
    expect(body.consent).toContain("STOP");
  });

  it("redirect is honored only for allow-listed origins", async () => {
    const ts = signTs(tsSecret(), pk, Date.now() - 5_000);
    const ok = await formPost(
      formReq(
        pk,
        {
          name: "Red Ir",
          phone: "5125550122",
          _ts: ts,
          redirect: "https://acme.example/thanks.html",
        },
        { origin: "https://acme.example" },
      ),
      ctx(pk),
    );
    expect(ok.headers.get("location")).toBe("https://acme.example/thanks.html");
    const bad = await formPost(
      formReq(
        pk,
        {
          name: "Red Two",
          phone: "5125550121",
          _ts: ts,
          redirect: "https://evil.example/",
        },
        { origin: "https://acme.example" },
      ),
      ctx(pk),
    );
    expect(bad.headers.get("location")).toBe(`https://crm.test/f/${pk}/thanks`);
  });
});

describe("preset hooks", () => {
  it("thumbtack: maps the payload and stores leadPrice as source cost", async () => {
    const r = await hookPost(
      new Request("https://crm.test/hook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leadID: "tt-77",
          leadPrice: "$22.00",
          customer: { name: "Tia Thumb", phone: "5125550111" },
          request: { category: "Locksmith", location: { zipCode: "78701" } },
        }),
      }),
      { params: Promise.resolve({ preset: "thumbtack", secret: hookSecret }) },
    );
    expect(r.status).toBe(201);
    const [l] = await db
      .select()
      .from(leads)
      .where(eq(leads.externalId, "tt-77"));
    expect(l?.sourceCostCents).toBe(2200);
    expect(l?.name).toBe("Tia Thumb");
  });

  it("wrong secret → 401", async () => {
    const r = await hookPost(
      new Request("https://crm.test/hook", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ preset: "thumbtack", secret: "hk_nope" }) },
    );
    expect(r.status).toBe(401);
  });
});

describe("inbox actions", () => {
  it("lists SLA-sorted leads and counts", async () => {
    const { items } = await listLeads(admin, { view: "inbox" });
    expect(items.length).toBeGreaterThan(0);
    const counts = await leadCounts(admin);
    expect(counts.spam).toBeGreaterThanOrEqual(2);
  });

  it("claim, call (no answer → retry task + contacted), lost", async () => {
    const [l] = await db
      .select()
      .from(leads)
      .where(eq(leads.phone, "+15125550166"));
    const id = l?.id as string;
    expect((await claimLead({ leadId: id })).ok).toBe(true);
    const call = await logLeadCall({ leadId: id, outcome: "no_answer" });
    expect(call.ok).toBe(true);
    const [after] = await db.select().from(leads).where(eq(leads.id, id));
    expect(after?.status).toBe("contacted");
    expect(after?.firstResponseAt).toBeTruthy();
    expect(after?.assignedUserId).toBe(admin.id);
    const tasks = await execRows<{ n: number }>(
      sql`select count(*)::int as n from tasks where kind = 'lead_retry' and entity_id = ${id}`,
    );
    expect(Number(tasks[0]?.n)).toBe(1);
    const lost = await markLeadLost({ leadId: id, reason: "price" });
    expect(lost.ok).toBe(true);
    const [l2] = await db.select().from(leads).where(eq(leads.id, id));
    expect(l2?.status).toBe("lost");
    expect(l2?.lostReason).toBe("price");
  });

  it("not spam → creates the customer; convert → /jobs/new link", async () => {
    const [l] = await db
      .select()
      .from(leads)
      .where(eq(leads.phone, "+15125550155"));
    const r = await markLeadNotSpam({ leadId: l?.id as string });
    expect(r.ok && r.data?.customerId).toBeTruthy();
    const c = await prepareLeadConversion({
      leadId: l?.id as string,
      to: "job",
    });
    expect(c.ok && c.data?.href).toMatch(/^\/jobs\/new\?leadId=/);
  });

  it("SLA cron emits 5 and 15 min breaches once", async () => {
    await db.execute(
      sql`update leads set created_at = now() - interval '20 minutes' where phone = '+15125550133'`,
    );
    const now = new Date();
    const first = await runLeadSla(now);
    expect(first).toBeGreaterThanOrEqual(2);
    const second = await runLeadSla(now);
    expect(second).toBe(0);
  });
});

describe("sources", () => {
  it("plain-form sources default to require_ts=false, snippet ones to true", async () => {
    const rows = await db.select().from(leadSources);
    expect(
      rows.find((r) => r.integrationKind === "plain_form")?.requireTs,
    ).toBe(false);
    expect(
      rows.find((r) => r.integrationKind === "js_snippet")?.requireTs,
    ).toBe(true);
  });
});
