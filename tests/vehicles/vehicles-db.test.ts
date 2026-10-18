// B7 integration tests on a throwaway PGlite (QA round 2):
//  - T5-15: saveTrip never overwrites an approved (reimbursed) or in-review trip
//  - T1-10: the default odometer policy auto-approves a normal reading with a photo
//  - T6-08: document expiry warnings fire once per window and catch up
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-b7-test-"),
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

import { and, eq, sql } from "drizzle-orm";
import { closeDb, db, ensureDb, execRows } from "@/db";
import {
  ledgerEntries,
  media,
  odometerReadings,
  trips,
  vehicleDocuments,
  vehicles,
} from "@/db/schema";
import "@/db/seed/register";
import {
  logOdometer,
  saveTrip,
  saveVehicle,
} from "@/features/vehicles/actions";
import { cronHooks } from "@/features/vehicles/cron";
import { loadSessionUser } from "@/lib/auth/current";
import { acceptInvite, createInvite, signup } from "@/lib/auth/flows";
import { addDaysToKey, dateKey } from "@/lib/time";
import { type SessionUser, SYSTEM_ACTOR } from "@/lib/types";

const TZ = "America/Chicago";
const PASSWORD = "tangerine-kayak-41";
let tech: SessionUser;
let admin: SessionUser;
let vehicleId: string;
const today = () => dateKey(new Date(), TZ);

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

const mileageLines = async () =>
  db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.type, "reimbursement_mileage"));

beforeAll(async () => {
  await ensureDb();
  const s = await signup({
    companyName: "B7 Fleet",
    name: "Ada Admin",
    email: "ada@example.com",
    password: PASSWORD,
    timezone: TZ,
    state: "tx",
  });
  admin = (await loadSessionUser(
    s.userId,
    s.session?.sessionId as string,
  )) as SessionUser;
  tech = await invite("Sam Tech", "sam@example.com");
  const [v] = await db
    .insert(vehicles)
    .values({
      nickname: "Sam's Tacoma",
      ownership: "tech_owned",
      assignedUserId: tech.id,
    } as never)
    .returning({ id: vehicles.id });
  vehicleId = v?.id as string;
}, 120_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

describe("saveTrip lock guard (QA T5-15)", () => {
  it("an approved, reimbursed trip can't be overwritten by a same-day save", async () => {
    auth.user = tech;
    const day = addDaysToKey(today(), -2);
    const first = await saveTrip({
      vehicleId,
      tripDate: day,
      startOdometer: 10_000,
      endOdometer: 10_040,
      miles: 40,
      classification: "business",
    });
    expect(first.ok).toBe(true);
    if (!first.ok || !first.data) throw new Error("trip failed");
    expect(first.data.status).toBe("approved");
    expect((await mileageLines()).length).toBe(1);

    // Same day, no id: previously an upsert that reset the trip to pending.
    const again = await saveTrip({
      vehicleId,
      tripDate: day,
      startOdometer: 10_000,
      endOdometer: 10_590,
      miles: 590,
      classification: "business",
    });
    expect(again.ok).toBe(false);
    const [t] = await db
      .select()
      .from(trips)
      .where(eq(trips.id, first.data.id));
    expect(t).toMatchObject({ miles: 40, approvalStatus: "approved" });
    expect((await mileageLines()).length).toBe(1);

    // The explicit-id edit path stays locked too.
    const edit = await saveTrip({
      id: first.data.id,
      vehicleId,
      tripDate: day,
      startOdometer: null,
      endOdometer: null,
      miles: 500,
      classification: "business",
    });
    expect(edit.ok).toBe(false);
  });

  it("a same-day save still edits a draft trip in place", async () => {
    auth.user = tech;
    const day = addDaysToKey(today(), -1);
    const draft = await saveTrip({
      vehicleId,
      tripDate: day,
      startOdometer: null,
      endOdometer: null,
      miles: 12,
      classification: "business",
      submit: false,
    });
    expect(draft.ok).toBe(true);
    const edited = await saveTrip({
      vehicleId,
      tripDate: day,
      startOdometer: 10_100,
      endOdometer: 10_125,
      miles: 25,
      classification: "business",
      submit: false,
    });
    expect(edited.ok).toBe(true);
    if (!draft.ok || !edited.ok) throw new Error("draft failed");
    expect(edited.data?.id).toBe(draft.data?.id);
    const rows = await db
      .select()
      .from(trips)
      .where(and(eq(trips.vehicleId, vehicleId), eq(trips.tripDate, day)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.miles).toBe(25);
  });
});

describe("odometer default with AI off (QA T1-10)", () => {
  it("a normal reading with a photo is approved; without one it waits", async () => {
    auth.user = tech;
    const [m] = await db
      .insert(media)
      .values({
        kind: "photo",
        tag: "odometer",
        storageKey: "test/odometer.jpg",
        mime: "image/jpeg",
        uploaderId: tech.id,
      })
      .returning({ id: media.id });
    const withPhoto = await logOdometer({
      vehicleId,
      value: 10_200,
      photoMediaId: m?.id ?? null,
    });
    expect(withPhoto.ok).toBe(true);
    if (!withPhoto.ok) throw new Error("log failed");
    expect(withPhoto.data).toMatchObject({ status: "approved", flags: [] });

    const noPhoto = await logOdometer({ vehicleId, value: 10_260 });
    expect(noPhoto.ok).toBe(true);
    if (!noPhoto.ok) throw new Error("log failed");
    expect(noPhoto.data?.status).toBe("pending");

    const [backwards] = await db
      .insert(media)
      .values({
        kind: "photo",
        tag: "odometer",
        storageKey: "test/odometer-2.jpg",
        mime: "image/jpeg",
        uploaderId: tech.id,
      })
      .returning({ id: media.id });
    const anomaly = await logOdometer({
      vehicleId,
      value: 9_000,
      photoMediaId: backwards?.id ?? null,
    });
    if (!anomaly.ok) throw new Error("log failed");
    expect(anomaly.data?.status).toBe("pending");
    expect(anomaly.data?.flags).toContain("odometer_backwards");
    const approved = await db
      .select()
      .from(odometerReadings)
      .where(eq(odometerReadings.approvalStatus, "approved"));
    expect(approved.map((r) => r.value)).toEqual([10_200]);
  });
});

describe("document expiry windows (QA T6-08)", () => {
  const hook = cronHooks.find((h) => h.key === "vehicles.documents");
  const warnings = async () =>
    Number(
      (
        await execRows<{ n: number }>(
          sql`select count(*)::int as n from events where type = 'vehicle.document_expiring'`,
        )
      )[0]?.n ?? 0,
    );

  it("warns a document added inside a window, once, then again at the next window", async () => {
    if (!hook) throw new Error("hook missing");
    const [m] = await db
      .insert(media)
      .values({
        kind: "document",
        tag: "document",
        storageKey: "test/registration.pdf",
        mime: "application/pdf",
      })
      .returning({ id: media.id });
    const now = new Date();
    // 20 days left: not a threshold day (30/14/3), but inside the 30-day window.
    await db.insert(vehicleDocuments).values({
      vehicleId,
      kind: "registration",
      mediaId: m?.id as string,
      expiresOn: addDaysToKey(today(), 20),
      approvalStatus: "approved",
    });
    await hook.run({ now, lastRunAt: null });
    expect(await warnings()).toBe(1);
    // Next day (19 left): same window → no repeat.
    await hook.run({
      now: new Date(now.getTime() + 86_400_000),
      lastRunAt: now,
    });
    expect(await warnings()).toBe(1);
    // A missed week: 12 days left → the 14-day window fires once.
    const later = new Date(now.getTime() + 8 * 86_400_000);
    await hook.run({ now: later, lastRunAt: now });
    await hook.run({ now: later, lastRunAt: later });
    expect(await warnings()).toBe(2);
    const [ev] = await execRows<{ days: number }>(
      sql`select (payload->>'days')::int as days from events where type = 'vehicle.document_expiring' order by id desc limit 1`,
    );
    expect(ev?.days).toBe(12);
  });
});

describe("vehicle form with no assignee (QA2 re-check)", () => {
  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };

  it('"Assigned to: Unassigned" ("" from the select) saves a new vehicle', async () => {
    auth.user = admin;
    const id = crypto.randomUUID();
    const r = await saveVehicle(
      null,
      form({
        id,
        isNew: "true",
        decoded: "",
        nickname: "Spare van",
        ownership: "company_owned",
        assignedUserId: "",
        odometer: "",
      }),
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const [v] = await db.select().from(vehicles).where(eq(vehicles.id, id));
    expect(v?.nickname).toBe("Spare van");
    expect(v?.assignedUserId).toBeNull();

    // Assign, then unassign through the same form.
    const edit = (assignedUserId: string) =>
      saveVehicle(
        null,
        form({
          id,
          isNew: "false",
          decoded: "",
          nickname: "Spare van",
          ownership: "company_owned",
          status: "active",
          assignedUserId,
        }),
      );
    expect((await edit(tech.id)).ok).toBe(true);
    let [after] = await db.select().from(vehicles).where(eq(vehicles.id, id));
    expect(after?.assignedUserId).toBe(tech.id);
    expect((await edit("")).ok).toBe(true);
    [after] = await db.select().from(vehicles).where(eq(vehicles.id, id));
    expect(after?.assignedUserId).toBeNull();
  });

  it("a malformed assignee id is still refused", async () => {
    auth.user = admin;
    const r = await saveVehicle(
      null,
      form({
        id: crypto.randomUUID(),
        isNew: "true",
        decoded: "",
        nickname: "Bad van",
        ownership: "company_owned",
        assignedUserId: "not-a-uuid",
      }),
    );
    expect(r.ok).toBe(false);
  });
});
