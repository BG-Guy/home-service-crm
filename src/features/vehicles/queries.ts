import "server-only";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  type SQL,
  sql,
} from "drizzle-orm";
import { notFound } from "next/navigation";
import { cache } from "react";
import type { Recall } from "@/adapters/vin/types";
import { db } from "@/db";
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
import type { ApprovalRow } from "@/features/approvals/contracts";
import { getMediaUrls } from "@/features/media/api";
import { requireAnyPerm, requireUser } from "@/lib/auth/current";
import { getCompanyTimezone } from "@/lib/settings";
import { dateKey } from "@/lib/time";
import type { SessionUser } from "@/lib/types";
import type {
  ReminderRuleDto,
  VehicleListItem,
  VehicleOwnership,
  VehicleStatus,
} from "./contracts";
import { canViewVehicle, type VehicleRow } from "./engine";
import { loadReviewItem, type ReviewItem } from "./review";
import { computeMpg, taskLabel } from "./rules";

// Read DAL for vehicles (SPEC M17). Every export calls requireAnyPerm() first and
// enforces the row scope: `vehicles.view_all`, or the vehicle assigned to the viewer.

const VIEW = ["vehicles.view_own", "vehicles.view_all"] as const;
export const VEHICLE_KINDS = [
  "odometer",
  "fuel",
  "service",
  "document",
  "inspection",
  "trip",
] as const;

export const viewer = cache(() => requireAnyPerm([...VIEW]));

function scope(user: SessionUser): SQL | undefined {
  return user.perms.has("vehicles.view_all")
    ? undefined
    : eq(vehicles.assignedUserId, user.id);
}

const describe = (v: Pick<VehicleRow, "year" | "make" | "model">) =>
  [v.year, v.make, v.model].filter(Boolean).join(" ");

async function firstPhotos(
  entityType: string,
  ids: string[],
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const rows = await db
    .select({ id: media.id, entityId: media.entityId })
    .from(media)
    .where(
      and(
        eq(media.entityType, entityType),
        inArray(media.entityId, ids),
        eq(media.kind, "photo"),
        isNull(media.deletedAt),
      ),
    )
    .orderBy(asc(media.createdAt));
  const first = new Map<string, string>();
  for (const r of rows)
    if (r.entityId && !first.has(r.entityId)) first.set(r.entityId, r.id);
  const urls = await getMediaUrls([...first.values()], "thumb");
  const out: Record<string, string> = {};
  for (const [entityId, mid] of first) if (urls[mid]) out[entityId] = urls[mid];
  return out;
}

/** Fleet list (fleet for view_all; otherwise "my vehicle"). */
export const listFleet = cache(
  async (
    opts: { status?: VehicleStatus | "all" } = {},
  ): Promise<VehicleListItem[]> => {
    const user = await viewer();
    const status =
      opts.status && opts.status !== "all"
        ? eq(vehicles.status, opts.status)
        : opts.status === "all"
          ? undefined
          : sql`${vehicles.status} <> 'retired'`;
    const rows = await db
      .select({ v: vehicles, assigneeName: users.name })
      .from(vehicles)
      .leftJoin(users, eq(users.id, vehicles.assignedUserId))
      .where(and(isNull(vehicles.deletedAt), scope(user), status))
      .orderBy(asc(vehicles.nickname));
    const ids = rows.map((r) => r.v.id);
    if (ids.length === 0) return [];
    const [reminders, issues, pending, photos] = await Promise.all([
      db
        .select({
          vehicleId: vehicleReminderRules.vehicleId,
          status: vehicleReminderRules.status,
          n: count(),
        })
        .from(vehicleReminderRules)
        .where(
          and(
            inArray(vehicleReminderRules.vehicleId, ids),
            eq(vehicleReminderRules.active, true),
          ),
        )
        .groupBy(vehicleReminderRules.vehicleId, vehicleReminderRules.status),
      db
        .select({ vehicleId: vehicleIssues.vehicleId, n: count() })
        .from(vehicleIssues)
        .where(
          and(
            inArray(vehicleIssues.vehicleId, ids),
            sql`${vehicleIssues.status} <> 'resolved'`,
          ),
        )
        .groupBy(vehicleIssues.vehicleId),
      db
        .select({
          vehicleId: sql<string>`(${approvals.evidence}->>'vehicle_id')`,
          n: count(),
        })
        .from(approvals)
        .where(
          and(
            eq(approvals.status, "pending"),
            inArray(approvals.entityType, [...VEHICLE_KINDS]),
          ),
        )
        .groupBy(sql`(${approvals.evidence}->>'vehicle_id')`),
      firstPhotos("vehicle", ids),
    ]);
    const rem = new Map<string, { overdue: number; dueSoon: number }>();
    for (const r of reminders) {
      const cur = rem.get(r.vehicleId) ?? { overdue: 0, dueSoon: 0 };
      if (r.status === "overdue") cur.overdue += Number(r.n);
      if (r.status === "due_soon") cur.dueSoon += Number(r.n);
      rem.set(r.vehicleId, cur);
    }
    const iss = new Map(issues.map((r) => [r.vehicleId, Number(r.n)]));
    const pen = new Map(pending.map((r) => [r.vehicleId, Number(r.n)]));
    return rows.map(({ v, assigneeName }) => ({
      id: v.id,
      nickname: v.nickname,
      description: describe(v),
      plate: v.plate
        ? `${v.plate}${v.plateState ? ` · ${v.plateState}` : ""}`
        : null,
      status: v.status as VehicleStatus,
      ownership: v.ownership as VehicleOwnership,
      assignee:
        v.assignedUserId && assigneeName
          ? { id: v.assignedUserId, name: assigneeName }
          : null,
      odometer: v.odometerCached,
      overdue: rem.get(v.id)?.overdue ?? 0,
      dueSoon: rem.get(v.id)?.dueSoon ?? 0,
      openIssues: iss.get(v.id) ?? 0,
      pendingLogs: pen.get(v.id) ?? 0,
      photoUrl: photos[v.id] ?? null,
    }));
  },
);

/** Vehicle + assignee with the row-scope check (404 when out of scope). */
export const getVehicle = cache(async (id: string) => {
  const user = await viewer();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [row] = await db
    .select({ v: vehicles, assigneeName: users.name })
    .from(vehicles)
    .leftJoin(users, eq(users.id, vehicles.assignedUserId))
    .where(and(eq(vehicles.id, id), isNull(vehicles.deletedAt)))
    .limit(1);
  if (!row || !canViewVehicle(user, row.v)) notFound();
  const photoIds = (
    await db
      .select({ id: media.id })
      .from(media)
      .where(
        and(
          eq(media.entityType, "vehicle"),
          eq(media.entityId, id),
          eq(media.kind, "photo"),
          isNull(media.deletedAt),
        ),
      )
      .orderBy(asc(media.createdAt))
      .limit(8)
  ).map((r) => r.id);
  const [thumbs, fulls] = await Promise.all([
    getMediaUrls(photoIds, "thumb"),
    getMediaUrls(photoIds, "full"),
  ]);
  return {
    vehicle: row.v,
    assigneeName: row.assigneeName,
    description: describe(row.v),
    photos: photoIds.map((pid) => ({
      id: pid,
      thumbUrl: thumbs[pid] ?? "",
      url: fulls[pid] ?? "",
    })),
  };
});

export async function listReminderRules(
  vehicleId: string,
): Promise<ReminderRuleDto[]> {
  await getVehicle(vehicleId);
  const rows = await db
    .select()
    .from(vehicleReminderRules)
    .where(eq(vehicleReminderRules.vehicleId, vehicleId))
    .orderBy(
      sql`case ${vehicleReminderRules.status} when 'overdue' then 0 when 'due_soon' then 1 else 2 end`,
      asc(vehicleReminderRules.nextDueOn),
    );
  return rows.map((r) => ({
    id: r.id,
    task: r.task,
    label: taskLabel(r.task),
    intervalMiles: r.intervalMiles,
    intervalDays: r.intervalDays,
    dueSoonMiles: r.dueSoonMiles,
    dueSoonDays: r.dueSoonDays,
    lastDoneOn: r.lastDoneOn,
    lastDoneOdometer: r.lastDoneOdometer,
    nextDueOn: r.nextDueOn,
    nextDueMiles: r.nextDueMiles,
    status: r.status as ReminderRuleDto["status"],
    active: r.active,
  }));
}

async function nameMap(ids: (string | null)[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (list.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, list));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Pending approval ids keyed by entity id (for "in review" chips). */
async function pendingApprovalIds(
  type: (typeof VEHICLE_KINDS)[number],
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: approvals.id, entityId: approvals.entityId })
    .from(approvals)
    .where(
      and(
        eq(approvals.entityType, type),
        inArray(approvals.entityId, ids),
        eq(approvals.status, "pending"),
      ),
    );
  return new Map(rows.map((r) => [r.entityId, r.id]));
}

export interface LogEntryDto {
  id: string;
  type: "odometer" | "fuel" | "inspection";
  at: string;
  title: string;
  subtitle: string;
  status: "pending" | "approved" | "rejected";
  flags: string[];
  inReview: boolean;
  by: string | null;
  thumbUrl: string | null;
  fullUrl: string | null;
}

/** Logs tab: odometer, fuel (with MPG) and inspections, newest first. */
export async function listVehicleLogs(
  vehicleId: string,
  limit = 60,
): Promise<LogEntryDto[]> {
  await getVehicle(vehicleId);
  const [odo, fuel, insp] = await Promise.all([
    db
      .select()
      .from(odometerReadings)
      .where(eq(odometerReadings.vehicleId, vehicleId))
      .orderBy(desc(odometerReadings.recordedAt))
      .limit(limit),
    db
      .select({ f: fuelLogs, odo: odometerReadings.value })
      .from(fuelLogs)
      .leftJoin(
        odometerReadings,
        eq(odometerReadings.id, fuelLogs.odometerReadingId),
      )
      .where(eq(fuelLogs.vehicleId, vehicleId))
      .orderBy(desc(fuelLogs.filledAt))
      .limit(limit),
    db
      .select()
      .from(inspections)
      .where(eq(inspections.vehicleId, vehicleId))
      .orderBy(desc(inspections.createdAt))
      .limit(20),
  ]);
  const fuelReadingIds = new Set(
    fuel.map((r) => r.f.odometerReadingId).filter(Boolean),
  );
  const odoOnly = odo.filter((r) => !fuelReadingIds.has(r.id));
  const mediaIds = [
    ...odoOnly.map((r) => r.photoMediaId),
    ...fuel.map((r) => r.f.receiptMediaId),
    ...insp.map((r) => r.mediaIds[0] ?? null),
  ].filter((x): x is string => !!x);
  const [thumbs, fulls, names, pOdo, pFuel, pInsp] = await Promise.all([
    getMediaUrls(mediaIds, "thumb"),
    getMediaUrls(mediaIds, "full"),
    nameMap([
      ...odoOnly.map((r) => r.recordedBy),
      ...fuel.map((r) => r.f.userId),
      ...insp.map((r) => r.userId),
    ]),
    pendingApprovalIds(
      "odometer",
      odoOnly.map((r) => r.id),
    ),
    pendingApprovalIds(
      "fuel",
      fuel.map((r) => r.f.id),
    ),
    pendingApprovalIds(
      "inspection",
      insp.map((r) => r.id),
    ),
  ]);
  const fmt = new Intl.NumberFormat("en-US");
  // MPG: approved fills in chronological order.
  const fillsAsc = [...fuel]
    .filter((r) => r.f.approvalStatus !== "rejected")
    .reverse();
  const mpgById = new Map<string, number | null>();
  let prevOdo: number | null = null;
  for (const r of fillsAsc) {
    mpgById.set(r.f.id, computeMpg(r.odo, prevOdo, r.f.gallons));
    if (r.odo != null) prevOdo = r.odo;
  }
  const out: LogEntryDto[] = [
    ...odoOnly.map((r) => ({
      id: r.id,
      type: "odometer" as const,
      at: r.recordedAt.toISOString(),
      title: `${fmt.format(r.value)} mi`,
      subtitle: [
        r.source === "clock"
          ? "Clock in/out"
          : r.source === "service"
            ? "Service"
            : "Odometer",
        r.aiValue != null ? `AI read ${fmt.format(r.aiValue)}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      status: r.approvalStatus as LogEntryDto["status"],
      flags: r.flags,
      inReview: pOdo.has(r.id),
      by: r.recordedBy ? (names.get(r.recordedBy) ?? null) : null,
      thumbUrl: r.photoMediaId ? (thumbs[r.photoMediaId] ?? null) : null,
      fullUrl: r.photoMediaId ? (fulls[r.photoMediaId] ?? null) : null,
    })),
    ...fuel.map(({ f, odo: o }) => {
      const mpg = mpgById.get(f.id);
      return {
        id: f.id,
        type: "fuel" as const,
        at: f.filledAt.toISOString(),
        title: `${f.gallons.toFixed(1)} gal · ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(f.totalCents / 100)}`,
        subtitle: [
          o != null ? `${fmt.format(o)} mi` : null,
          mpg != null ? `${mpg} MPG` : null,
          f.partPurchaseId ? "Tech paid" : null,
        ]
          .filter(Boolean)
          .join(" · "),
        status: f.approvalStatus as LogEntryDto["status"],
        flags: f.flags,
        inReview: pFuel.has(f.id),
        by: f.userId ? (names.get(f.userId) ?? null) : null,
        thumbUrl: f.receiptMediaId ? (thumbs[f.receiptMediaId] ?? null) : null,
        fullUrl: f.receiptMediaId ? (fulls[f.receiptMediaId] ?? null) : null,
      };
    }),
    ...insp.map((r) => {
      const results = (r.results ?? {}) as Record<string, { ok: boolean }>;
      const failed = Object.values(results).filter((x) => x && !x.ok).length;
      const mid = r.mediaIds[0] ?? null;
      return {
        id: r.id,
        type: "inspection" as const,
        at: r.createdAt.toISOString(),
        title: r.passed ? "Inspection passed" : "Inspection: issues found",
        subtitle: failed
          ? `${failed} item${failed === 1 ? "" : "s"} failed`
          : "All items OK",
        status: r.approvalStatus as LogEntryDto["status"],
        flags: [],
        inReview: pInsp.has(r.id),
        by: r.userId ? (names.get(r.userId) ?? null) : null,
        thumbUrl: mid ? (thumbs[mid] ?? null) : null,
        fullUrl: mid ? (fulls[mid] ?? null) : null,
      };
    }),
  ];
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

export async function listServiceRecords(vehicleId: string) {
  await getVehicle(vehicleId);
  const rows = await db
    .select()
    .from(serviceRecords)
    .where(eq(serviceRecords.vehicleId, vehicleId))
    .orderBy(desc(serviceRecords.performedOn), desc(serviceRecords.createdAt))
    .limit(50);
  const ids = rows.map((r) => r.receiptMediaId).filter((x): x is string => !!x);
  const [urls, pending] = await Promise.all([
    getMediaUrls(ids, "full"),
    pendingApprovalIds(
      "service",
      rows.map((r) => r.id),
    ),
  ]);
  return rows.map((r) => ({
    id: r.id,
    tasks: r.tasks,
    taskLabels: r.tasks.map(taskLabel),
    performedOn: r.performedOn,
    odometer: r.odometer,
    vendor: r.vendor,
    costCents: r.costCents,
    paidBy: r.paidBy,
    status: r.approvalStatus as "pending" | "approved" | "rejected",
    inReview: pending.has(r.id),
    receiptUrl: r.receiptMediaId ? (urls[r.receiptMediaId] ?? null) : null,
    aiTasks: Array.isArray((r.aiExtract as { tasks?: unknown })?.tasks)
      ? ((r.aiExtract as { tasks: string[] }).tasks ?? [])
      : [],
    notes: r.notes,
  }));
}

export async function listDocuments(vehicleId: string) {
  await getVehicle(vehicleId);
  const tz = await getCompanyTimezone();
  const today = dateKey(new Date(), tz);
  const rows = await db
    .select()
    .from(vehicleDocuments)
    .where(eq(vehicleDocuments.vehicleId, vehicleId))
    .orderBy(asc(vehicleDocuments.kind), desc(vehicleDocuments.createdAt));
  const [urls, thumbs, mimes, pending] = await Promise.all([
    getMediaUrls(
      rows.map((r) => r.mediaId),
      "full",
    ),
    getMediaUrls(
      rows.map((r) => r.mediaId),
      "thumb",
    ),
    rows.length
      ? db
          .select({ id: media.id, mime: media.mime })
          .from(media)
          .where(
            inArray(
              media.id,
              rows.map((r) => r.mediaId),
            ),
          )
      : Promise.resolve([]),
    pendingApprovalIds(
      "document",
      rows.map((r) => r.id),
    ),
  ]);
  const mime = new Map(mimes.map((m) => [m.id, m.mime]));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    expiresOn: r.expiresOn,
    expired: !!r.expiresOn && r.expiresOn < today,
    status: r.approvalStatus as "pending" | "approved" | "rejected",
    inReview: pending.has(r.id),
    url: urls[r.mediaId] ?? null,
    thumbUrl: mime.get(r.mediaId)?.startsWith("image/")
      ? (thumbs[r.mediaId] ?? null)
      : null,
    notes: r.notes,
  }));
}

export async function listIssues(vehicleId: string) {
  await getVehicle(vehicleId);
  const rows = await db
    .select()
    .from(vehicleIssues)
    .where(eq(vehicleIssues.vehicleId, vehicleId))
    .orderBy(
      sql`case when ${vehicleIssues.status} = 'resolved' then 1 else 0 end`,
      desc(vehicleIssues.createdAt),
    )
    .limit(50);
  const mids = rows.flatMap((r) => r.mediaIds.slice(0, 4));
  const [thumbs, fulls, names] = await Promise.all([
    getMediaUrls(mids, "thumb"),
    getMediaUrls(mids, "full"),
    nameMap(rows.flatMap((r) => [r.reportedBy, r.acknowledgedBy])),
  ]);
  return rows.map((r) => ({
    id: r.id,
    description: r.description,
    severity: r.severity as "low" | "medium" | "high" | "unsafe",
    canDrive: r.canDrive,
    status: r.status as "open" | "acknowledged" | "in_repair" | "resolved",
    createdAt: r.createdAt.toISOString(),
    acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
    acknowledgedBy: r.acknowledgedBy
      ? (names.get(r.acknowledgedBy) ?? null)
      : null,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    resolution: r.resolution,
    reportedBy: r.reportedBy ? (names.get(r.reportedBy) ?? null) : null,
    photos: r.mediaIds.slice(0, 4).map((m) => ({
      id: m,
      thumbUrl: thumbs[m] ?? "",
      url: fulls[m] ?? "",
    })),
  }));
}

export async function listTrips(vehicleId: string) {
  const user = await viewer();
  await getVehicle(vehicleId);
  const mine = !user.perms.has("vehicles.view_all");
  const rows = await db
    .select({ t: trips, name: users.name })
    .from(trips)
    .leftJoin(users, eq(users.id, trips.userId))
    .where(
      and(
        eq(trips.vehicleId, vehicleId),
        mine ? eq(trips.userId, user.id) : undefined,
      ),
    )
    .orderBy(desc(trips.tripDate))
    .limit(60);
  const pending = await pendingApprovalIds(
    "trip",
    rows.map((r) => r.t.id),
  );
  return rows.map(({ t, name }) => ({
    id: t.id,
    userId: t.userId,
    userName: name ?? "—",
    tripDate: t.tripDate,
    startOdometer: t.startOdometer,
    endOdometer: t.endOdometer,
    miles: t.miles,
    destinations: t.destinations ?? [],
    purpose: t.purpose,
    classification: t.classification as "business" | "commute" | "personal",
    reimbursable: t.reimbursable,
    hasLedger: !!t.ledgerEntryId,
    status: t.approvalStatus as "pending" | "approved" | "rejected",
    inReview: pending.has(t.id),
    /** Pending with no review item = auto-drafted, waiting for the tech to submit. */
    draft: t.approvalStatus === "pending" && !pending.has(t.id),
  }));
}

/** Overview stats: last fill MPG, 90-day fuel spend, service spend, cost per mile. */
export async function getVehicleStats(vehicleId: string) {
  await getVehicle(vehicleId);
  const since = new Date(Date.now() - 90 * 86_400_000);
  const sinceKey = since.toISOString().slice(0, 10);
  const [fuel, service, miles, issues] = await Promise.all([
    db
      .select({
        cents: sql<number>`coalesce(sum(${fuelLogs.totalCents}),0)::bigint`,
        gallons: sql<number>`coalesce(sum(${fuelLogs.gallons}),0)::float`,
      })
      .from(fuelLogs)
      .where(
        and(
          eq(fuelLogs.vehicleId, vehicleId),
          eq(fuelLogs.approvalStatus, "approved"),
          gte(fuelLogs.filledAt, since),
        ),
      ),
    db
      .select({
        cents: sql<number>`coalesce(sum(${serviceRecords.costCents}),0)::bigint`,
      })
      .from(serviceRecords)
      .where(
        and(
          eq(serviceRecords.vehicleId, vehicleId),
          eq(serviceRecords.approvalStatus, "approved"),
          gte(serviceRecords.performedOn, sinceKey),
        ),
      ),
    db
      .select({
        lo: sql<number | null>`min(${odometerReadings.value})`,
        hi: sql<number | null>`max(${odometerReadings.value})`,
      })
      .from(odometerReadings)
      .where(
        and(
          eq(odometerReadings.vehicleId, vehicleId),
          eq(odometerReadings.approvalStatus, "approved"),
          gte(odometerReadings.recordedAt, since),
        ),
      ),
    db
      .select({ n: count() })
      .from(vehicleIssues)
      .where(
        and(
          eq(vehicleIssues.vehicleId, vehicleId),
          sql`${vehicleIssues.status} <> 'resolved'`,
        ),
      ),
  ]);
  const fuelCents = Number(fuel[0]?.cents ?? 0);
  const serviceCents = Number(service[0]?.cents ?? 0);
  const m =
    miles[0]?.hi != null && miles[0]?.lo != null
      ? Number(miles[0].hi) - Number(miles[0].lo)
      : 0;
  const gallons = Number(fuel[0]?.gallons ?? 0);
  return {
    fuelCents,
    serviceCents,
    miles: m,
    costPerMileCents: m > 0 ? Math.round((fuelCents + serviceCents) / m) : null,
    avgMpg: gallons > 0 && m > 0 ? Math.round((m / gallons) * 10) / 10 : null,
    openIssues: Number(issues[0]?.n ?? 0),
  };
}

/** Pending vehicle approvals (review queue). */
export async function listPendingVehicleApprovals() {
  await requireUser("vehicles.log_approve");
  const rows = await db
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.status, "pending"),
        inArray(approvals.entityType, [...VEHICLE_KINDS]),
      ),
    )
    .orderBy(asc(approvals.createdAt))
    .limit(200);
  return rows;
}

/** Review queue with live evidence (typed vs AI, previous reading, flags). */
export async function listVehicleReviewItems(
  kind?: (typeof VEHICLE_KINDS)[number] | null,
): Promise<ReviewItem[]> {
  const rows = (await listPendingVehicleApprovals()).filter(
    (r) => !kind || r.entityType === kind,
  );
  const items = await Promise.all(
    rows.map((r) =>
      loadReviewItem({
        ...r,
        evidence: (r.evidence as Record<string, unknown> | null) ?? null,
      } as ApprovalRow),
    ),
  );
  return items.filter((x): x is ReviewItem => !!x);
}

/** Assignable users for the vehicle form (active staff). */
export async function listAssignableUsers() {
  await requireUser("vehicles.manage");
  return db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(eq(users.status, "active"))
    .orderBy(asc(users.name));
}

/** Latest AI maintenance suggestion for a vehicle (suggested — admin confirms). */
export async function getMaintenanceSuggestion(vehicleId: string): Promise<{
  taskId: string;
  status: string;
  text: string | null;
  at: string;
} | null> {
  const { vehicle } = await getVehicle(vehicleId);
  const ref = (
    vehicle.decoded as {
      _ai_maintenance?: { task_id?: string; at?: string };
    } | null
  )?._ai_maintenance;
  if (!ref?.task_id) return null;
  const [t] = await db
    .select({ status: aiTasks.status, output: aiTasks.output })
    .from(aiTasks)
    .where(eq(aiTasks.id, ref.task_id))
    .limit(1);
  if (!t) return null;
  return {
    taskId: ref.task_id,
    status: t.status,
    text: (t.output as { text?: string } | null)?.text ?? null,
    at: ref.at ?? "",
  };
}

/** Open NHTSA recalls stored on the vehicle. */
export function recallsOf(v: VehicleRow): Recall[] {
  return (Array.isArray(v.openRecalls) ? v.openRecalls : []) as Recall[];
}
