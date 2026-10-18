// Integration tests for the F2 backend core on a private, throwaway PGlite.
// TEST_PGLITE_ROOT (default: OS temp dir) holds the database and local uploads.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-f2-test-"),
);
process.env.PGLITE_DIR = path.join(root, "pglite");
process.env.UPLOADS_DIR = path.join(root, "uploads");
process.env.CRM_DISABLE_BACKGROUND = "1";
process.env.CRON_PIGGYBACK = "0";
process.env.AI_PROVIDER = "none";

// action() resolves the user through requireUser(); tests choose the user directly.
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

import { sql } from "drizzle-orm";
import { closeDb, db, ensureDb, execRows } from "@/db";
import {
  aiTasks,
  auditLog,
  events,
  jobQueue,
  media,
  portalAccessLog,
  sessions,
  users,
  vehicles,
} from "@/db/schema";
import { seedBase } from "@/db/seed/base";
import "@/db/seed/register";
import { queueAiTask } from "@/adapters/ai/queue";
import { getStorage } from "@/adapters/storage";
import { action } from "@/lib/action";
import { loadSessionUser } from "@/lib/auth/current";
import {
  acceptInvite,
  completePasswordReset,
  createInvite,
  getInviteByToken,
  login,
  requestPasswordReset,
  signup,
} from "@/lib/auth/flows";
import { nextNumber } from "@/lib/counters";
import { runCronHooks, runTick } from "@/lib/cron";
import {
  emit,
  MAX_EVENT_ATTEMPTS,
  processEvents,
  registerHandler,
} from "@/lib/events";
import { enqueueJob, runQueue } from "@/lib/queue";
import { rateLimit } from "@/lib/ratelimit";
import { getSettings, updateSettings } from "@/lib/settings";
import {
  mintOrReusePublicToken,
  mintPublicToken,
  resolvePublicToken,
  revokePublicTokens,
} from "@/lib/tokens";
import { type SessionUser, SYSTEM_ACTOR } from "@/lib/types";
import { completeUpload, presignUploads } from "@/lib/uploads";

const count = async (table: string) =>
  Number(
    (
      await execRows<{ n: number }>(
        sql.raw(`select count(*)::int as n from "${table}"`),
      )
    )[0]?.n ?? 0,
  );

let admin: SessionUser;
const PASSWORD = "tangerine-kayak-41";

beforeAll(async () => {
  await ensureDb();
}, 120_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

describe("base seed (boot hook)", () => {
  it("seeds roles, grants, counters, policies, plan, service types, deposit rules, tax", async () => {
    expect(await count("roles")).toBe(3);
    expect(await count("role_permissions")).toBe(3 * 114);
    expect(await count("counters")).toBe(5);
    expect(await count("policy_versions")).toBe(13);
    expect(await count("comp_plans")).toBe(1);
    expect(await count("mileage_rates")).toBe(1);
    expect(await count("service_types")).toBe(5);
    expect(await count("deposit_rules")).toBe(2);
    expect(await count("tax_rates")).toBe(1);
  });

  it("is idempotent", async () => {
    await seedBase(db);
    expect(await count("role_permissions")).toBe(342);
    expect(await count("policy_versions")).toBe(13);
  });
});

describe("signup / login / invites / reset (SPEC M01, §3.3)", () => {
  it("first signup creates the company and an admin with a session", async () => {
    const res = await signup({
      companyName: "Test Locks",
      name: "Ada Admin",
      email: "Ada@Example.com",
      password: PASSWORD,
      timezone: "America/Chicago",
      state: "tx",
    });
    expect(res).toMatchObject({ status: "active", createdCompany: true });
    expect(res.session?.cookieValue).toMatch(/^r\./);
    expect(await count("company")).toBe(1);
    const u = await loadSessionUser(
      res.userId,
      res.session?.sessionId as string,
    );
    expect(u?.email).toBe("ada@example.com");
    expect(u?.baseRole).toBe("admin");
    expect(u?.perms.has("settings.permissions")).toBe(true);
    admin = u as SessionUser;
  });

  it("later signups are invite-only unless open_signup", async () => {
    await expect(
      signup({
        companyName: "Xylo",
        name: "Eve",
        email: "eve@example.com",
        password: PASSWORD,
      }),
    ).rejects.toMatchObject({
      code: "signup_closed",
    });
    await db.transaction((tx) =>
      updateSettings(tx, { auth: { open_signup: true } }, SYSTEM_ACTOR),
    );
    const res = await signup({
      companyName: "Xylo",
      name: "Eve",
      email: "eve@example.com",
      password: PASSWORD,
    });
    expect(res).toMatchObject({ status: "pending", session: null });
    await expect(
      login({ email: "eve@example.com", password: PASSWORD }),
    ).rejects.toMatchObject({ code: "validation" });
    await db.transaction((tx) =>
      updateSettings(tx, { auth: { open_signup: false } }, SYSTEM_ACTOR),
    );
  });

  it("login verifies, records attempts and throttles 5 failures per email", async () => {
    const ok = await login(
      { email: "ada@example.com", password: PASSWORD, remember: false },
      { ip: "10.0.0.1" },
    );
    expect(ok.cookieValue).toMatch(/^s\./);
    for (let i = 0; i < 5; i++) {
      await expect(
        login(
          { email: "ada@example.com", password: "nope-nope-nope" },
          { ip: "10.0.0.2" },
        ),
      ).rejects.toMatchObject({
        code: "validation",
      });
    }
    await expect(
      login(
        { email: "ada@example.com", password: PASSWORD },
        { ip: "10.0.0.3" },
      ),
    ).rejects.toMatchObject({
      code: "rate_limited",
    });
    await expect(
      login({ email: "ghost@example.com", password: PASSWORD }),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("invite → accept (tech must acknowledge the monitoring notice)", async () => {
    const inv = await db.transaction((tx) =>
      createInvite(
        tx,
        {
          name: "Tia Tech",
          email: "tia@example.com",
          role: "tech",
          workerType: "w2",
        },
        { kind: "user", userId: admin.id },
      ),
    );
    const token = inv.url.split("/invite/")[1] as string;
    expect((await getInviteByToken(token))?.baseRole).toBe("tech");
    await expect(
      acceptInvite({ token, password: PASSWORD, esignConsent: true }),
    ).rejects.toMatchObject({ code: "validation" });
    const s = await acceptInvite({
      token,
      password: PASSWORD,
      esignConsent: true,
      monitoringAck: true,
    });
    const tech = await loadSessionUser(s.userId, s.sessionId);
    expect(tech).toMatchObject({ role: "tech", workerType: "w2" });
    expect(tech?.monitoringNoticeAckAt).toBeInstanceOf(Date);
    expect(tech?.perms.has("location.share")).toBe(true);
    await expect(
      acceptInvite({
        token,
        password: PASSWORD,
        esignConsent: true,
        monitoringAck: true,
      }),
    ).rejects.toMatchObject({
      code: "invite_invalid",
    });
    const [evt] = await db
      .select()
      .from(events)
      .where(sql`${events.type} = 'user.invited'`);
    expect(evt?.actorUserId).toBe(admin.id);
  });

  it("password reset emails a single-use link and revokes sessions", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await requestPasswordReset("tia@example.com", { ip: "10.0.0.9" });
    const logged = spy.mock.calls.map((c) => String(c[0])).join("\n");
    spy.mockRestore();
    const token = /\/reset\/([A-Za-z0-9_-]+)/.exec(logged)?.[1];
    expect(token).toBeTruthy();
    const s = await completePasswordReset({
      token: token as string,
      password: "new-tangerine-kayak",
    });
    const live = await db
      .select()
      .from(sessions)
      .where(
        sql`${sessions.userId} = ${s.userId} and ${sessions.revokedAt} is null`,
      );
    expect(live.map((r) => r.id)).toEqual([s.sessionId]);
    await expect(
      completePasswordReset({
        token: token as string,
        password: "other-tangerine-kayak",
      }),
    ).rejects.toMatchObject({
      code: "reset_invalid",
    });
    await expect(
      login({ email: "tia@example.com", password: "new-tangerine-kayak" }),
    ).resolves.toBeTruthy();
  });
});

describe("action() (SPEC §8.2)", () => {
  let runs = 0;
  const create = action({
    name: "test.create",
    perm: "customers.create",
    input: z.object({
      name: z.string().min(1),
      clientId: z.uuid().optional(),
      fail: z.boolean().optional(),
    }),
    audit: "test.created",
    async run({ input, emit: emitEvent }) {
      runs++;
      const id = crypto.randomUUID();
      await emitEvent(
        "customer.created",
        { type: "customer", id },
        { customer_id: id },
      );
      if (input.fail) throw new Error("boom");
      return { id };
    },
  });

  it("validates, authorizes, writes events + audit in one transaction", async () => {
    auth.user = admin;
    const before = await count("events");
    const res = await create({ name: "Dana" });
    expect(res.ok).toBe(true);
    expect(await count("events")).toBe(before + 1);
    const [a] = await db
      .select()
      .from(auditLog)
      .where(sql`${auditLog.action} = 'test.created'`);
    expect(a?.actorUserId).toBe(admin.id);
    expect(a?.after).toMatchObject({ name: "Dana" });
  });

  it("returns fieldErrors for bad input (FormData or object)", async () => {
    const res = await create({ name: "" });
    expect(res).toMatchObject({
      ok: false,
      fieldErrors: { name: expect.any(Array) },
    });
    const fd = new FormData();
    fd.set("name", "From form");
    expect((await create(null, fd)).ok).toBe(true); // useActionState signature
  });

  it("rolls back the whole transaction on error", async () => {
    const before = await count("events");
    const res = await create({ name: "x", fail: true });
    expect(res).toEqual({
      ok: false,
      error: "Something went wrong. Please try again.",
    });
    expect(await count("events")).toBe(before);
  });

  it("replays by clientId without running twice", async () => {
    const clientId = crypto.randomUUID();
    runs = 0;
    const a = await create({ name: "Once", clientId });
    const b = await create({ name: "Once", clientId });
    expect(runs).toBe(1);
    expect(b).toEqual(JSON.parse(JSON.stringify(a)));
  });

  it("rejects missing permissions and disabled features", async () => {
    const needsShare = action({
      perm: "location.share",
      input: z.object({}),
      run: async () => 1,
    });
    expect(await needsShare({})).toMatchObject({
      ok: false,
      error: expect.stringMatching(/permission/),
    });
    const tools = action({
      feature: "tools",
      input: z.object({}),
      run: async () => 1,
    });
    expect(await tools({})).toMatchObject({
      ok: false,
      error: expect.stringMatching(/turned off/),
    });
    await db.transaction((tx) =>
      updateSettings(tx, { features: { tools: true } }, SYSTEM_ACTOR),
    );
    expect((await getSettings()).features.tools).toBe(true);
    expect(await tools({})).toEqual({ ok: true, data: 1 });
  });
});

describe("events outbox + processor (SPEC §7.1)", () => {
  it("dispatches to handlers once and marks events processed", async () => {
    await processEvents({ now: () => new Date(Date.now() + 365 * 86_400_000) }); // drain earlier events
    const seen: string[] = [];
    const off = registerHandler({
      event: "lead.created",
      name: "test.lead",
      run: async (e) => void seen.push(e.payload.lead_id),
    });
    await db.transaction((tx) =>
      emit(
        tx,
        "lead.created",
        { type: "lead", id: crypto.randomUUID() },
        {
          lead_id: "L1",
          source_id: null,
          customer_id: null,
          service: null,
          is_returning: false,
          sms_consent: false,
        },
      ),
    );
    const r = await processEvents();
    expect(r.processed).toBeGreaterThanOrEqual(1);
    expect(seen).toEqual(["L1"]);
    await processEvents();
    expect(seen).toEqual(["L1"]);
    off();
  });

  it("handlers see the pass's clock: runTick({ now }) reaches them (QA T6-14)", async () => {
    await processEvents({ now: () => new Date(Date.now() + 365 * 86_400_000) });
    const seen: Date[] = [];
    const off = registerHandler({
      event: "lead.created",
      name: "test.clock",
      run: async (_e, ctx) => void seen.push(ctx.now),
    });
    await db.transaction((tx) =>
      emit(
        tx,
        "lead.created",
        { type: "lead", id: crypto.randomUUID() },
        {
          lead_id: "L2",
          source_id: null,
          customer_id: null,
          service: null,
          is_returning: false,
          sms_consent: false,
        },
      ),
    );
    // In the past, so the scheduler test below still finds its hooks due.
    const fake = new Date(Date.now() - 2 * 86_400_000);
    await runTick({ now: fake, source: "manual" });
    expect(seen.map((d) => d.toISOString())).toEqual([fake.toISOString()]);
    off();
  });

  it("retries failing handlers with backoff, keeps succeeded ones, then dead-letters", async () => {
    let good = 0;
    const offA = registerHandler({
      event: "digest.daily",
      name: "test.good",
      run: async () => void good++,
    });
    const offB = registerHandler({
      event: "digest.daily",
      name: "test.bad",
      run: async () => {
        throw new Error("nope");
      },
    });
    await db.transaction((tx) =>
      emit(tx, "digest.daily", null, { date: "2026-10-15" }),
    );
    let now = Date.now();
    for (let i = 0; i < MAX_EVENT_ATTEMPTS; i++) {
      await processEvents({ now: () => new Date(now) });
      now += 2 * 3600_000; // past any backoff
    }
    const [row] = await db
      .select()
      .from(events)
      .where(sql`${events.type} = 'digest.daily'`);
    expect(row?.processedAt).toBeNull();
    expect(row?.attempts).toBe(MAX_EVENT_ATTEMPTS);
    const err = JSON.parse(row?.error ?? "{}");
    expect(err.dead).toBe(true);
    // Module handlers registered for '*' (e.g. the automation engine) also succeed.
    expect(err.done).toContain("test.good");
    expect(err.done).not.toContain("test.bad");
    expect(good).toBe(1);
    offA();
    offB();
  });

  it("events in backoff never starve newer events", async () => {
    await processEvents({ now: () => new Date(Date.now() + 365 * 86_400_000) });
    const off = registerHandler({
      event: "digest.daily",
      name: "test.always_fails",
      run: async () => {
        throw new Error("down");
      },
    });
    await db.transaction(async (tx) => {
      for (let i = 0; i < 5; i++)
        await emit(tx, "digest.daily", null, { date: `2026-10-0${i + 1}` });
    });
    await processEvents(); // all five fail once and enter backoff
    const seen: string[] = [];
    const offLead = registerHandler({
      event: "lead.created",
      name: "test.lead_after_backlog",
      run: async (e) => void seen.push(e.payload.lead_id),
    });
    await db.transaction((tx) =>
      emit(
        tx,
        "lead.created",
        { type: "lead", id: crypto.randomUUID() },
        {
          lead_id: "L2",
          source_id: null,
          customer_id: null,
          service: null,
          is_returning: false,
          sms_consent: false,
        },
      ),
    );
    // A page smaller than the backlog: the old loop stopped at the first page.
    await processEvents({ batchSize: 2 });
    expect(seen).toEqual(["L2"]);
    off();
    offLead();
  });
});

describe("counters, rate limits, tokens", () => {
  it("nextNumber is gapless and rollback-safe", async () => {
    const a = await db.transaction((tx) => nextNumber(tx, "job"));
    await db
      .transaction(async (tx) => {
        await nextNumber(tx, "job");
        throw new Error("rollback");
      })
      .catch(() => undefined);
    const b = await db.transaction((tx) => nextNumber(tx, "job"));
    expect([a, b]).toEqual(["J-1001", "J-1002"]);
  });

  it("fixed-window rate limit (db + memory)", async () => {
    const o = { key: "t:1", limit: 2, windowSec: 60 };
    expect((await rateLimit(o)).ok).toBe(true);
    expect((await rateLimit(o)).ok).toBe(true);
    expect(await rateLimit(o)).toMatchObject({ ok: false, remaining: 0 });
    const m = { ...o, key: "t:m", store: "memory" as const };
    await rateLimit(m);
    await rateLimit(m);
    expect((await rateLimit(m)).ok).toBe(false);
  });

  it("public magic links: mint, resolve (logged), wrong kind, revoke", async () => {
    const entity = { type: "job" as const, id: crypto.randomUUID() };
    const t = await db.transaction((tx) =>
      mintPublicToken(tx, { kind: "job", entity, jobId: entity.id }),
    );
    expect(t.url).toMatch(/\/j\/[A-Za-z0-9_-]{43}$/);
    const row = await resolvePublicToken("job", t.token, {
      path: "/j/x",
      action: "viewed",
      ip: "1.2.3.4",
    });
    expect(row?.useCount).toBe(1);
    expect(await count("portal_access_log")).toBe(1);
    expect(
      await resolvePublicToken("invoice", t.token, {
        path: "/i/x",
        action: "viewed",
      }),
    ).toBeNull();
    await db.transaction((tx) => revokePublicTokens(tx, { jobId: entity.id }));
    expect(
      await resolvePublicToken("job", t.token, {
        path: "/j/x",
        action: "viewed",
      }),
    ).toBeNull();
    expect((await db.select().from(portalAccessLog)).length).toBe(1);
  });
});

describe("reusable magic links (QA T4-28)", () => {
  it("same entity + purpose → same token within a bucket; unguessable; revoked → fresh", async () => {
    const entity = { type: "invoice" as const, id: crypto.randomUUID() };
    const now = new Date("2026-10-17T12:00:00Z");
    const mint = (purpose: string, at = now) =>
      db.transaction((tx) =>
        mintOrReusePublicToken(
          tx,
          { kind: "pay", entity, purpose, ttlMs: 7 * 86_400_000 },
          at,
        ),
      );
    const a = await mint("invoice.print");
    const b = await mint("invoice.print", new Date(now.getTime() + 3_600_000));
    expect(a.reused).toBe(false);
    expect(b).toMatchObject({
      token: a.token,
      tokenId: a.tokenId,
      reused: true,
    });
    expect(a.url).toMatch(/\/p\/[A-Za-z0-9_-]{43}$/);
    // Another purpose or the next bucket is another token.
    expect((await mint("invoice.email")).token).not.toBe(a.token);
    const later = await mint(
      "invoice.print",
      new Date(now.getTime() + 4 * 86_400_000),
    );
    expect(later.token).not.toBe(a.token);
    // Stored hashed only.
    const raw = await execRows<{ n: number }>(
      sql`select count(*)::int as n from public_tokens where token_hash = ${a.token}`,
    );
    expect(raw[0]?.n).toBe(0);
    // Revoked: a fresh random token, not the revoked one.
    await db.transaction((tx) =>
      revokePublicTokens(tx, { kind: "pay", entity }),
    );
    const c = await mint("invoice.print", new Date(now.getTime() + 7_200_000));
    expect(c.token).not.toBe(a.token);
    expect(c.reused).toBe(false);
  });
});

describe("scheduler + queue (SPEC §3.1)", () => {
  it("runTick runs hooks once per window", async () => {
    const r = await runTick({ source: "manual" });
    expect(r.ran).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.hooks?.["system.prune"]).toBe("ok");
    const again = await runCronHooks(new Date());
    expect(again["system.prune"]).toBe("not_due");
  });

  it("queue dedupe + AI worker applies the policy layer (AI_PROVIDER=none)", async () => {
    expect(
      await enqueueJob(null, "geocode", { a: 1 }, { dedupeKey: "geo:1" }),
    ).not.toBeNull();
    expect(
      await enqueueJob(null, "geocode", { a: 1 }, { dedupeKey: "geo:1" }),
    ).toBeNull();
    const t = await db.transaction((tx) =>
      queueAiTask(tx, {
        kind: "odometer",
        mediaIds: [],
        ref: {
          module: "vehicles",
          entityType: "odometer",
          entityId: crypto.randomUUID(),
        },
      }),
    );
    const res = await runQueue({ timeBudgetMs: 5_000 });
    expect(res.ran).toBeGreaterThanOrEqual(2); // geocode (B1 worker: no propertyId → no-op) + ai
    const [task] = await db
      .select()
      .from(aiTasks)
      .where(sql`${aiTasks.id} = ${t.aiTaskId}`);
    expect(task?.status).toBe("skipped_policy");
    const [geo] = await db
      .select()
      .from(jobQueue)
      .where(sql`${jobQueue.dedupeKey} = 'geo:1'`);
    expect(geo?.status).not.toBe("queued");
  });
});

describe("uploads (SPEC §8.1, M11)", () => {
  it("presign → PUT → complete creates one media row (idempotent)", async () => {
    const clientId = crypto.randomUUID();
    const [f] = await presignUploads(admin, {
      files: [
        {
          name: "me.png",
          mime: "image/png",
          bytes: 4,
          sha256: "a".repeat(64),
          kind: "avatar",
          clientId,
        },
      ],
    });
    expect(f?.upload_url).toMatch(/^\/api\/uploads\/local\/media\//);
    await getStorage().put(
      f?.key as string,
      new Uint8Array([1, 2, 3, 4]),
      "image/png",
    );
    const input = {
      mediaId: f?.mediaId as string,
      clientId,
      key: f?.key as string,
      uploadToken: f?.upload_token as string,
      kind: "avatar" as const,
      mime: "image/png" as const,
      bytes: 4,
      sha256Original: "a".repeat(64),
    };
    const first = await completeUpload(admin, input);
    expect(first).toMatchObject({ created: true, flags: ["no_geo"] });
    expect((await completeUpload(admin, input)).created).toBe(false);
    expect(await db.select().from(media)).toHaveLength(1);
    await expect(
      completeUpload(admin, {
        ...input,
        clientId: crypto.randomUUID(),
        uploadToken: `${Date.now()}.forged`,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("signs the untouched original with its own type", async () => {
    const [f] = await presignUploads(admin, {
      files: [
        {
          name: "IMG_1.heic",
          mime: "image/webp",
          bytes: 4,
          sha256: "b".repeat(64),
          kind: "avatar",
          clientId: crypto.randomUUID(),
          withThumb: true,
          withOriginal: true,
          originalMime: "image/heic",
        },
      ],
    });
    expect(f?.key).toMatch(/\.webp$/);
    expect(f?.original_key).toMatch(/_orig\.heic$/);
    expect(f?.original_upload_url).toContain("m=image%2Fheic");
    expect(f?.thumb_upload_url).toContain("m=image%2Fwebp");
  });

  it("the token binds entity, kind and size; row access is re-checked (QA T5-12a)", async () => {
    const clientId = crypto.randomUUID();
    // A real entity type (QA2 NEW-1: types without a rule are refused).
    const entity = { type: "user", id: admin.id };
    const [f] = await presignUploads(admin, {
      files: [
        {
          name: "d.png",
          mime: "image/png",
          bytes: 4,
          sha256: "c".repeat(64),
          kind: "avatar",
          clientId,
        },
      ],
      entity,
    });
    // v3 also binds the stored-bytes hash (QA2 NEW-2).
    expect(f?.upload_token).toMatch(/^v3\./);
    await getStorage().put(
      f?.key as string,
      new Uint8Array([1, 2, 3, 4]),
      "image/png",
    );
    const input = {
      mediaId: f?.mediaId as string,
      clientId,
      key: f?.key as string,
      uploadToken: f?.upload_token as string,
      kind: "avatar" as const,
      mime: "image/png" as const,
      bytes: 4,
      sha256Original: "c".repeat(64),
      entity,
    };
    for (const tampered of [
      { entity: { type: "user", id: crypto.randomUUID() } },
      { entity: null },
      { jobId: crypto.randomUUID() },
      { kind: "document" as const },
      { bytes: 3 },
    ])
      await expect(
        completeUpload(admin, { ...input, ...tampered }),
      ).rejects.toMatchObject({ code: "forbidden" });
    expect((await completeUpload(admin, input)).created).toBe(true);

    // A tech can't presign onto a vehicle assigned to someone else.
    const tech = (await loadSessionUser(
      (
        await db
          .select()
          .from(users)
          .where(sql`${users.email} = 'tia@example.com'`)
      )[0]?.id as string,
      "s",
    )) as SessionUser;
    const [v] = await db
      .insert(vehicles)
      .values({ nickname: "Van 9", assignedUserId: admin.id })
      .returning({ id: vehicles.id });
    await expect(
      presignUploads(tech, {
        files: [
          {
            name: "o.jpg",
            mime: "image/jpeg",
            bytes: 10,
            sha256: "d".repeat(64),
            kind: "photo",
            tag: "odometer",
            clientId: crypto.randomUUID(),
          },
        ],
        entity: { type: "vehicle", id: v?.id as string },
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("job photos require photos.upload and an accessible job", async () => {
    const tech = (await loadSessionUser(
      (
        await db
          .select()
          .from(users)
          .where(sql`${users.email} = 'tia@example.com'`)
      )[0]?.id as string,
      "s",
    )) as SessionUser;
    await expect(
      presignUploads(tech, {
        files: [
          {
            name: "a.jpg",
            mime: "image/jpeg",
            bytes: 10,
            sha256: "b".repeat(64),
            kind: "photo",
            tag: "before",
            clientId: crypto.randomUUID(),
          },
        ],
        jobId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
