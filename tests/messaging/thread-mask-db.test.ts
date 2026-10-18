// Message threads follow contact-window masking (QA2 NEW-3) on a throwaway PGlite:
// a tech outside the window sees no street number or live /j/ link; staff with
// customers.contact_view and a tech inside the window see the text unchanged.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-thread-mask-"),
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

import { eq } from "drizzle-orm";
import { closeDb, db, ensureDb } from "@/db";
import {
  customers,
  jobAssignments,
  jobs,
  messages,
  properties,
} from "@/db/schema";
import "@/db/seed/register";
import {
  getJobThread,
  getThread,
  listThreads,
} from "@/features/messaging/queries";
import { loadSessionUser } from "@/lib/auth/current";
import { acceptInvite, createInvite, signup } from "@/lib/auth/flows";
import { type SessionUser, SYSTEM_ACTOR } from "@/lib/types";

const PASSWORD = "tangerine-kayak-41";
const BODY =
  "Booked: Installation on Oct 24 at 3943 Airport Blvd. Details/reschedule: https://crm.example.com/j/Y-98jAbcdefgh123";
let admin: SessionUser;
let tech: SessionUser;
let customerId: string;
let jobId: string;

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
  const s = await signup({
    companyName: "Thread Co",
    name: "Ada Admin",
    email: "ada@example.com",
    password: PASSWORD,
    timezone: "America/Chicago",
    state: "tx",
  });
  admin = (await loadSessionUser(s.userId, "s")) as SessionUser;
  tech = await invite("Tia Tech", "tia@example.com");
  const [c] = await db
    .insert(customers)
    .values({ displayName: "Mason Nguyen", phone: "+15125552011" })
    .returning({ id: customers.id });
  customerId = c?.id as string;
  const [p] = await db
    .insert(properties)
    .values({
      customerId,
      street: "3943 Airport Blvd",
      city: "Austin",
      state: "TX",
      zip: "78702",
    })
    .returning({ id: properties.id });
  // Next week: outside the tech's contact window (2 h before the visit).
  const [j] = await db
    .insert(jobs)
    .values({
      number: "J-M1",
      customerId,
      propertyId: p?.id as string,
      title: "Installation",
      status: "scheduled",
      scheduledStart: new Date(Date.now() + 7 * 86_400_000),
    })
    .returning({ id: jobs.id });
  jobId = j?.id as string;
  await db.insert(jobAssignments).values({ jobId, userId: tech.id });
  await db.insert(messages).values({
    customerId,
    jobId,
    direction: "out",
    channel: "sms",
    driver: "link",
    purpose: "transactional",
    body: BODY,
    status: "sent_manual",
  });
}, 120_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

describe("thread masking (QA2 NEW-3)", () => {
  it("a tech outside the window gets redacted bodies everywhere", async () => {
    auth.user = tech;
    const t = await getThread(customerId);
    expect(t.masked).toBe(true);
    const body = t.messages[0]?.body ?? "";
    expect(body).toContain("••• Airport Blvd");
    expect(body).not.toContain("3943");
    expect(body).not.toContain("/j/");
    const jobThread = await getJobThread(jobId, tech);
    expect(jobThread[0]?.body).not.toContain("/j/");
    const list = await listThreads({});
    expect(list[0]?.lastBody).not.toContain("3943");
  });

  it("staff with contact_view see it unchanged", async () => {
    auth.user = admin;
    const t = await getThread(customerId);
    expect(t.masked).toBe(false);
    expect(t.messages[0]?.body).toBe(BODY);
    expect((await getJobThread(jobId, admin))[0]?.body).toBe(BODY);
  });

  it("inside the window the tech sees the text", async () => {
    await db
      .update(jobs)
      .set({ scheduledStart: new Date(Date.now() + 3600_000) })
      .where(eq(jobs.id, jobId));
    auth.user = tech;
    const t = await getThread(customerId);
    expect(t.masked).toBe(false);
    expect(t.messages[0]?.body).toBe(BODY);
  });
});
