"use server";

import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  ne,
} from "drizzle-orm";
import { z } from "zod";
import { queueAiTask } from "@/adapters/ai";
import { getVinDecoder } from "@/adapters/vin";
import { db, type Tx } from "@/db";
import {
  aiTasks,
  approvals,
  fuelLogs,
  inspections,
  media,
  odometerReadings,
  serviceRecords,
  trips,
  users,
  vehicleDocuments,
  vehicleIssues,
  vehicleReminderRules,
  vehicles,
} from "@/db/schema";
import { decideApproval } from "@/features/approvals/api";
import { attachMedia } from "@/features/media/api";
import { createPartPurchase } from "@/features/parts/api";
import { validateCustomValues } from "@/features/settings/api";
import { type ActionRunContext, action } from "@/lib/action";
import { diffObjects } from "@/lib/audit";
import { requireUser } from "@/lib/auth/current";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { enqueueJob } from "@/lib/queue";
import {
  getCompanyTimezone,
  getSettings,
  updateSettings,
} from "@/lib/settings";
import {
  addDaysToKey,
  dateKey,
  parseDateKey,
  zonedTimeToUtc,
} from "@/lib/time";
import type { EntityRef } from "@/lib/types";
import type { DecodedVin } from "./contracts";
import {
  aiEnabled,
  assertVehicleAccess,
  finalizeLog,
  LOG_LABEL,
  mediaForEntity,
  prevApprovedReading,
  recomputeReminders,
  seedReminderRules,
  type VehicleRow,
  vehiclePolicies,
} from "./engine";
import {
  detectAnomalies,
  evaluateEvidence,
  INSPECTION_ITEMS,
  resolveVehicleLogPolicy,
  taskFromInput,
  type VehicleLogType,
} from "./rules";

// Vehicle mutations (SPEC M17). All through action(): perm → flag → zod →
// clientId idempotency → one transaction (write + events + audit + activity).

const uuid = z.string().uuid();
// "" (an empty <select>, e.g. "Assigned to: Unassigned") means none, like optText.
const optUuid = z.preprocess(
  (v) => (v === "" ? null : v),
  z.string().uuid().nullish(),
);
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const optText = (max = 500) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(max).nullish(),
  );
const optInt = (min = 0, max = 10_000_000) =>
  z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z.coerce.number().int().min(min).max(max).nullable(),
  );
const optNum = (min = 0, max = 1_000_000) =>
  z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z.coerce.number().min(min).max(max).nullable(),
  );

const vehiclePath = (id: string) => [
  `/vehicles/${id}`,
  "/vehicles",
  "/vehicles/approvals",
  "/approvals",
  "/today",
];

type Ctx = ActionRunContext<unknown>;

async function companyToday(now = new Date()): Promise<string> {
  return dateKey(now, await getCompanyTimezone());
}

/** The media id to use as evidence: explicit id (verified) or one uploaded against the entity. */
async function resolveMedia(
  tx: Tx,
  explicit: string | null | undefined,
  entityType: string,
  entityId: string,
  uploaderId: string,
): Promise<string | null> {
  if (explicit) {
    // Only the logger's own upload (QA2: never someone else's photo or receipt).
    const [m] = await tx
      .select({ id: media.id })
      .from(media)
      .where(
        and(
          eq(media.id, explicit),
          eq(media.uploaderId, uploaderId),
          isNull(media.deletedAt),
        ),
      )
      .limit(1);
    if (m) return m.id;
  }
  const attached = await mediaForEntity(tx, entityType, entityId);
  return attached[0] ?? null;
}

/** Link uploaded media to the log row (uploads may also have arrived with the entity ref). */
async function attachTo(
  tx: Tx,
  mediaIds: (string | null | undefined)[],
  entity: { type: string; id: string },
): Promise<void> {
  const ids = mediaIds.filter((x): x is string => !!x);
  if (ids.length === 0) return;
  // Only media not yet attached elsewhere; the write goes through B4's attachMedia.
  const free = await tx
    .select({ id: media.id })
    .from(media)
    .where(and(inArray(media.id, ids), isNull(media.entityId)));
  await attachMedia(
    tx,
    free.map((m) => m.id),
    entity as EntityRef,
  );
}

/** AI cross-check status for a media id (cached results land immediately). */
async function queueAi(
  tx: Tx,
  kind: "odometer" | "receipt" | "shop_invoice",
  mediaId: string | null,
  ref: { entityType: string; entityId: string },
): Promise<{ enabled: boolean; done: boolean; output: unknown }> {
  if (!mediaId || !aiEnabled())
    return { enabled: aiEnabled(), done: false, output: null };
  const res = await queueAiTask(tx, {
    kind,
    mediaIds: [mediaId],
    ref: { module: "vehicles", ...ref },
  });
  if (res.status === "done") {
    const [t] = await tx
      .select({ output: aiTasks.output })
      .from(aiTasks)
      .where(eq(aiTasks.id, res.aiTaskId))
      .limit(1);
    return { enabled: true, done: true, output: t?.output ?? null };
  }
  if (res.status === "failed" || res.status.startsWith("skipped"))
    return { enabled: true, done: true, output: null };
  return { enabled: true, done: false, output: null };
}

interface ResolveArgs {
  ctx: Ctx;
  type: VehicleLogType;
  vehicle: VehicleRow;
  flags: string[];
  evidence: Parameters<typeof evaluateEvidence>[0];
}

async function resolveOutcome(a: ResolveArgs) {
  const policies = await vehiclePolicies();
  const ev = evaluateEvidence(a.evidence);
  const outcome = resolveVehicleLogPolicy(a.ctx.user, a.type, policies, {
    anomalies: a.flags,
    evidence: ev,
  });
  if (!outcome.canLog)
    throw new ForbiddenError(
      "Ask your admin to log this — techs can't submit this entry.",
    );
  return { outcome, missing: ev.missing };
}

// ------------------------------------------------------------------ vehicles

const VehicleInput = z.object({
  id: uuid.optional(),
  isNew: z.preprocess((v) => v === true || v === "true", z.boolean()),
  nickname: z.string().trim().min(1, "Give the vehicle a name.").max(80),
  vin: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toUpperCase() || null : v),
    z
      .string()
      .regex(
        /^[A-HJ-NPR-Z0-9]{11,17}$/,
        "VINs are 17 letters/numbers (no I, O, Q).",
      )
      .nullish(),
  ),
  year: optInt(1950, 2100),
  make: optText(60),
  model: optText(60),
  trim: optText(60),
  engine: optText(80),
  fuelType: optText(40),
  gvwrLbs: optInt(0, 200_000),
  usdotNumber: optText(20),
  plate: optText(16),
  plateState: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toUpperCase() || null : v),
    z.string().length(2).nullish(),
  ),
  ownership: z.enum(["company_owned", "leased", "tech_owned"]),
  assignedUserId: optUuid,
  tankGal: optNum(0, 500),
  status: z.enum(["active", "in_shop", "retired"]).default("active"),
  odometer: optInt(0, 2_000_000),
  decoded: z.preprocess((v) => {
    if (typeof v !== "string") return v;
    if (!v.trim()) return null;
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }, z.record(z.string(), z.unknown()).nullish()),
  custom: z.record(z.string(), z.unknown()).default({}),
});

export const saveVehicle = action({
  perm: "vehicles.manage",
  feature: "vehicles",
  input: VehicleInput,
  audit: "vehicle.saved",
  async run({ input, tx, user, activity, audit }) {
    const custom = await validateCustomValues("vehicle", input.custom);
    if (!custom.ok)
      throw new ValidationError(
        custom.fieldErrors,
        "Please fix the custom fields.",
      );
    if (input.assignedUserId) {
      const [u] = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(eq(users.id, input.assignedUserId), eq(users.status, "active")),
        )
        .limit(1);
      if (!u)
        throw new ValidationError({ assignedUserId: ["Pick an active user."] });
    }
    const values = {
      nickname: input.nickname,
      vin: input.vin ?? null,
      year: input.year,
      make: input.make ?? null,
      model: input.model ?? null,
      trim: input.trim ?? null,
      engine: input.engine ?? null,
      fuelType: input.fuelType ?? null,
      gvwrLbs: input.gvwrLbs,
      usdotNumber:
        (input.gvwrLbs ?? 0) >= 10_001 ? (input.usdotNumber ?? null) : null,
      plate: input.plate ?? null,
      plateState: input.plateState ?? null,
      ownership: input.ownership,
      assignedUserId: input.assignedUserId ?? null,
      tankGal: input.tankGal,
      status: input.status,
    };
    let id = input.id;
    const existing = id
      ? (
          await tx.select().from(vehicles).where(eq(vehicles.id, id)).limit(1)
        )[0]
      : undefined;
    if (existing && !input.isNew) {
      const keep = Object.fromEntries(
        Object.entries(
          (existing.custom ?? {}) as Record<string, unknown>,
        ).filter(([k]) => k.startsWith("_")),
      );
      await tx
        .update(vehicles)
        .set({
          ...values,
          custom: { ...keep, ...custom.values },
          decoded: input.decoded ?? existing.decoded,
          updatedAt: new Date(),
        })
        .where(eq(vehicles.id, existing.id));
      const d = diffObjects(
        { ...existing, custom: existing.custom },
        { ...existing, ...values, custom: { ...keep, ...custom.values } },
      );
      await audit({
        action: "vehicle.updated",
        entity: { type: "vehicle", id: existing.id },
        before: d.before,
        after: d.after,
      });
      if (existing.assignedUserId !== values.assignedUserId)
        await activity({
          entity: { type: "vehicle", id: existing.id },
          kind: "vehicle.assigned",
          summary: values.assignedUserId
            ? "Vehicle reassigned"
            : "Vehicle unassigned",
          data: { from: existing.assignedUserId, to: values.assignedUserId },
        });
      if (existing.status !== values.status)
        await activity({
          entity: { type: "vehicle", id: existing.id },
          kind: "vehicle.status_changed",
          summary: `Status: ${values.status.replace("_", " ")}`,
        });
      if (input.vin && input.vin !== existing.vin) {
        await enqueueJob(
          tx,
          "vin",
          { vehicleId: existing.id },
          { dedupeKey: `vin:${existing.id}:${input.vin}` },
        );
      }
    } else {
      if (existing)
        throw new ConflictError(
          "vehicle_exists",
          "That vehicle already exists.",
        );
      const [row] = await tx
        .insert(vehicles)
        .values({
          ...(id ? { id } : {}),
          ...values,
          decoded: input.decoded ?? null,
          custom: custom.values,
          odometerCached: input.odometer ?? null,
        })
        .returning({ id: vehicles.id });
      if (!row) throw new Error("vehicle insert failed");
      id = row.id;
      const today = await companyToday();
      if (input.odometer != null) {
        await tx.insert(odometerReadings).values({
          vehicleId: id,
          value: input.odometer,
          source: "manual",
          recordedBy: user.id,
          recordedAt: new Date(),
          approvalStatus: "approved",
        });
      }
      await seedReminderRules(tx, id, input.odometer ?? null, today);
      await recomputeReminders(tx, id);
      if (input.vin && !input.decoded)
        await enqueueJob(
          tx,
          "vin",
          { vehicleId: id },
          { dedupeKey: `vin:${id}:${input.vin}` },
        );
      if (input.year && input.make && input.model)
        await enqueueJob(
          tx,
          "recalls",
          { vehicleId: id },
          { dedupeKey: `recalls:${id}:new` },
        );
      await activity({
        entity: { type: "vehicle", id },
        kind: "vehicle.created",
        summary: `Added ${input.nickname}`,
      });
      await audit({
        action: "vehicle.created",
        entity: { type: "vehicle", id },
        after: values,
      });
    }
    return { id: id as string };
  },
  revalidate: ({ data }) => vehiclePath(data.id),
});

/** VIN decode via NHTSA vPIC (read-only; no DB write, so no transaction). */
export async function decodeVin(
  vin: string,
): Promise<{ ok: true; data: DecodedVin } | { ok: false; error: string }> {
  await requireUser("vehicles.manage");
  const v = vin.trim().toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(v))
    return { ok: false, error: "Enter the full 17-character VIN." };
  try {
    const d = await getVinDecoder().decode(v);
    if (!d) return { ok: false, error: "No match for that VIN." };
    return {
      ok: true,
      data: {
        vin: d.vin,
        year: d.year,
        make: d.make,
        model: d.model,
        trim: d.trim,
        engine: d.engine,
        fuel: d.fuel,
        gvwrLb: d.gvwrLb,
        bodyClass: d.bodyClass,
      },
    };
  } catch {
    return {
      ok: false,
      error: "The VIN service didn't answer. Type the details instead.",
    };
  }
}

export const setVehicleStatus = action({
  perm: "vehicles.manage",
  feature: "vehicles",
  input: z.object({
    vehicleId: uuid,
    status: z.enum(["active", "in_shop", "retired"]),
  }),
  audit: "vehicle.status_changed",
  async run({ input, tx, activity }) {
    const res = await tx
      .update(vehicles)
      .set({ status: input.status, updatedAt: new Date() })
      .where(and(eq(vehicles.id, input.vehicleId), isNull(vehicles.deletedAt)))
      .returning({ id: vehicles.id });
    if (!res.length) throw new NotFoundError("Vehicle");
    await activity({
      entity: { type: "vehicle", id: input.vehicleId },
      kind: "vehicle.status_changed",
      summary: `Status: ${input.status.replace("_", " ")}`,
    });
    return { id: input.vehicleId };
  },
  auditEntity: ({ input }) => ({ type: "vehicle", id: input.vehicleId }),
  revalidate: ({ input }) => vehiclePath(input.vehicleId),
});

export const refreshRecalls = action({
  perm: "vehicles.manage",
  feature: "vehicles",
  input: z.object({ vehicleId: uuid }),
  async run({ input, tx }) {
    await enqueueJob(
      tx,
      "recalls",
      { vehicleId: input.vehicleId },
      { dedupeKey: `recalls:${input.vehicleId}:${Date.now()}` },
    );
    return { queued: true };
  },
  revalidate: ({ input }) => [`/vehicles/${input.vehicleId}`],
});

// ------------------------------------------------------------------ odometer

const OdometerInput = z.object({
  vehicleId: uuid,
  value: z.coerce.number().int().min(0, "Enter the odometer.").max(2_000_000),
  source: z.enum(["manual", "photo", "clock"]).default("manual"),
  photoMediaId: optUuid,
  recordedAt: z.coerce.date().optional(),
  clientId: uuid.optional(),
});

export const logOdometer = action({
  name: "vehicles.logOdometer",
  perm: "vehicles.log",
  feature: "vehicles",
  input: OdometerInput,
  audit: "vehicle.odometer_logged",
  async run(ctx) {
    const { input, tx, user, actor } = ctx;
    const v = await assertVehicleAccess(tx, user, input.vehicleId, "log");
    const id = input.clientId ?? crypto.randomUUID();
    const at =
      input.recordedAt && input.recordedAt < new Date()
        ? input.recordedAt
        : new Date();
    const photo = await resolveMedia(
      tx,
      input.photoMediaId,
      "odometer",
      id,
      user.id,
    );
    const prev = await prevApprovedReading(tx, v.id, at);
    const settings = await getSettings();
    const flags = detectAnomalies({
      value: input.value,
      at,
      prev,
      maxDailyMiles: settings.vehicles.max_daily_miles,
    });
    await tx.insert(odometerReadings).values({
      id,
      vehicleId: v.id,
      value: input.value,
      source: photo
        ? input.source === "manual"
          ? "photo"
          : input.source
        : input.source,
      photoMediaId: photo,
      recordedBy: user.id,
      recordedAt: at,
      approvalStatus: "pending",
      flags,
      clientId: input.clientId ?? null,
    });
    await attachTo(tx, [photo], { type: "odometer", id });
    const ai = await queueAi(tx, "odometer", photo, {
      entityType: "odometer",
      entityId: id,
    });
    const aiValue = ai.done ? readOdometerOutput(ai.output) : null;
    if (aiValue)
      await tx
        .update(odometerReadings)
        .set({ aiValue: aiValue.value, aiConfidence: aiValue.confidence })
        .where(eq(odometerReadings.id, id));
    const { outcome, missing } = await resolveOutcome({
      ctx: ctx as Ctx,
      type: "odometer",
      vehicle: v,
      flags,
      evidence: {
        type: "odometer",
        hasMedia: !!photo,
        typed: input.value,
        ai: {
          enabled: ai.enabled,
          done: ai.done,
          value: aiValue?.value ?? null,
        },
        aiOptional: settings.vehicles.policies.odometer.ai_optional,
      },
    });
    const { approvalId } = await finalizeLog(tx, {
      type: "odometer",
      entityId: id,
      vehicle: v,
      outcome,
      flags,
      missing,
      evidence: {
        typed: { value: input.value },
        ai: aiValue,
        previous: prev
          ? { value: prev.value, at: prev.at.toISOString() }
          : null,
        media_ids: photo ? [photo] : [],
      },
      summary: `Odometer ${new Intl.NumberFormat("en-US").format(input.value)} mi`,
      requestedBy: user.id,
      actor,
    });
    return { id, status: outcome.status, approvalId, flags };
  },
  auditEntity: ({ data }) => ({ type: "odometer", id: data.id }),
  revalidate: ({ input }) => vehiclePath(input.vehicleId),
});

function readOdometerOutput(
  out: unknown,
): { value: number; confidence: number | null } | null {
  const o = out as {
    reading?: number | null;
    unit?: string | null;
    confidence?: number;
  } | null;
  if (!o || o.reading == null || !Number.isFinite(o.reading)) return null;
  const miles =
    o.unit === "km" ? Math.round(o.reading * 0.621371) : Math.round(o.reading);
  return { value: miles, confidence: o.confidence ?? null };
}

// ------------------------------------------------------------------ fuel

const FuelInput = z.object({
  vehicleId: uuid,
  gallons: z.coerce.number().positive("Enter gallons.").max(500),
  totalCents: z.coerce.number().int().min(1, "Enter the total.").max(10_000_00),
  odometer: optInt(0, 2_000_000),
  filledAt: z.coerce.date().optional(),
  receiptMediaId: optUuid,
  paidBy: z.enum(["company", "tech"]).default("company"),
  vendor: optText(120),
  clientId: uuid.optional(),
});

export const logFuel = action({
  name: "vehicles.logFuel",
  perm: "vehicles.log",
  feature: "vehicles",
  input: FuelInput,
  audit: "vehicle.fuel_logged",
  async run(ctx) {
    const { input, tx, user, actor } = ctx;
    const v = await assertVehicleAccess(tx, user, input.vehicleId, "log");
    const id = input.clientId ?? crypto.randomUUID();
    const at =
      input.filledAt && input.filledAt < new Date()
        ? input.filledAt
        : new Date();
    const settings = await getSettings();
    const tz = await getCompanyTimezone();
    const receipt = await resolveMedia(
      tx,
      input.receiptMediaId,
      "fuel",
      id,
      user.id,
    );
    const prev = await prevApprovedReading(tx, v.id, at);
    // Same-day fills + MPG baseline (previous approved fill with an odometer).
    const day = dateKey(at, tz);
    const dayStart = zonedTimeToUtc(
      { ...parseDateKey(day), hour: 0, minute: 0 },
      tz,
    );
    const dayEnd = zonedTimeToUtc(
      { ...parseDateKey(addDaysToKey(day, 1)), hour: 0, minute: 0 },
      tz,
    );
    const [{ n: sameDay } = { n: 0 }] = await tx
      .select({ n: count() })
      .from(fuelLogs)
      .where(
        and(
          eq(fuelLogs.vehicleId, v.id),
          ne(fuelLogs.approvalStatus, "rejected"),
          gte(fuelLogs.filledAt, dayStart),
          lt(fuelLogs.filledAt, dayEnd),
        ),
      );
    const fills = await tx
      .select({ gallons: fuelLogs.gallons, odo: odometerReadings.value })
      .from(fuelLogs)
      .innerJoin(
        odometerReadings,
        eq(odometerReadings.id, fuelLogs.odometerReadingId),
      )
      .where(
        and(
          eq(fuelLogs.vehicleId, v.id),
          eq(fuelLogs.approvalStatus, "approved"),
          lt(fuelLogs.filledAt, at),
        ),
      )
      .orderBy(desc(fuelLogs.filledAt))
      .limit(9);
    let avgMpg: number | null = null;
    if (fills.length >= 3) {
      const asc = [...fills].reverse();
      const miles = (asc.at(-1)?.odo ?? 0) - (asc[0]?.odo ?? 0);
      const gal = asc.slice(1).reduce((s, f) => s + f.gallons, 0);
      if (miles > 0 && gal > 0) avgMpg = miles / gal;
    }
    const flags = detectAnomalies({
      value: input.odometer,
      at,
      prev,
      maxDailyMiles: settings.vehicles.max_daily_miles,
      fuel: {
        gallons: input.gallons,
        tankGal: v.tankGal,
        prevFillOdometer: fills[0]?.odo ?? null,
        avgMpg,
        sameDayFills: Number(sameDay),
        weekendCheck: settings.vehicles.anomaly.weekend_fuel,
        mpgDropPct: settings.vehicles.anomaly.mpg_drop_pct,
        tz,
      },
    });
    let readingId: string | null = null;
    if (input.odometer != null) {
      const [r] = await tx
        .insert(odometerReadings)
        .values({
          vehicleId: v.id,
          value: input.odometer,
          source: "fuel",
          recordedBy: user.id,
          recordedAt: at,
          approvalStatus: "pending",
          flags: flags.filter((f) => f.startsWith("odometer")),
        })
        .returning({ id: odometerReadings.id });
      readingId = r?.id ?? null;
    }
    let partPurchaseId: string | null = null;
    if (input.paidBy === "tech") {
      const pp = await createPartPurchase(
        tx,
        {
          paidBy: "tech",
          instrument: "personal",
          purchaserUserId: user.id,
          category: "fuel",
          vehicleId: v.id,
          vendor: input.vendor ?? null,
          purchasedOn: day,
          totalCents: input.totalCents,
          receiptMediaId: receipt,
          notes: `${input.gallons} gal · ${v.nickname}`,
        },
        actor,
      );
      partPurchaseId = pp.partPurchaseId;
    }
    await tx.insert(fuelLogs).values({
      id,
      vehicleId: v.id,
      userId: user.id,
      gallons: input.gallons,
      totalCents: input.totalCents,
      odometerReadingId: readingId,
      receiptMediaId: receipt,
      partPurchaseId,
      filledAt: at,
      approvalStatus: "pending",
      flags,
      clientId: input.clientId ?? null,
    });
    if (!partPurchaseId) await attachTo(tx, [receipt], { type: "fuel", id });
    const ai = await queueAi(tx, "receipt", receipt, {
      entityType: "fuel",
      entityId: id,
    });
    const aiTotal = ai.done ? readReceiptTotal(ai.output) : null;
    const { outcome, missing } = await resolveOutcome({
      ctx: ctx as Ctx,
      type: "fuel",
      vehicle: v,
      flags,
      evidence: {
        type: "fuel",
        hasMedia: !!receipt,
        typed: input.totalCents,
        ai: { enabled: ai.enabled, done: ai.done, value: aiTotal },
        aiOptional: settings.vehicles.policies.fuel.ai_optional,
      },
    });
    const { approvalId } = await finalizeLog(tx, {
      type: "fuel",
      entityId: id,
      vehicle: v,
      outcome,
      flags,
      missing,
      evidence: {
        typed: {
          gallons: input.gallons,
          total_cents: input.totalCents,
          odometer: input.odometer,
          paid_by: input.paidBy,
        },
        ai: aiTotal != null ? { total_cents: aiTotal } : null,
        previous: prev
          ? { value: prev.value, at: prev.at.toISOString() }
          : null,
        tank_gal: v.tankGal,
        media_ids: receipt ? [receipt] : [],
      },
      summary: `Fuel ${input.gallons.toFixed(1)} gal`,
      requestedBy: user.id,
      actor,
    });
    return { id, status: outcome.status, approvalId, flags };
  },
  auditEntity: ({ data }) => ({ type: "fuel", id: data.id }),
  revalidate: ({ input }) => vehiclePath(input.vehicleId),
});

function readReceiptTotal(out: unknown): number | null {
  const o = out as { total_cents?: number | null } | null;
  return o && typeof o.total_cents === "number" ? o.total_cents : null;
}

// ------------------------------------------------------------------ service

const ServiceInput = z.object({
  vehicleId: uuid,
  tasks: z
    .array(z.string().trim().min(1).max(60))
    .min(1, "Pick at least one service."),
  performedOn: dayKey,
  odometer: optInt(0, 2_000_000),
  vendor: optText(120),
  costCents: optInt(0, 100_000_00),
  paidBy: z.enum(["company", "tech"]).default("company"),
  receiptMediaId: optUuid,
  notes: optText(2000),
  clientId: uuid.optional(),
});

export const logService = action({
  name: "vehicles.logService",
  perm: "vehicles.log",
  feature: "vehicles",
  input: ServiceInput,
  audit: "vehicle.service_logged",
  async run(ctx) {
    const { input, tx, user, actor } = ctx;
    const v = await assertVehicleAccess(tx, user, input.vehicleId, "log");
    const id = input.clientId ?? crypto.randomUUID();
    const settings = await getSettings();
    const receipt = await resolveMedia(
      tx,
      input.receiptMediaId,
      "service",
      id,
      user.id,
    );
    const at = zonedTimeToUtc(
      { ...parseDateKey(input.performedOn), hour: 12, minute: 0 },
      await getCompanyTimezone(),
    );
    const prev = await prevApprovedReading(tx, v.id, at);
    const flags =
      input.odometer != null
        ? detectAnomalies({
            value: input.odometer,
            at,
            prev,
            maxDailyMiles: settings.vehicles.max_daily_miles,
          })
        : [];
    let partPurchaseId: string | null = null;
    if (input.paidBy === "tech" && input.costCents) {
      const pp = await createPartPurchase(
        tx,
        {
          paidBy: "tech",
          instrument: "personal",
          purchaserUserId: user.id,
          category: "vehicle",
          vehicleId: v.id,
          vendor: input.vendor ?? null,
          purchasedOn: input.performedOn,
          totalCents: input.costCents,
          receiptMediaId: receipt,
          notes: `${v.nickname}: ${input.tasks.join(", ")}`,
        },
        actor,
      );
      partPurchaseId = pp.partPurchaseId;
    }
    const readingId = input.odometer != null ? crypto.randomUUID() : null;
    await tx.insert(serviceRecords).values({
      id,
      vehicleId: v.id,
      tasks: input.tasks,
      performedOn: input.performedOn,
      odometer: input.odometer,
      odometerReadingId: readingId,
      vendor: input.vendor ?? null,
      costCents: input.costCents,
      paidBy: input.paidBy,
      receiptMediaId: receipt,
      partPurchaseId,
      notes: input.notes ?? null,
      approvalStatus: "pending",
      createdBy: user.id,
    });
    if (readingId && input.odometer != null) {
      // Linked both ways: service_records.odometer_reading_id, and client_id = record id
      // (what the approval/edit paths match on, also for rows created before the column).
      await tx.insert(odometerReadings).values({
        id: readingId,
        vehicleId: v.id,
        value: input.odometer,
        source: "service",
        recordedBy: user.id,
        recordedAt: at,
        approvalStatus: "pending",
        flags,
        clientId: id,
      });
    }
    if (!partPurchaseId) await attachTo(tx, [receipt], { type: "service", id });
    const ai = await queueAi(tx, "shop_invoice", receipt, {
      entityType: "service",
      entityId: id,
    });
    const aiTotal = ai.done ? readReceiptTotal(ai.output) : null;
    const { outcome, missing } = await resolveOutcome({
      ctx: ctx as Ctx,
      type: "service",
      vehicle: v,
      flags,
      evidence: {
        type: "service",
        hasMedia: !!receipt,
        typed: input.costCents,
        ai: { enabled: ai.enabled, done: ai.done, value: aiTotal },
        aiOptional: settings.vehicles.policies.service.ai_optional,
      },
    });
    const { approvalId } = await finalizeLog(tx, {
      type: "service",
      entityId: id,
      vehicle: v,
      outcome,
      flags,
      missing,
      evidence: {
        typed: {
          tasks: input.tasks,
          cost_cents: input.costCents,
          odometer: input.odometer,
          vendor: input.vendor ?? null,
          paid_by: input.paidBy,
        },
        previous: prev
          ? { value: prev.value, at: prev.at.toISOString() }
          : null,
        media_ids: receipt ? [receipt] : [],
      },
      summary: `Service: ${input.tasks.join(", ").replace(/_/g, " ")}`,
      requestedBy: user.id,
      actor,
    });
    return { id, status: outcome.status, approvalId, flags };
  },
  auditEntity: ({ data }) => ({ type: "service", id: data.id }),
  revalidate: ({ input }) => vehiclePath(input.vehicleId),
});

// ------------------------------------------------------------------ documents

export const addVehicleDocument = action({
  name: "vehicles.addDocument",
  perm: "vehicles.log",
  feature: "vehicles",
  input: z.object({
    vehicleId: uuid,
    kind: z.enum([
      "registration",
      "insurance",
      "inspection",
      "lease",
      "title",
      "other",
    ]),
    mediaId: optUuid,
    expiresOn: z.preprocess((v) => (v === "" ? null : v), dayKey.nullish()),
    notes: optText(1000),
    clientId: uuid.optional(),
  }),
  audit: "vehicle.document_added",
  async run(ctx) {
    const { input, tx, user, actor } = ctx;
    const v = await assertVehicleAccess(tx, user, input.vehicleId, "log");
    const id = input.clientId ?? crypto.randomUUID();
    const file = await resolveMedia(tx, input.mediaId, "document", id, user.id);
    if (!file)
      throw new ValidationError({
        mediaId: ["Add a photo or PDF of the document."],
      });
    const needsExpiry = ["registration", "insurance", "inspection"].includes(
      input.kind,
    );
    const { outcome, missing } = await resolveOutcome({
      ctx: ctx as Ctx,
      type: "document",
      vehicle: v,
      flags: [],
      evidence: {
        type: "document",
        hasMedia: true,
        aiOptional: true,
        documentExpiryOk: !needsExpiry || !!input.expiresOn,
      },
    });
    await tx.insert(vehicleDocuments).values({
      id,
      vehicleId: v.id,
      kind: input.kind,
      mediaId: file,
      expiresOn: input.expiresOn ?? null,
      notes: input.notes ?? null,
      approvalStatus: "pending",
      createdBy: user.id,
    });
    await attachTo(tx, [file], { type: "document", id });
    const { approvalId } = await finalizeLog(tx, {
      type: "document",
      entityId: id,
      vehicle: v,
      outcome,
      flags: [],
      missing,
      evidence: {
        typed: { kind: input.kind, expires_on: input.expiresOn ?? null },
        media_ids: [file],
      },
      summary: `Document: ${input.kind}`,
      requestedBy: user.id,
      actor,
    });
    return { id, status: outcome.status, approvalId };
  },
  auditEntity: ({ data }) => ({ type: "document", id: data.id }),
  revalidate: ({ input }) => vehiclePath(input.vehicleId),
});

// ------------------------------------------------------------------ inspections

export const submitInspection = action({
  name: "vehicles.submitInspection",
  perm: "vehicles.log",
  feature: "vehicles",
  input: z.object({
    vehicleId: uuid,
    results: z.record(
      z.string(),
      z.object({ ok: z.boolean(), note: optText(300) }),
    ),
    mediaIds: z.array(uuid).max(12).default([]),
    clientId: uuid.optional(),
  }),
  audit: "vehicle.inspection_submitted",
  async run(ctx) {
    const { input, tx, user, actor } = ctx;
    const v = await assertVehicleAccess(tx, user, input.vehicleId, "log");
    const id = input.clientId ?? crypto.randomUUID();
    const attached = await mediaForEntity(tx, "inspection", id);
    const mediaIds = [...new Set([...input.mediaIds, ...attached])];
    const complete = INSPECTION_ITEMS.every(
      (i) => input.results[i.key] != null,
    );
    const failed = Object.values(input.results).filter((r) => !r.ok).length;
    const passed = failed === 0;
    const { outcome, missing } = await resolveOutcome({
      ctx: ctx as Ctx,
      type: "inspection",
      vehicle: v,
      flags: [],
      evidence: {
        type: "inspection",
        hasMedia: mediaIds.length > 0,
        aiOptional: true,
        checklistComplete: complete,
        failedItemsHavePhotos: passed || mediaIds.length > 0,
      },
    });
    await tx.insert(inspections).values({
      id,
      vehicleId: v.id,
      userId: user.id,
      results: input.results,
      passed,
      mediaIds,
      approvalStatus: "pending",
      clientId: input.clientId ?? null,
    });
    await attachTo(tx, mediaIds, { type: "inspection", id });
    const { approvalId } = await finalizeLog(tx, {
      type: "inspection",
      entityId: id,
      vehicle: v,
      outcome,
      flags: [],
      missing,
      evidence: { typed: { passed, failed }, media_ids: mediaIds },
      summary: passed
        ? "Inspection passed"
        : `Inspection: ${failed} item(s) failed`,
      requestedBy: user.id,
      actor,
    });
    return { id, status: outcome.status, approvalId, passed };
  },
  auditEntity: ({ data }) => ({ type: "inspection", id: data.id }),
  revalidate: ({ input }) => vehiclePath(input.vehicleId),
});

// ------------------------------------------------------------------ issues

export const reportVehicleIssue = action({
  name: "vehicles.reportIssue",
  perm: "vehicles.report_issue",
  feature: "vehicles",
  input: z.object({
    vehicleId: uuid,
    description: z.string().trim().min(3, "Describe the problem.").max(2000),
    severity: z.enum(["low", "medium", "high", "unsafe"]),
    canDrive: z.boolean(),
    mediaIds: z.array(uuid).max(12).default([]),
    clientId: uuid.optional(),
  }),
  audit: "vehicle.issue_reported",
  async run({ input, tx, user, emit, activity }) {
    const v = await assertVehicleAccess(tx, user, input.vehicleId, "view");
    const id = input.clientId ?? crypto.randomUUID();
    const attached = await mediaForEntity(tx, "vehicle_issue", id);
    const mediaIds = [...new Set([...input.mediaIds, ...attached])];
    await tx.insert(vehicleIssues).values({
      id,
      vehicleId: v.id,
      reportedBy: user.id,
      description: input.description,
      severity: input.severity,
      canDrive: input.canDrive,
      mediaIds,
    });
    await attachTo(tx, mediaIds, { type: "vehicle_issue", id });
    await emit(
      "vehicle.issue_reported",
      { type: "vehicle", id: v.id },
      {
        issue_id: id,
        severity: input.severity,
      },
    );
    await activity({
      entity: { type: "vehicle", id: v.id },
      kind: "vehicle.issue_reported",
      summary: `Issue reported (${input.severity}${input.canDrive ? "" : ", not drivable"})`,
      data: { issue_id: id },
    });
    return { id };
  },
  auditEntity: ({ data }) => ({ type: "vehicle_issue", id: data.id }),
  revalidate: ({ input }) => vehiclePath(input.vehicleId),
});

export const updateVehicleIssue = action({
  perm: "vehicles.manage",
  feature: "vehicles",
  input: z.object({
    issueId: uuid,
    status: z.enum(["acknowledged", "in_repair", "resolved", "open"]),
    resolution: optText(2000),
  }),
  audit: "vehicle.issue_updated",
  async run({ input, tx, user, activity }) {
    const [issue] = await tx
      .select()
      .from(vehicleIssues)
      .where(eq(vehicleIssues.id, input.issueId))
      .limit(1);
    if (!issue) throw new NotFoundError("Issue");
    if (input.status === "resolved" && !input.resolution)
      throw new ValidationError({ resolution: ["Say how it was resolved."] });
    const now = new Date();
    await tx
      .update(vehicleIssues)
      .set({
        status: input.status,
        acknowledgedAt:
          issue.acknowledgedAt ?? (input.status !== "open" ? now : null),
        acknowledgedBy:
          issue.acknowledgedBy ?? (input.status !== "open" ? user.id : null),
        resolvedAt: input.status === "resolved" ? now : null,
        resolution:
          input.status === "resolved"
            ? (input.resolution ?? null)
            : issue.resolution,
      })
      .where(eq(vehicleIssues.id, issue.id));
    await activity({
      entity: { type: "vehicle", id: issue.vehicleId },
      kind: `vehicle.issue_${input.status}`,
      summary: `Issue ${input.status.replace("_", " ")}`,
      data: { issue_id: issue.id },
    });
    return { id: issue.id, vehicleId: issue.vehicleId };
  },
  auditEntity: ({ data }) => ({ type: "vehicle_issue", id: data.id }),
  revalidate: ({ data }) => vehiclePath(data.vehicleId),
});

// ------------------------------------------------------------------ trips

export const saveTrip = action({
  name: "vehicles.saveTrip",
  perm: "vehicles.log",
  feature: "vehicles",
  input: z.object({
    id: uuid.optional(),
    vehicleId: uuid,
    tripDate: dayKey,
    startOdometer: optInt(0, 2_000_000),
    endOdometer: optInt(0, 2_000_000),
    miles: z.coerce.number().min(0).max(2000),
    purpose: optText(300),
    classification: z.enum(["business", "commute", "personal"]),
    submit: z.boolean().default(true),
  }),
  audit: "vehicle.trip_saved",
  async run(ctx) {
    const { input, tx, user, actor } = ctx;
    const v = await assertVehicleAccess(tx, user, input.vehicleId, "log");
    const manage = user.perms.has("vehicles.manage");
    // One trip per tech, vehicle and day. Saving without an id for a day that
    // already has a trip edits that trip — through the same lock guards, so an
    // approved (possibly reimbursed) or in-review trip is never overwritten
    // (QA T5-15).
    const [sameDay] = input.id
      ? []
      : await tx
          .select({ id: trips.id })
          .from(trips)
          .where(
            and(
              eq(trips.userId, user.id),
              eq(trips.vehicleId, v.id),
              eq(trips.tripDate, input.tripDate),
            ),
          )
          .limit(1);
    let tripId = input.id ?? sameDay?.id;
    let ownerId = user.id;
    if (tripId) {
      const [t] = await tx
        .select()
        .from(trips)
        .where(eq(trips.id, tripId))
        .limit(1);
      if (!t) throw new NotFoundError("Trip");
      if (t.userId !== user.id && !manage) throw new ForbiddenError();
      if (t.approvalStatus === "approved" || t.ledgerEntryId)
        throw new ConflictError(
          "trip_locked",
          sameDay
            ? "You already have an approved trip for this day. Ask an admin to change it."
            : "Approved trips can't be edited.",
        );
      const [open] = await tx
        .select({ id: approvals.id })
        .from(approvals)
        .where(
          and(
            eq(approvals.entityType, "trip"),
            eq(approvals.entityId, t.id),
            eq(approvals.status, "pending"),
          ),
        )
        .limit(1);
      if (open)
        throw new ConflictError(
          "trip_in_review",
          sameDay
            ? "Your trip for this day is already in review."
            : "This trip is already in review.",
        );
      ownerId = t.userId;
      // Moving an edited trip onto another day/vehicle must not collide with
      // (or silently replace) a different trip.
      if (t.vehicleId !== v.id || t.tripDate !== input.tripDate) {
        const [clash] = await tx
          .select({ id: trips.id })
          .from(trips)
          .where(
            and(
              eq(trips.userId, ownerId),
              eq(trips.vehicleId, v.id),
              eq(trips.tripDate, input.tripDate),
              ne(trips.id, t.id),
            ),
          )
          .limit(1);
        if (clash)
          throw new ConflictError(
            "trip_exists",
            "There's already a trip for that day. Edit that one instead.",
          );
      }
    }
    const s = input.startOdometer;
    const e = input.endOdometer;
    if (s != null && e != null && e < s)
      throw new ValidationError({ endOdometer: ["End must be after start."] });
    const miles = s != null && e != null ? e - s : input.miles;
    const reimbursable =
      v.ownership === "tech_owned" && input.classification === "business";
    const values = {
      userId: ownerId,
      vehicleId: v.id,
      tripDate: input.tripDate,
      startOdometer: s,
      endOdometer: e,
      miles,
      purpose: input.purpose ?? null,
      classification: input.classification,
      reimbursable,
      approvalStatus: "pending" as const,
    };
    if (tripId) {
      await tx.update(trips).set(values).where(eq(trips.id, tripId));
    } else {
      // Never an upsert: a concurrent save for the same day loses, it doesn't
      // overwrite.
      const [row] = await tx
        .insert(trips)
        .values(values)
        .onConflictDoNothing({
          target: [trips.userId, trips.tripDate, trips.vehicleId],
        })
        .returning({ id: trips.id });
      if (!row)
        throw new ConflictError(
          "trip_exists",
          "A trip for this day was just saved. Refresh and edit it.",
        );
      tripId = row.id;
    }
    if (!input.submit)
      return { id: tripId, status: "pending" as const, approvalId: null };
    const settings = await getSettings();
    const flags =
      miles > settings.vehicles.max_daily_miles ? ["odometer_jump"] : [];
    const { outcome, missing } = await resolveOutcome({
      ctx: ctx as Ctx,
      type: "trip",
      vehicle: v,
      flags,
      evidence: {
        type: "trip",
        hasMedia: false,
        aiOptional: true,
        tripConsistent: s != null && e != null && e >= s,
      },
    });
    const { approvalId } = await finalizeLog(tx, {
      type: "trip",
      entityId: tripId,
      vehicle: v,
      outcome,
      flags,
      missing,
      evidence: {
        typed: {
          miles,
          start: s,
          end: e,
          classification: input.classification,
          trip_date: input.tripDate,
          reimbursable,
        },
      },
      summary: `Trip ${input.tripDate}: ${miles} mi ${input.classification}`,
      requestedBy: ownerId,
      actor,
    });
    return { id: tripId, status: outcome.status, approvalId };
  },
  auditEntity: ({ data }) => ({ type: "trip", id: data.id }),
  revalidate: ({ input }) => vehiclePath(input.vehicleId),
});

// ------------------------------------------------------------------ reminder rules

export const saveReminderRule = action({
  perm: "vehicles.manage",
  feature: "vehicles",
  input: z.object({
    id: uuid.optional(),
    vehicleId: uuid,
    task: z.string().trim().min(1).max(60),
    intervalMiles: optInt(0, 1_000_000),
    intervalDays: optInt(0, 3650),
    dueSoonMiles: optInt(0, 100_000),
    dueSoonDays: optInt(0, 365),
    lastDoneOn: z.preprocess((v) => (v === "" ? null : v), dayKey.nullish()),
    lastDoneOdometer: optInt(0, 2_000_000),
    active: z.boolean().default(true),
  }),
  audit: "vehicle.reminder_rule_saved",
  async run({ input, tx }) {
    const task = taskFromInput(input.task);
    const values = {
      vehicleId: input.vehicleId,
      task,
      intervalMiles: input.intervalMiles,
      intervalDays: input.intervalDays,
      dueSoonMiles: input.dueSoonMiles,
      dueSoonDays: input.dueSoonDays,
      lastDoneOn: input.lastDoneOn ?? null,
      lastDoneOdometer: input.lastDoneOdometer,
      active: input.active,
      updatedAt: new Date(),
    };
    let id = input.id;
    if (id) {
      await tx
        .update(vehicleReminderRules)
        .set(values)
        .where(eq(vehicleReminderRules.id, id));
    } else {
      const [r] = await tx
        .insert(vehicleReminderRules)
        .values(values)
        .onConflictDoUpdate({
          target: [vehicleReminderRules.vehicleId, vehicleReminderRules.task],
          set: values,
        })
        .returning({ id: vehicleReminderRules.id });
      id = r?.id;
    }
    await recomputeReminders(tx, input.vehicleId);
    return { id: id as string };
  },
  auditEntity: ({ input }) => ({ type: "vehicle", id: input.vehicleId }),
  revalidate: ({ input }) => vehiclePath(input.vehicleId),
});

export const deleteReminderRule = action({
  perm: "vehicles.manage",
  feature: "vehicles",
  input: z.object({ id: uuid }),
  audit: "vehicle.reminder_rule_deleted",
  async run({ input, tx }) {
    const [r] = await tx
      .delete(vehicleReminderRules)
      .where(eq(vehicleReminderRules.id, input.id))
      .returning({
        vehicleId: vehicleReminderRules.vehicleId,
        task: vehicleReminderRules.task,
      });
    if (!r) throw new NotFoundError("Reminder");
    return { vehicleId: r.vehicleId, task: r.task };
  },
  auditEntity: ({ data }) => ({ type: "vehicle", id: data.vehicleId }),
  revalidate: ({ data }) => vehiclePath(data.vehicleId),
});

// ------------------------------------------------------------------ approvals

const Edits = z
  .object({
    value: optInt(0, 2_000_000),
    gallons: optNum(0, 500),
    totalCents: optInt(0, 10_000_00),
    odometer: optInt(0, 2_000_000),
    costCents: optInt(0, 100_000_00),
    tasks: z.array(z.string().trim().min(1).max(60)).optional(),
    expiresOn: z.preprocess((v) => (v === "" ? null : v), dayKey.nullish()),
    miles: optNum(0, 2000),
  })
  .partial();

export const decideVehicleApproval = action({
  perm: "vehicles.log_approve",
  feature: "vehicles",
  input: z.object({
    approvalId: uuid,
    decision: z.enum(["approved", "rejected"]),
    reason: optText(500),
    edits: Edits.optional(),
  }),
  audit: "vehicle.log_decided",
  async run({ input, tx, actor }) {
    if (input.decision === "rejected" && !input.reason)
      throw new ValidationError({ reason: ["Give the tech a reason."] });
    const [a] = await tx
      .select({
        id: approvals.id,
        entityType: approvals.entityType,
        evidence: approvals.evidence,
      })
      .from(approvals)
      .where(eq(approvals.id, input.approvalId))
      .limit(1);
    if (!a) throw new NotFoundError("Review item");
    const edits = Object.fromEntries(
      Object.entries(input.edits ?? {}).filter(([, v]) => v != null),
    );
    await decideApproval(
      tx,
      input.approvalId,
      {
        decision: input.decision,
        reason: input.reason ?? null,
        edits: Object.keys(edits).length ? edits : undefined,
      },
      actor,
    );
    const vehicleId =
      (a.evidence as { vehicle_id?: string } | null)?.vehicle_id ?? null;
    return { id: a.id, vehicleId };
  },
  auditEntity: ({ input }) => ({ type: "approval", id: input.approvalId }),
  revalidate: ({ data }) => [
    "/vehicles/approvals",
    "/approvals",
    "/vehicles",
    ...(data.vehicleId ? [`/vehicles/${data.vehicleId}`] : []),
  ],
});

export const approveAllCleanVehicleLogs = action({
  perm: "vehicles.log_approve",
  feature: "vehicles",
  input: z.object({ approvalIds: z.array(uuid).min(1).max(200) }),
  audit: "vehicle.logs_bulk_approved",
  async run({ input, tx, actor }) {
    const { getApprovalKind } = await import("@/features/approvals/registry");
    const rows = await tx
      .select()
      .from(approvals)
      .where(
        and(
          inArray(approvals.id, input.approvalIds),
          eq(approvals.status, "pending"),
        ),
      );
    let approved = 0;
    for (const r of rows) {
      const kind = getApprovalKind(r.entityType as never);
      const row = {
        ...r,
        evidence: (r.evidence as Record<string, unknown> | null) ?? null,
      } as Parameters<NonNullable<NonNullable<typeof kind>["clean"]>>[0];
      if (!kind?.clean?.(row)) continue;
      if (!(await isStillClean(tx, r.entityType as VehicleLogType, r.entityId)))
        continue;
      await decideApproval(tx, r.id, { decision: "approved" }, actor);
      approved++;
    }
    return { approved, skipped: input.approvalIds.length - approved };
  },
  revalidate: () => ["/vehicles/approvals", "/approvals", "/vehicles"],
});

/** Live re-check before bulk approval: no flags on the row, AI (if any) not mismatched. */
async function isStillClean(
  tx: Tx,
  type: VehicleLogType,
  id: string,
): Promise<boolean> {
  if (type === "odometer") {
    const [r] = await tx
      .select()
      .from(odometerReadings)
      .where(eq(odometerReadings.id, id))
      .limit(1);
    if (!r || r.flags.length) return false;
    if (
      r.aiValue != null &&
      Math.abs(r.aiValue - r.value) > Math.max(1, r.value * 0.005)
    )
      return false;
    return true;
  }
  if (type === "fuel") {
    const [r] = await tx
      .select({ flags: fuelLogs.flags })
      .from(fuelLogs)
      .where(eq(fuelLogs.id, id))
      .limit(1);
    return !!r && r.flags.length === 0;
  }
  return true;
}

// ------------------------------------------------------------------ AI assist

export const requestMaintenanceSuggestion = action({
  perm: "vehicles.manage",
  feature: "vehicles",
  input: z.object({ vehicleId: uuid }),
  audit: "vehicle.ai_maintenance_requested",
  async run({ input, tx }) {
    if (!aiEnabled())
      throw new ConflictError("ai_off", "AI assist is off (AI_PROVIDER=none).");
    const [v] = await tx
      .select()
      .from(vehicles)
      .where(eq(vehicles.id, input.vehicleId))
      .limit(1);
    if (!v) throw new NotFoundError("Vehicle");
    const recent = await tx
      .select({
        tasks: serviceRecords.tasks,
        on: serviceRecords.performedOn,
        odo: serviceRecords.odometer,
      })
      .from(serviceRecords)
      .where(
        and(
          eq(serviceRecords.vehicleId, v.id),
          eq(serviceRecords.approvalStatus, "approved"),
        ),
      )
      .orderBy(desc(serviceRecords.performedOn))
      .limit(8);
    // Vehicle data only — no names, plates, addresses or customer data (SPEC §9.4).
    const context = [
      `Vehicle: ${[v.year, v.make, v.model, v.trim].filter(Boolean).join(" ")}`,
      v.engine ? `Engine: ${v.engine}` : null,
      v.fuelType ? `Fuel: ${v.fuelType}` : null,
      v.gvwrLbs ? `GVWR: ${v.gvwrLbs} lb` : null,
      `Odometer: ${v.odometerCached ?? "unknown"} mi`,
      v.avgDailyMiles ? `Average: ${v.avgDailyMiles} mi/day` : null,
      `Service history: ${
        recent.length
          ? recent
              .map(
                (r) =>
                  `${r.tasks.join("+")} on ${r.on}${r.odo ? ` at ${r.odo} mi` : ""}`,
              )
              .join("; ")
          : "none logged"
      }`,
    ]
      .filter(Boolean)
      .join("\n");
    const res = await queueAiTask(tx, {
      kind: "maintenance_suggest",
      mediaIds: [],
      ref: { module: "vehicles", entityType: "vehicle", entityId: v.id },
      context,
    });
    const decoded = (v.decoded as Record<string, unknown> | null) ?? {};
    await tx
      .update(vehicles)
      .set({
        decoded: {
          ...decoded,
          _ai_maintenance: {
            task_id: res.aiTaskId,
            at: new Date().toISOString(),
          },
        },
        updatedAt: new Date(),
      })
      .where(eq(vehicles.id, v.id));
    return { aiTaskId: res.aiTaskId, status: res.status };
  },
  auditEntity: ({ input }) => ({ type: "vehicle", id: input.vehicleId }),
  revalidate: ({ input }) => [`/vehicles/${input.vehicleId}`],
});

export const explainVehicleFlags = action({
  perm: "vehicles.log_approve",
  feature: "vehicles",
  input: z.object({ approvalId: uuid }),
  async run({ input, tx }) {
    if (!aiEnabled())
      throw new ConflictError("ai_off", "AI assist is off (AI_PROVIDER=none).");
    const [a] = await tx
      .select()
      .from(approvals)
      .where(eq(approvals.id, input.approvalId))
      .limit(1);
    if (!a) throw new NotFoundError("Review item");
    const ev = (a.evidence ?? {}) as {
      flags?: string[];
      missing?: string[];
      typed?: unknown;
      previous?: unknown;
      tank_gal?: unknown;
    };
    const context = [
      `Entry type: ${LOG_LABEL[a.entityType as VehicleLogType] ?? a.entityType}`,
      `Flags: ${(ev.flags ?? []).join(", ") || "none"}`,
      `Missing evidence: ${(ev.missing ?? []).join(", ") || "none"}`,
      `Typed values: ${JSON.stringify(ev.typed ?? {})}`,
      `Previous approved reading: ${JSON.stringify(ev.previous ?? null)}`,
      ev.tank_gal ? `Tank size: ${ev.tank_gal} gal` : null,
    ]
      .filter(Boolean)
      .join("\n");
    const res = await queueAiTask(tx, {
      kind: "explain_flags",
      mediaIds: [],
      ref: {
        module: "vehicles",
        entityType: a.entityType,
        entityId: a.entityId,
      },
      context,
    });
    return { aiTaskId: res.aiTaskId };
  },
});

/** Poll an AI text result (maintenance suggestion / flag explanation). */
export async function getVehicleAiResult(
  aiTaskId: string,
): Promise<{ status: string; text: string | null; error: string | null }> {
  await requireUser("vehicles.view_all");
  if (!/^[0-9a-f-]{36}$/i.test(aiTaskId))
    return { status: "failed", text: null, error: "Bad id" };
  const [t] = await db
    .select({
      status: aiTasks.status,
      output: aiTasks.output,
      error: aiTasks.error,
      kind: aiTasks.kind,
    })
    .from(aiTasks)
    .where(eq(aiTasks.id, aiTaskId))
    .limit(1);
  if (!t || !["maintenance_suggest", "explain_flags"].includes(t.kind))
    return { status: "failed", text: null, error: "Not found" };
  const text = (t.output as { text?: string } | null)?.text ?? null;
  return {
    status: t.status,
    text,
    error: t.status === "done" ? null : t.error,
  };
}

// ------------------------------------------------------------------ settings

/** A whole number in range; blank or non-numeric input gets the same friendly message. */
const settingNum = (min: number, max: number, message: string) =>
  z.preprocess(
    (v) =>
      typeof v === "string" ? (v.trim() === "" ? undefined : Number(v)) : v,
    z
      .number({ error: message })
      .int({ error: message })
      .min(min, { error: message })
      .max(max, { error: message }),
  );

const PolicyInput = z.object({
  tech_can_log: z.boolean(),
  approval: z.enum(["auto", "auto_if_evidence", "always_review"]),
  ai_optional: z.boolean(),
});

export const saveVehicleSettings = action({
  perm: "settings.manage",
  input: z.object({
    policies: z.object({
      odometer: PolicyInput,
      fuel: PolicyInput,
      service: PolicyInput,
      document: PolicyInput,
      inspection: PolicyInput,
      trip: PolicyInput,
    }),
    inspection_frequency: z.enum(["none", "daily", "weekly"]),
    require_odometer_on_clock: z.boolean(),
    max_daily_miles: settingNum(50, 2000, "Enter 50 to 2,000 miles."),
    anomaly: z.object({
      weekend_fuel: z.boolean(),
      mpg_drop_pct: settingNum(5, 90, "Enter 5 to 90 percent."),
    }),
    issue_ack_target_minutes: settingNum(
      5,
      10_080,
      "Enter 5 to 10,080 minutes (one week).",
    ),
    reminder_seeds: z
      .array(
        z.object({
          task: z
            .string()
            .trim()
            .min(1, "Name the task.")
            .max(60, "Keep it under 60 characters.")
            .transform(taskFromInput),
          interval_miles: z.coerce.number().int().min(0).nullable(),
          interval_days: z.coerce.number().int().min(0).nullable(),
          due_soon_miles: z.coerce.number().int().min(0).nullable(),
          due_soon_days: z.coerce.number().int().min(0).nullable(),
        }),
      )
      .max(30),
  }),
  async run({ input, tx, actor }) {
    await updateSettings(tx, { vehicles: input }, actor);
    return { ok: true };
  },
  revalidate: () => ["/settings/vehicles", "/vehicles"],
});
