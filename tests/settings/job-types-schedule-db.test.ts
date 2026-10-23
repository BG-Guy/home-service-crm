// Leads-flow redesign (items 6 and 8) on a throwaway PGlite: the three job types
// from the base seed, saving trade jobs with a kind (no maintenance interval), the
// ⚖️ ownership check on a trade job, working hours, time off and the booking limits.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(
  path.join(process.env.TEST_PGLITE_ROOT || os.tmpdir(), "crm-kinds-db-"),
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
    for (const p of perm ? (Array.isArray(perm) ? perm : [perm]) : [])
      if (!auth.user.perms.has(p as never)) {
        const { ForbiddenError } = await import("@/lib/errors");
        throw new ForbiddenError(undefined, p);
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
import { serviceTypes, timeOff, users } from "@/db/schema";
import "@/db/seed/register";
import { saveJobSettings } from "@/features/jobs/actions";
import { buildChecklist } from "@/features/jobs/internal";
import { listServiceTypeOptions } from "@/features/jobs/service-types";
import { saveServiceTypeAction } from "@/features/settings/actions";
import {
  addTimeOffAction,
  removeTimeOffAction,
  saveWorkHoursAction,
} from "@/features/team/schedule-actions";
import {
  getMemberSchedule,
  timeOffLabel,
} from "@/features/team/schedule-queries";
import { loadSessionUser } from "@/lib/auth/current";
import { signup } from "@/lib/auth/flows";
import { getSettings } from "@/lib/settings";
import type { SessionUser } from "@/lib/types";

const TZ = "America/Chicago";
let admin: SessionUser;

beforeAll(async () => {
  await ensureDb();
  const res = await signup({
    companyName: "Kinds Locks",
    name: "Ada Admin",
    email: "ada@example.com",
    password: "tangerine-kayak-41",
    timezone: TZ,
    state: "tx",
  });
  admin = (await loadSessionUser(
    res.userId,
    res.session?.sessionId as string,
  )) as SessionUser;
  auth.user = admin;
}, 120_000);

afterAll(async () => {
  await closeDb();
  rmSync(root, { recursive: true, force: true });
});

function form(o: Record<string, string | boolean | number>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o))
    if (v !== false) fd.set(k, v === true ? "on" : String(v));
  return fd;
}

describe("job types", () => {
  it("seeds the three job types, nothing retired", async () => {
    const opts = await listServiceTypeOptions({ includeInactive: true });
    expect(
      opts.map((o) => [o.name, o.kind, o.defaultDurationMin, o.primary]),
    ).toEqual([
      ["Free estimate", "estimate", 45, true],
      ["Service call", "service", 90, true],
      ["Project", "project", 240, true],
    ]);
    const [project] = await db
      .select({ contractKind: serviceTypes.contractKind })
      .from(serviceTypes)
      .where(eq(serviceTypes.name, "Project"));
    expect(project?.contractKind).toBe("improvement");
  });

  it("saves a trade job under a kind and never a maintenance interval", async () => {
    const r = await saveServiceTypeAction(
      form({
        name: "Lockout",
        kind: "service",
        icon: "key",
        color: "#ff9500",
        aliases: "locked out, lockout",
        defaultDurationMin: 45,
        defaultPriceCents: "",
        contractKind: "repair",
        photosRequiredBefore: 1,
        photosRequiredAfter: 1,
        photosOnInvoice: true,
        requiresOwnershipCheck: true,
        warrantyDays: 0,
        maintenanceIntervalMonths: 12, // ignored: the field is retired
        sort: 10,
        active: true,
      }),
    );
    expect(r.ok).toBe(true);
    const id = r.ok ? (r.data as { id: string }).id : "";
    const [row] = await db
      .select()
      .from(serviceTypes)
      .where(eq(serviceTypes.id, id));
    expect(row).toMatchObject({
      kind: "service",
      requiresOwnershipCheck: true,
      maintenanceIntervalMonths: null,
    });
    // ⚖️ The lockout proof-of-ownership check lands on the job's checklist.
    const items = await buildChecklist(id);
    expect(items.filter((i) => i.required).length).toBeGreaterThanOrEqual(3);
    expect(items.map((i) => i.type)).toEqual(
      expect.arrayContaining(["photo", "signature"]),
    );

    const opts = await listServiceTypeOptions();
    const lockout = opts.find((o) => o.id === id);
    expect(lockout).toMatchObject({
      kind: "service",
      primary: false,
      requiresOwnershipCheck: true,
    });
    expect(opts.find((o) => o.name === "Service call")?.primary).toBe(true);
  });

  it("moves a job to another kind and rejects unknown kinds", async () => {
    const r = await saveServiceTypeAction(
      form({
        name: "Deck build",
        kind: "project",
        defaultDurationMin: 480,
        defaultPriceCents: "",
        contractKind: "improvement",
        photosRequiredBefore: 0,
        photosRequiredAfter: 0,
        warrantyDays: 365,
        sort: 20,
        active: true,
      }),
    );
    expect(r.ok).toBe(true);
    const bad = await saveServiceTypeAction(
      form({
        name: "Tune-up",
        kind: "maintenance",
        defaultDurationMin: 60,
        defaultPriceCents: "",
        contractKind: "repair",
        photosRequiredBefore: 0,
        photosRequiredAfter: 0,
        warrantyDays: 30,
        active: true,
      }),
    );
    expect(bad.ok).toBe(false);
    const opts = await listServiceTypeOptions();
    expect(opts.find((o) => o.name === "Deck build")).toMatchObject({
      kind: "project",
      primary: false,
    });
  });
});

describe("working hours and time off", () => {
  it("saves own hours, then goes back to business hours", async () => {
    const r = await saveWorkHoursAction({
      userId: admin.id,
      useBusinessHours: false,
      days: [
        { day: 6, start: "09:00", end: "13:00" },
        { day: 1, start: "07:30", end: "16:00" },
      ],
    });
    expect(r.ok).toBe(true);
    const [u] = await db
      .select({ workHours: users.workHours })
      .from(users)
      .where(eq(users.id, admin.id));
    expect(u?.workHours).toEqual([
      { day: 1, start: "07:30", end: "16:00" },
      { day: 6, start: "09:00", end: "13:00" },
    ]);
    const s = await getMemberSchedule(admin.id);
    expect(s.workHours).toHaveLength(2);
    expect(s.business).toHaveLength(5); // Mon–Fri default business hours

    const bad = await saveWorkHoursAction({
      userId: admin.id,
      useBusinessHours: false,
      days: [{ day: 2, start: "17:00", end: "08:00" }],
    });
    expect(bad.ok).toBe(false);

    const back = await saveWorkHoursAction({
      userId: admin.id,
      useBusinessHours: true,
      days: [],
    });
    expect(back.ok).toBe(true);
    expect((await getMemberSchedule(admin.id)).workHours).toBeNull();
  });

  it("adds whole days in the company time zone and removes them", async () => {
    const r = await addTimeOffAction({
      userId: admin.id,
      from: "2030-03-08",
      to: "2030-03-11", // spans the DST change (Mar 10)
      allDay: true,
      note: "Vacation",
    });
    expect(r.ok).toBe(true);
    const id = r.ok ? (r.data as { id: string }).id : "";
    const [row] = await db.select().from(timeOff).where(eq(timeOff.id, id));
    expect(row?.startsAt.toISOString()).toBe("2030-03-08T06:00:00.000Z"); // CST
    expect(row?.endsAt.toISOString()).toBe("2030-03-12T05:00:00.000Z"); // CDT
    expect(row?.createdBy).toBe(admin.id);
    const s = await getMemberSchedule(admin.id);
    expect(s.timeOff[0]).toMatchObject({
      id,
      label: "Fri, Mar 8 – Mon, Mar 11",
      allDay: true,
      note: "Vacation",
      current: false,
    });

    const rm = await removeTimeOffAction({ id });
    expect(rm.ok).toBe(true);
    expect((await getMemberSchedule(admin.id)).timeOff).toEqual([]);
  });

  it("adds part of a day and checks the range", async () => {
    const r = await addTimeOffAction({
      userId: admin.id,
      from: "2030-04-02",
      to: "2030-04-02",
      allDay: false,
      startTime: "13:00",
      endTime: "17:00",
    });
    expect(r.ok).toBe(true);
    const s = await getMemberSchedule(admin.id);
    expect(s.timeOff[0]?.allDay).toBe(false);
    expect(s.timeOff[0]?.label).toMatch(/^Tue, Apr 2 · 1:00\s?–\s?5:00\sPM$/);
    const backwards = await addTimeOffAction({
      userId: admin.id,
      from: "2030-04-03",
      to: "2030-04-02",
      allDay: true,
    });
    expect(backwards.ok).toBe(false);
    const empty = await addTimeOffAction({
      userId: admin.id,
      from: "2030-04-03",
      to: "2030-04-03",
      allDay: false,
      startTime: "15:00",
      endTime: "09:00",
    });
    expect(empty.ok).toBe(false);
  });

  it("labels ranges", () => {
    const d = (iso: string) => new Date(iso);
    expect(
      timeOffLabel(d("2030-05-01T05:00:00Z"), d("2030-05-02T05:00:00Z"), TZ),
    ).toEqual({ label: "Wed, May 1", allDay: true });
    expect(
      timeOffLabel(d("2030-05-01T18:00:00Z"), d("2030-05-02T15:00:00Z"), TZ)
        .label,
    ).toMatch(/^Wed, May 1, 1:00\sPM – Thu, May 2, 10:00\sAM$/);
  });
});

describe("booking limits", () => {
  it("defaults and saves the three keys", async () => {
    const before = (await getSettings()).jobs;
    expect(before.daily_job_cap).toBe(6);
    expect(before.max_extra_miles).toBe(25);
    expect(before.after_hours_booking).toBe(false);
    const base = {
      arrival_radius_m: before.arrival_radius_m,
      window_lengths_min: before.window_lengths_min,
      default_window_min: before.default_window_min,
      unconfirmed_flag_time: before.unconfirmed_flag_time,
      late_cancel_hours: 24,
      late_cancel_fee_cents: 0,
      no_show_fee_cents: 0,
      service_call_fee_cents: null,
      service_call_fee_credited: true,
      callback_no_charge: true,
      warranty_claim_due_days: 30,
      board_start_hour: 7,
      board_end_hour: 20,
      job_prefix: "J",
    };
    const r = await saveJobSettings({
      ...base,
      daily_job_cap: 4,
      max_extra_miles: 40,
      after_hours_booking: true,
    });
    expect(r.ok).toBe(true);
    let j = (await getSettings()).jobs;
    expect([j.daily_job_cap, j.max_extra_miles, j.after_hours_booking]).toEqual(
      [4, 40, true],
    );
    // Omitted keys are kept.
    expect((await saveJobSettings(base)).ok).toBe(true);
    j = (await getSettings()).jobs;
    expect(j.daily_job_cap).toBe(4);
    const tooMany = await saveJobSettings({ ...base, daily_job_cap: 99 });
    expect(tooMany.ok).toBe(false);
  });
});
