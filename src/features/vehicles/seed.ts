// Demo seed fragment for `vehicles` (BUILD_PLAN §10.3 row 17). Owner: B7.
// Writes only B7 tables (plus createApproval / postLedgerEntry / writeActivity /
// seedPlaceholderMedia, which §10.1 allows). Never emits events; reminder statuses
// are computed with the pure forecast instead of recomputeReminders (which emits).
import { desc, eq, lte } from "drizzle-orm";
import type { DB } from "@/db";
import {
  fuelLogs,
  inspections,
  mileageRates,
  odometerReadings,
  serviceRecords,
  trips,
  vehicleDocuments,
  vehicleIssues,
  vehicleReminderRules,
  vehicles,
} from "@/db/schema";
import { seedId } from "@/db/seed/demo-ids";
import type { DemoVehicle } from "@/db/seed/demo-plan";
import { seedPlaceholderMedia } from "@/db/seed/helpers";
import type { DemoSeedCtx } from "@/db/seed/types";
import { createApproval } from "@/features/approvals/api";
import { postLedgerEntry } from "@/features/payroll/api";
import { writeActivity } from "@/lib/activity";
import { addDaysToKey, dateKey } from "@/lib/time";
import { SYSTEM_ACTOR } from "@/lib/types";
import {
  DOCUMENT_TASKS,
  forecastReminder,
  INSPECTION_ITEMS,
  mileageReimbursementCents,
} from "./rules";

const MPG: Record<string, number> = { v1: 15.5, v2: 16.2, v3: 19.4 };

/**
 * Seeded "today" times never land in the future (QA T1-15/T3-19): a time later
 * than now becomes `now − minutesAgo`, so same-day events keep their order.
 */
function past(
  ctx: DemoSeedCtx,
  day: number,
  hhmm: string,
  minutesAgo: number,
): Date {
  const t = ctx.at(day, hhmm);
  return t.getTime() > ctx.now.getTime()
    ? new Date(ctx.now.getTime() - minutesAgo * 60_000)
    : t;
}
const PLATE: Record<string, string> = {
  v1: "KXR 4417",
  v2: "LMB 2093",
  v3: "HTV 8810",
};
const COLOR: Record<string, string> = {
  v1: "#0A84FF",
  v2: "#5E5CE6",
  v3: "#FF9F0A",
};
const SEEDS = [
  { task: "oil_change", im: 5000, id: 182, sm: 500, sd: 14 },
  { task: "tire_rotation", im: 7500, id: null, sm: 500, sd: null },
  { task: "brake_inspection", im: 15000, id: 365, sm: 1000, sd: 30 },
  { task: "registration", im: null, id: null, sm: null, sd: 30 },
  { task: "insurance", im: null, id: null, sm: null, sd: 30 },
  { task: "inspection", im: null, id: null, sm: null, sd: 30 },
] as const;

interface Reading {
  id: string;
  day: number;
  value: number;
  at: Date;
}

export async function seedDemo(db: DB, ctx: DemoSeedCtx): Promise<void> {
  const { plan, tz } = ctx;
  const users = Object.fromEntries(plan.users.map((u) => [u.key, u.id]));
  const today = dateKey(ctx.now, tz);
  const dayKey = (d: number) => addDaysToKey(today, d);
  const isSunday = (d: number) => ctx.at(d, "12:00").getUTCDay() === 0;

  const [rate] = await db
    .select({ rate: mileageRates.millicentsPerMile })
    .from(mileageRates)
    .where(lte(mileageRates.effectiveFrom, today))
    .orderBy(desc(mileageRates.effectiveFrom))
    .limit(1);
  const millicents = rate?.rate ?? 72_500;

  for (const pv of plan.vehicles) {
    const userId = users[pv.assignedTo] as string;
    const readings = await seedVehicle(db, ctx, pv, userId);
    await seedFuel(db, ctx, pv, userId, readings);
    await seedService(db, ctx, pv, userId, readings);
    await seedDocs(db, ctx, pv, userId);
    await seedInspections(db, ctx, pv, userId);
    await seedReminders(db, ctx, pv, readings, today);
    await seedTrips(
      db,
      ctx,
      pv,
      userId,
      readings,
      millicents,
      dayKey,
      isSunday,
    );
  }

  // V2: open "check engine light" issue, unacknowledged (response timer running).
  const v2 = plan.vehicles.find((v) => v.key === "v2");
  if (v2) {
    const issueId = seedId("vehicle_issue", "v2-cel");
    const photo = await seedPlaceholderMedia(db, {
      id: seedId("media", "v2-cel"),
      kind: "photo",
      tag: "problem",
      entity: { type: "vehicle_issue", id: issueId },
      uploaderId: users.tech2,
      label: "Check engine",
      color: "#FF9F0A",
      capturedAt: new Date(ctx.now.getTime() - 3 * 3600_000),
    });
    const [fresh] = await db
      .insert(vehicleIssues)
      .values({
        id: issueId,
        vehicleId: v2.id,
        reportedBy: users.tech2,
        description:
          "Check engine light came on this morning on the highway. Van drives fine, no smell or noise.",
        severity: "medium",
        canDrive: true,
        mediaIds: [photo],
        status: "open",
        createdAt: new Date(ctx.now.getTime() - 3 * 3600_000),
      })
      .onConflictDoNothing()
      .returning({ id: vehicleIssues.id });
    if (fresh)
      await writeActivity(db, {
        entity: { type: "vehicle", id: v2.id },
        kind: "vehicle.issue_reported",
        summary: "Issue reported (medium)",
        data: { issue_id: issueId },
        actorUserId: users.tech2,
      });
  }
  ctx.log(`vehicles: ${plan.vehicles.length} vehicles with 60 days of logs`);
}

async function seedVehicle(
  db: DB,
  ctx: DemoSeedCtx,
  pv: DemoVehicle,
  userId: string,
): Promise<Reading[]> {
  const avg = pv.avgDailyMiles;
  await db
    .insert(vehicles)
    .values({
      id: pv.id,
      nickname: pv.nickname,
      vin: pv.vin,
      year: pv.year,
      make: pv.make,
      model: pv.model,
      fuelType: "Gasoline",
      gvwrLbs: pv.key === "v3" ? 5600 : 9070,
      plate: PLATE[pv.key] ?? null,
      plateState: ctx.plan.company.state,
      ownership: pv.ownership,
      assignedUserId: userId,
      tankGal: pv.tankGal,
      status: "active",
      decoded: {
        vin: pv.vin,
        year: pv.year,
        make: pv.make,
        model: pv.model,
        fuel: "Gasoline",
        source: "demo",
      },
      odometerCached: pv.odometer,
      avgDailyMiles: avg,
      openRecalls: [],
      custom: pv.key === "v1" ? { fuel_card: "WEX •••• 4417" } : {},
      createdAt: ctx.at(-400, "09:00"),
      updatedAt: ctx.at(-1, "09:00"),
    })
    .onConflictDoNothing();
  await seedPlaceholderMedia(db, {
    id: seedId("media", `${pv.key}-photo`),
    kind: "photo",
    tag: "other",
    entity: { type: "vehicle", id: pv.id },
    label: pv.nickname,
    color: COLOR[pv.key] ?? "#0A84FF",
    capturedAt: ctx.at(-400, "09:05"),
  });

  // One approved clock-in reading per working day (Mon–Sat), counting back from
  // today's plan odometer.
  const out: Reading[] = [];
  let value = pv.odometer;
  for (let d = 0; d >= -60; d--) {
    if (ctx.at(d, "12:00").getUTCDay() === 0) continue;
    out.push({
      id: seedId("odometer", `${pv.key}:${d}`),
      day: d,
      value,
      at: past(ctx, d, "07:35", 60),
    });
    value -= Math.round(avg * (0.65 + ctx.rng() * 0.7));
  }
  out.reverse();
  await db
    .insert(odometerReadings)
    .values(
      out.map((r, i) => ({
        id: r.id,
        vehicleId: pv.id,
        value: r.value,
        source: i % 5 === 0 ? "photo" : "clock",
        recordedBy: userId,
        recordedAt: r.at,
        approvalStatus: "approved",
        flags: [],
        createdAt: r.at,
      })),
    )
    .onConflictDoNothing();

  // V2: a pending reading that jumped ~950 mi in a day → in review.
  if (pv.key === "v2") {
    const last = out[out.length - 1] as Reading;
    const id = seedId("odometer", "v2-jump");
    const at = past(ctx, 0, "12:10", 10);
    const photo = await seedPlaceholderMedia(db, {
      id: seedId("media", "v2-jump"),
      kind: "photo",
      tag: "odometer",
      entity: { type: "odometer", id },
      uploaderId: userId,
      label: `${last.value + 950} mi`,
      color: "#5E5CE6",
      capturedAt: at,
    });
    await db
      .insert(odometerReadings)
      .values({
        id,
        vehicleId: pv.id,
        value: last.value + 950,
        source: "photo",
        photoMediaId: photo,
        recordedBy: userId,
        recordedAt: at,
        approvalStatus: "pending",
        flags: ["odometer_jump"],
        createdAt: at,
      })
      .onConflictDoNothing();
    await createApproval(
      db,
      {
        entityType: "odometer",
        entityId: id,
        policy: "auto_if_evidence",
        requestedBy: userId,
        evidence: {
          typed: { value: last.value + 950 },
          ai: null,
          previous: { value: last.value, at: last.at.toISOString() },
          media_ids: [photo],
          vehicle_id: pv.id,
          vehicle: pv.nickname,
          flags: ["odometer_jump"],
          missing: [],
          reason: "anomaly",
          awaiting_ai: false,
        },
      },
      SYSTEM_ACTOR,
    );
  }
  return out;
}

async function seedFuel(
  db: DB,
  ctx: DemoSeedCtx,
  pv: DemoVehicle,
  userId: string,
  readings: Reading[],
): Promise<void> {
  const mpg = MPG[pv.key] ?? 16;
  let prevOdo: number | null = null;
  const fills = readings.filter((_, i) => i % 3 === 1);
  for (const [i, r] of fills.entries()) {
    const odo = r.value + 38;
    const miles = prevOdo != null ? odo - prevOdo : pv.tankGal * mpg * 0.7;
    prevOdo = odo;
    const gallons =
      Math.round(
        Math.min(pv.tankGal - 1.5, miles / (mpg * (0.94 + ctx.rng() * 0.12))) *
          1000,
      ) / 1000;
    const ppg = 3.09 + ctx.rng() * 0.3;
    const at = past(ctx, r.day, "16:40", 20);
    const id = seedId("fuel", `${pv.key}:${r.day}`);
    const readingId = seedId("odometer", `${pv.key}:fuel:${r.day}`);
    const recent = i >= fills.length - 2;
    const receipt = recent
      ? await seedPlaceholderMedia(db, {
          id: seedId("media", `fuel:${pv.key}:${r.day}`),
          kind: "receipt",
          tag: "receipt",
          entity: { type: "fuel", id },
          uploaderId: userId,
          label: `$${(gallons * ppg).toFixed(2)}`,
          color: "#30D158",
          capturedAt: at,
        })
      : null;
    await db
      .insert(odometerReadings)
      .values({
        id: readingId,
        vehicleId: pv.id,
        value: odo,
        source: "fuel",
        recordedBy: userId,
        recordedAt: at,
        approvalStatus: "approved",
        flags: [],
        createdAt: at,
      })
      .onConflictDoNothing();
    await db
      .insert(fuelLogs)
      .values({
        id,
        vehicleId: pv.id,
        userId,
        gallons,
        totalCents: Math.round(gallons * ppg * 100),
        odometerReadingId: readingId,
        receiptMediaId: receipt,
        filledAt: at,
        approvalStatus: "approved",
        flags: [],
        createdAt: at,
      })
      .onConflictDoNothing();
  }

  // V2: a pending fill with more gallons than the 24-gal tank holds.
  if (pv.key === "v2") {
    const id = seedId("fuel", "v2-overtank");
    const at = ctx.at(-1, "17:20");
    const receipt = await seedPlaceholderMedia(db, {
      id: seedId("media", "fuel:v2-overtank"),
      kind: "receipt",
      tag: "receipt",
      entity: { type: "fuel", id },
      uploaderId: userId,
      label: "$96.42",
      color: "#FF453A",
      capturedAt: at,
    });
    await db
      .insert(fuelLogs)
      .values({
        id,
        vehicleId: pv.id,
        userId,
        gallons: 31.2,
        totalCents: 9642,
        receiptMediaId: receipt,
        filledAt: at,
        approvalStatus: "pending",
        flags: ["gallons_over_tank"],
        createdAt: at,
      })
      .onConflictDoNothing();
    await createApproval(
      db,
      {
        entityType: "fuel",
        entityId: id,
        policy: "auto_if_evidence",
        requestedBy: userId,
        evidence: {
          typed: {
            gallons: 31.2,
            total_cents: 9642,
            odometer: null,
            paid_by: "company",
          },
          ai: null,
          previous: null,
          tank_gal: pv.tankGal,
          media_ids: [receipt],
          vehicle_id: pv.id,
          vehicle: pv.nickname,
          flags: ["gallons_over_tank"],
          missing: [],
          reason: "anomaly",
          awaiting_ai: false,
        },
      },
      SYSTEM_ACTOR,
    );
  }
}

/** Reading value on (or the nearest working day before) a day offset. */
function odoOn(readings: Reading[], day: number): number {
  let best = readings[0] as Reading;
  for (const r of readings) if (r.day <= day) best = r;
  return best.value;
}

async function seedService(
  db: DB,
  ctx: DemoSeedCtx,
  pv: DemoVehicle,
  userId: string,
  readings: Reading[],
): Promise<void> {
  // V1 oil change at −40 d (approved, receipt). V2 last oil change −200 d (overdue).
  // V3 −120 d (owner paid, approved).
  const plans: {
    key: string;
    day: number;
    odometer: number;
    tasks: string[];
    vendor: string;
    cost: number;
    paidBy: "company" | "tech";
  }[] =
    pv.key === "v1"
      ? [
          {
            key: "oil",
            day: -40,
            odometer: odoOn(readings, -40),
            tasks: ["oil_change", "tire_rotation"],
            vendor: "Valvoline Instant Oil Change",
            cost: 11_499,
            paidBy: "company",
          },
          {
            key: "brakes",
            day: -150,
            odometer: pv.odometer - 150 * pv.avgDailyMiles,
            tasks: ["brakes"],
            vendor: ctx.profile.vehicleShops.brakes,
            cost: 48_900,
            paidBy: "company",
          },
        ]
      : pv.key === "v2"
        ? [
            {
              key: "oil",
              day: -200,
              odometer: pv.odometer - 5600,
              tasks: ["oil_change"],
              vendor: "Jiffy Lube",
              cost: 8_999,
              paidBy: "company",
            },
            {
              key: "rotation",
              day: -90,
              odometer: pv.odometer - 5200,
              tasks: ["tire_rotation"],
              vendor: "Discount Tire",
              cost: 0,
              paidBy: "company",
            },
          ]
        : [
            {
              key: "oil",
              day: -120,
              odometer: pv.odometer - 3900,
              tasks: ["oil_change"],
              vendor: ctx.profile.vehicleShops.dealer,
              cost: 7_995,
              paidBy: "company",
            },
          ];
  for (const s of plans) {
    const id = seedId("service", `${pv.key}:${s.key}`);
    const receipt =
      s.day > -60
        ? await seedPlaceholderMedia(db, {
            id: seedId("media", `service:${pv.key}:${s.key}`),
            kind: "receipt",
            tag: "receipt",
            entity: { type: "service", id },
            uploaderId: userId,
            label: s.vendor.split(" ")[0] ?? "Invoice",
            color: "#BF5AF2",
            capturedAt: ctx.at(s.day, "11:00"),
          })
        : null;
    await db
      .insert(serviceRecords)
      .values({
        id,
        vehicleId: pv.id,
        tasks: s.tasks,
        performedOn: dateKey(ctx.at(s.day, "12:00"), ctx.tz),
        odometer: s.odometer,
        vendor: s.vendor,
        costCents: s.cost,
        paidBy: s.paidBy,
        receiptMediaId: receipt,
        approvalStatus: "approved",
        createdBy: userId,
        createdAt: ctx.at(s.day, "11:30"),
      })
      .onConflictDoNothing();
  }
}

async function seedDocs(
  db: DB,
  ctx: DemoSeedCtx,
  pv: DemoVehicle,
  userId: string,
): Promise<void> {
  const docs = [
    // V1 insurance expires in 10 days (due-soon reminder + 14/3-day warnings ahead).
    { kind: "insurance", expires: pv.key === "v1" ? 10 : 160 },
    { kind: "registration", expires: pv.key === "v2" ? 45 : 210 },
    { kind: "inspection", expires: pv.key === "v3" ? 75 : 130 },
  ];
  for (const d of docs) {
    const id = seedId("vehicle_document", `${pv.key}:${d.kind}`);
    const mediaId = await seedPlaceholderMedia(db, {
      id: seedId("media", `doc:${pv.key}:${d.kind}`),
      kind: "document",
      tag: "document",
      entity: { type: "document", id },
      uploaderId: userId,
      label: d.kind[0]?.toUpperCase() + d.kind.slice(1),
      color: "#64D2FF",
      capturedAt: ctx.at(-200, "10:00"),
    });
    await db
      .insert(vehicleDocuments)
      .values({
        id,
        vehicleId: pv.id,
        kind: d.kind,
        mediaId,
        expiresOn: dateKey(ctx.at(d.expires, "12:00"), ctx.tz),
        approvalStatus: "approved",
        createdBy: userId,
        createdAt: ctx.at(-200, "10:05"),
      })
      .onConflictDoNothing();
  }
}

async function seedInspections(
  db: DB,
  ctx: DemoSeedCtx,
  pv: DemoVehicle,
  userId: string,
): Promise<void> {
  // Weekly DVIR-lite. Sam's last one is 9 days old, so his Today card shows "Inspection due".
  const start = pv.key === "v3" ? -9 : -1;
  const rows = [];
  for (let d = start; d >= -60; d -= 7) {
    const failWipers = pv.key === "v2" && d === start - 14;
    const results = Object.fromEntries(
      INSPECTION_ITEMS.map((i) => [
        i.key,
        failWipers && i.key === "wipers"
          ? { ok: false, note: "Streaking — blades ordered" }
          : { ok: true },
      ]),
    );
    rows.push({
      id: seedId("inspection", `${pv.key}:${d}`),
      vehicleId: pv.id,
      userId,
      results,
      passed: !failWipers,
      mediaIds: [],
      approvalStatus: "approved",
      createdAt: ctx.at(d, "07:42"),
    });
  }
  if (rows.length)
    await db.insert(inspections).values(rows).onConflictDoNothing();
}

async function seedReminders(
  db: DB,
  ctx: DemoSeedCtx,
  pv: DemoVehicle,
  readings: Reading[],
  today: string,
): Promise<void> {
  const last: Record<string, { day: number; odo: number }> =
    pv.key === "v1"
      ? {
          oil_change: { day: -40, odo: odoOn(readings, -40) },
          tire_rotation: { day: -40, odo: odoOn(readings, -40) },
          brake_inspection: {
            day: -150,
            odo: pv.odometer - 150 * pv.avgDailyMiles,
          },
        }
      : pv.key === "v2"
        ? {
            oil_change: { day: -200, odo: pv.odometer - 5600 },
            tire_rotation: { day: -90, odo: pv.odometer - 5200 },
            brake_inspection: { day: -210, odo: pv.odometer - 11800 },
          }
        : {
            oil_change: { day: -120, odo: pv.odometer - 3900 },
            tire_rotation: { day: -120, odo: pv.odometer - 3900 },
            brake_inspection: { day: -300, odo: pv.odometer - 14_200 },
          };
  const docExpiry: Record<string, string> = {
    insurance: dateKey(ctx.at(pv.key === "v1" ? 10 : 160, "12:00"), ctx.tz),
    registration: dateKey(ctx.at(pv.key === "v2" ? 45 : 210, "12:00"), ctx.tz),
    inspection: dateKey(ctx.at(pv.key === "v3" ? 75 : 130, "12:00"), ctx.tz),
  };
  for (const s of SEEDS) {
    const l = last[s.task];
    const rule = {
      task: s.task,
      intervalMiles: s.im,
      intervalDays: s.id,
      dueSoonMiles: s.sm,
      dueSoonDays: s.sd,
      lastDoneOn: l ? dateKey(ctx.at(l.day, "12:00"), ctx.tz) : null,
      lastDoneOdometer: l?.odo ?? null,
    };
    const f = forecastReminder(rule, {
      odometer: pv.odometer,
      avgDailyMiles: pv.avgDailyMiles,
      today,
      documentExpiresOn: DOCUMENT_TASKS.includes(s.task)
        ? (docExpiry[s.task] ?? null)
        : null,
    });
    await db
      .insert(vehicleReminderRules)
      .values({
        id: seedId("vehicle_reminder", `${pv.key}:${s.task}`),
        vehicleId: pv.id,
        ...rule,
        nextDueOn: f.nextDueOn,
        nextDueMiles: f.nextDueMiles,
        status: f.status,
        active: true,
      })
      .onConflictDoNothing();
  }
}

async function seedTrips(
  db: DB,
  ctx: DemoSeedCtx,
  pv: DemoVehicle,
  userId: string,
  readings: Reading[],
  millicents: number,
  dayKey: (d: number) => string,
  isSunday: (d: number) => boolean,
): Promise<void> {
  // Sam's Tacoma (tech-owned): 4 weeks of approved business trips with mileage
  // reimbursement, plus yesterday's auto-drafted trip waiting for him to submit.
  // Company vans get a week of (non-reimbursable) approved business trips.
  const span = pv.key === "v3" ? 28 : 6;
  const byDay = new Map(readings.map((r) => [r.day, r]));
  for (let d = -span; d <= -1; d++) {
    if (isSunday(d)) continue;
    const start = byDay.get(d);
    let next: Reading | undefined;
    for (let k = d + 1; k <= 0 && !next; k++) next = byDay.get(k);
    if (!start || !next) continue;
    const miles = Math.max(0, next.value - start.value - 6);
    const draft = d === -1 && pv.key === "v3";
    const id = seedId("trip", `${pv.key}:${d}`);
    const reimbursable = pv.ownership === "tech_owned";
    const [inserted] = await db
      .insert(trips)
      .values({
        id,
        userId,
        vehicleId: pv.id,
        tripDate: dayKey(d),
        startOdometer: start.value,
        endOdometer: start.value + miles,
        miles,
        destinations: [],
        purpose: "Service calls",
        classification: "business",
        reimbursable,
        approvalStatus: draft ? "pending" : "approved",
        createdAt: ctx.at(d, "18:05"),
      })
      .onConflictDoNothing()
      .returning({ id: trips.id });
    // Only a freshly inserted trip posts its ledger line (reruns stay idempotent).
    if (inserted && reimbursable && !draft && miles > 0) {
      const amount = mileageReimbursementCents(miles, millicents);
      const { ledgerEntryId } = await postLedgerEntry(
        db,
        {
          userId,
          type: "reimbursement_mileage",
          amountCents: amount,
          effectiveDate: dayKey(d),
          refTable: "trips",
          refId: id,
          memo: `${miles} mi business @ ${(millicents / 1000).toFixed(1)}¢`,
        },
        SYSTEM_ACTOR,
      );
      await db.update(trips).set({ ledgerEntryId }).where(eq(trips.id, id));
    }
  }
}
