import "server-only";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import {
  media,
  toolAssignments,
  toolAuditItems,
  toolAudits,
  toolIncidents,
  toolKits,
  toolMaintenanceLogs,
  tools,
  users,
  vehicles,
} from "@/db/schema";
import { getMediaUrls } from "@/features/media/api";
import { requireAnyPerm, requireUser } from "@/lib/auth/current";
import { getCompanyTimezone, getSettings } from "@/lib/settings";
import { dateKey } from "@/lib/time";
import type { SessionUser } from "@/lib/types";
import { type DueState, dueState } from "./rules";

// Read DAL for tools (SPEC M18). Every export checks the viewer first and enforces
// the row scope: `tools.view_all`, or tools in the viewer's custody / owned by them.

const VIEW = ["tools.view_own", "tools.view_all"] as const;
export const toolViewer = cache(() => requireAnyPerm([...VIEW]));

export type ToolRow = typeof tools.$inferSelect;

export function canViewTool(
  user: SessionUser,
  t: Pick<ToolRow, "currentUserId" | "ownerUserId">,
): boolean {
  if (user.perms.has("tools.view_all")) return true;
  return (
    user.perms.has("tools.view_own") &&
    (t.currentUserId === user.id || t.ownerUserId === user.id)
  );
}

function scope(user: SessionUser): SQL | undefined {
  if (user.perms.has("tools.view_all")) return undefined;
  return or(eq(tools.currentUserId, user.id), eq(tools.ownerUserId, user.id));
}

export const today = cache(async () =>
  dateKey(new Date(), await getCompanyTimezone()),
);

async function firstPhotos(ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const rows = await db
    .select({ id: media.id, entityId: media.entityId })
    .from(media)
    .where(
      and(
        eq(media.entityType, "tool"),
        inArray(media.entityId, ids),
        isNull(media.deletedAt),
      ),
    )
    .orderBy(asc(media.createdAt));
  const first = new Map<string, string>();
  for (const r of rows)
    if (r.entityId && !first.has(r.entityId)) first.set(r.entityId, r.id);
  const urls = await getMediaUrls([...first.values()], "thumb");
  const out: Record<string, string> = {};
  for (const [tid, mid] of first) if (urls[mid]) out[tid] = urls[mid];
  return out;
}

export interface ToolListItem {
  id: string;
  name: string;
  category: string | null;
  brand: string | null;
  model: string | null;
  serial: string | null;
  assetTag: string | null;
  status: string;
  condition: string;
  owner: string;
  holderName: string | null;
  holderId: string | null;
  vehicleName: string | null;
  kitName: string | null;
  calibration: DueState;
  maintenance: DueState;
  calibrationDueOn: string | null;
  nextMaintenanceOn: string | null;
  unacknowledged: boolean;
  photoUrl: string | null;
  replacementCostCents: number | null;
}

/** Tools list: `mine` = in my custody or owned by me; `all` needs view_all. */
export async function listTools(
  opts: {
    scope?: "mine" | "all";
    status?: string | null;
    q?: string | null;
  } = {},
): Promise<ToolListItem[]> {
  const user = await toolViewer();
  const all = opts.scope === "all" && user.perms.has("tools.view_all");
  const mine = or(
    eq(tools.currentUserId, user.id),
    eq(tools.ownerUserId, user.id),
  );
  const q = opts.q?.trim();
  const rows = await db
    .select({
      t: tools,
      holder: users.name,
      vehicle: vehicles.nickname,
      kit: toolKits.name,
    })
    .from(tools)
    .leftJoin(users, eq(users.id, tools.currentUserId))
    .leftJoin(vehicles, eq(vehicles.id, tools.currentVehicleId))
    .leftJoin(toolKits, eq(toolKits.id, tools.kitId))
    .where(
      and(
        isNull(tools.deletedAt),
        all ? scope(user) : mine,
        opts.status && opts.status !== "all"
          ? eq(tools.status, opts.status)
          : opts.status === "all"
            ? undefined
            : ne(tools.status, "retired"),
        q
          ? sql`(${tools.name} ilike ${`%${q}%`} or ${tools.serial} ilike ${`%${q}%`} or ${tools.assetTag} ilike ${`%${q}%`} or ${tools.brand} ilike ${`%${q}%`})`
          : undefined,
      ),
    )
    .orderBy(asc(tools.category), asc(tools.name))
    .limit(500);
  const ids = rows.map((r) => r.t.id);
  const [photos, open, settings, day] = await Promise.all([
    firstPhotos(ids),
    ids.length
      ? db
          .select({
            toolId: toolAssignments.toolId,
            ack: toolAssignments.acknowledgedAt,
          })
          .from(toolAssignments)
          .where(
            and(
              inArray(toolAssignments.toolId, ids),
              isNull(toolAssignments.checkedInAt),
            ),
          )
      : Promise.resolve([]),
    getSettings(),
    today(),
  ]);
  const unack = new Set(open.filter((o) => !o.ack).map((o) => o.toolId));
  const warn = settings.tools.maintenance_warning_days;
  return rows.map(({ t, holder, vehicle, kit }) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    brand: t.brand,
    model: t.model,
    serial: t.serial,
    assetTag: t.assetTag,
    status: t.status,
    condition: t.condition,
    owner: t.owner,
    holderName: holder,
    holderId: t.currentUserId,
    vehicleName: vehicle,
    kitName: kit,
    calibration: dueState(t.calibrationDueOn, day, warn),
    maintenance: dueState(t.nextMaintenanceOn, day, warn),
    calibrationDueOn: t.calibrationDueOn,
    nextMaintenanceOn: t.nextMaintenanceOn,
    unacknowledged: unack.has(t.id),
    photoUrl: photos[t.id] ?? null,
    replacementCostCents: t.replacementCostCents ?? t.purchaseCostCents,
  }));
}

/** One tool with photos, custody history, maintenance and incidents (404 out of scope). */
export const getTool = cache(async (id: string) => {
  const user = await toolViewer();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [row] = await db
    .select({
      t: tools,
      holder: users.name,
      vehicle: vehicles.nickname,
      kit: toolKits.name,
    })
    .from(tools)
    .leftJoin(users, eq(users.id, tools.currentUserId))
    .leftJoin(vehicles, eq(vehicles.id, tools.currentVehicleId))
    .leftJoin(toolKits, eq(toolKits.id, tools.kitId))
    .where(and(eq(tools.id, id), isNull(tools.deletedAt)))
    .limit(1);
  if (!row) notFound();
  if (!canViewTool(user, row.t)) {
    // A tech who just checked the tool in (or had it reassigned) can't open it any
    // more. The check-in's refresh() re-renders this page, so send them to their
    // own list instead of a 404 (QA2 NEW-3).
    const [held] = await db
      .select({ id: toolAssignments.id })
      .from(toolAssignments)
      .where(
        and(
          eq(toolAssignments.toolId, id),
          eq(toolAssignments.userId, user.id),
        ),
      )
      .limit(1);
    if (held) redirect("/tools?scope=mine");
    notFound();
  }
  const owner = row.t.ownerUserId
    ? ((
        await db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, row.t.ownerUserId))
          .limit(1)
      )[0]?.name ?? null)
    : null;
  const photoIds = (
    await db
      .select({ id: media.id })
      .from(media)
      .where(
        and(
          eq(media.entityType, "tool"),
          eq(media.entityId, id),
          isNull(media.deletedAt),
        ),
      )
      .orderBy(asc(media.createdAt))
      .limit(12)
  ).map((r) => r.id);
  const [thumbs, fulls] = await Promise.all([
    getMediaUrls(photoIds, "thumb"),
    getMediaUrls(photoIds, "full"),
  ]);
  return {
    tool: row.t,
    holderName: row.holder,
    vehicleName: row.vehicle,
    kitName: row.kit,
    ownerName: owner,
    photos: photoIds.map((p) => ({
      id: p,
      thumbUrl: thumbs[p] ?? "",
      url: fulls[p] ?? "",
    })),
  };
});

const names = async (ids: (string | null)[]) => {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map<string, string>();
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, list));
  return new Map(rows.map((r) => [r.id, r.name]));
};

export async function getToolHistory(toolId: string) {
  await getTool(toolId);
  const [assigns, maint, incidents] = await Promise.all([
    db
      .select()
      .from(toolAssignments)
      .where(eq(toolAssignments.toolId, toolId))
      .orderBy(desc(toolAssignments.checkedOutAt))
      .limit(30),
    db
      .select()
      .from(toolMaintenanceLogs)
      .where(eq(toolMaintenanceLogs.toolId, toolId))
      .orderBy(desc(toolMaintenanceLogs.performedOn))
      .limit(30),
    db
      .select()
      .from(toolIncidents)
      .where(eq(toolIncidents.toolId, toolId))
      .orderBy(desc(toolIncidents.createdAt))
      .limit(20),
  ]);
  const vehicleIds = assigns
    .map((a) => a.vehicleId)
    .filter((x): x is string => !!x);
  const [who, vnames, mediaUrls] = await Promise.all([
    names([
      ...assigns.flatMap((a) => [a.userId, a.byUserId]),
      ...maint.map((m) => m.performedByUserId),
      ...incidents.flatMap((i) => [i.userId, i.decidedBy]),
    ]),
    vehicleIds.length
      ? db
          .select({ id: vehicles.id, name: vehicles.nickname })
          .from(vehicles)
          .where(inArray(vehicles.id, vehicleIds))
      : Promise.resolve([]),
    getMediaUrls(
      [
        ...assigns.flatMap((a) => [a.outMediaId, a.inMediaId]),
        ...maint.map((m) => m.mediaId),
      ].filter((x): x is string => !!x),
      "thumb",
    ),
  ]);
  const vmap = new Map(vnames.map((v) => [v.id, v.name]));
  return {
    assignments: assigns.map((a) => ({
      id: a.id,
      to: a.userId
        ? (who.get(a.userId) ?? "—")
        : a.vehicleId
          ? (vmap.get(a.vehicleId) ?? "Vehicle")
          : "—",
      userId: a.userId,
      vehicleId: a.vehicleId,
      by: a.byUserId ? (who.get(a.byUserId) ?? null) : null,
      outAt: a.checkedOutAt.toISOString(),
      inAt: a.checkedInAt?.toISOString() ?? null,
      outCondition: a.outCondition,
      inCondition: a.inCondition,
      ackAt: a.acknowledgedAt?.toISOString() ?? null,
      outPhoto: a.outMediaId ? (mediaUrls[a.outMediaId] ?? null) : null,
      inPhoto: a.inMediaId ? (mediaUrls[a.inMediaId] ?? null) : null,
    })),
    maintenance: maint.map((m) => ({
      id: m.id,
      task: m.task,
      performedOn: m.performedOn,
      by: m.performedByUserId ? (who.get(m.performedByUserId) ?? null) : null,
      vendor: m.vendor,
      costCents: m.costCents,
      paidBy: m.paidBy,
      notes: m.notes,
      photo: m.mediaId ? (mediaUrls[m.mediaId] ?? null) : null,
    })),
    incidents: incidents.map((i) => ({
      id: i.id,
      kind: i.kind,
      description: i.description,
      reportedBy: i.userId ? (who.get(i.userId) ?? null) : null,
      at: i.createdAt.toISOString(),
      decision: i.decision,
      decidedBy: i.decidedBy ? (who.get(i.decidedBy) ?? null) : null,
      policeReportNo: i.policeReportNo,
      deducted: !!i.deductionLedgerEntryId,
    })),
  };
}

/** Pending incidents (no decision yet) for reviewers. */
export async function listOpenIncidents() {
  await requireUser("tools.audit_review");
  const rows = await db
    .select({
      i: toolIncidents,
      tool: tools.name,
      serial: tools.serial,
      who: users.name,
    })
    .from(toolIncidents)
    .innerJoin(tools, eq(tools.id, toolIncidents.toolId))
    .leftJoin(users, eq(users.id, toolIncidents.userId))
    .where(isNull(toolIncidents.decision))
    .orderBy(desc(toolIncidents.createdAt))
    .limit(50);
  return rows.map((r) => ({
    id: r.i.id,
    toolId: r.i.toolId,
    toolName: r.tool,
    serial: r.serial,
    kind: r.i.kind,
    description: r.i.description,
    reportedBy: r.who,
    userId: r.i.userId,
    at: r.i.createdAt.toISOString(),
  }));
}

export interface AuditListItem {
  id: string;
  userId: string;
  userName: string;
  dueOn: string;
  status: string;
  submittedAt: string | null;
  items: number;
  missing: number;
  overdue: boolean;
}

/** Audits: mine (open + recent) or all (reviewer). */
export async function listAudits(opts: {
  scope: "mine" | "all";
}): Promise<AuditListItem[]> {
  const user = await requireAnyPerm([
    "tools.audit_submit",
    "tools.audit_review",
  ]);
  const all = opts.scope === "all" && user.perms.has("tools.audit_review");
  const day = await today();
  const rows = await db
    .select({
      a: toolAudits,
      name: users.name,
      items: sql<number>`(select count(*)::int from tool_audit_items i where i.audit_id = ${toolAudits.id})`,
      missing: sql<number>`(select count(*)::int from tool_audit_items i where i.audit_id = ${toolAudits.id} and i.present = false)`,
    })
    .from(toolAudits)
    .innerJoin(users, eq(users.id, toolAudits.userId))
    .where(
      and(
        all ? undefined : eq(toolAudits.userId, user.id),
        sql`(${toolAudits.status} in ('scheduled','in_progress') or ${toolAudits.createdAt} > now() - interval '60 days')`,
      ),
    )
    .orderBy(
      sql`case when ${toolAudits.status} in ('scheduled','in_progress') then 0 else 1 end`,
      asc(toolAudits.dueOn),
    )
    .limit(100);
  return rows.map((r) => ({
    id: r.a.id,
    userId: r.a.userId,
    userName: r.name,
    dueOn: r.a.dueOn,
    status: r.a.status,
    submittedAt: r.a.submittedAt?.toISOString() ?? null,
    items: Number(r.items),
    missing: Number(r.missing),
    overdue:
      (r.a.status === "scheduled" || r.a.status === "in_progress") &&
      r.a.dueOn < day,
  }));
}

/** One audit with its checklist (own audit, or a reviewer). */
export async function getAudit(id: string) {
  const user = await requireAnyPerm([
    "tools.audit_submit",
    "tools.audit_review",
  ]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [a] = await db
    .select({ a: toolAudits, name: users.name })
    .from(toolAudits)
    .innerJoin(users, eq(users.id, toolAudits.userId))
    .where(eq(toolAudits.id, id))
    .limit(1);
  if (!a) notFound();
  if (a.a.userId !== user.id && !user.perms.has("tools.audit_review"))
    notFound();
  const items = await db
    .select({
      i: toolAuditItems,
      name: tools.name,
      serial: tools.serial,
      tag: tools.assetTag,
      condition: tools.condition,
      currentUserId: tools.currentUserId,
      ownerUserId: tools.ownerUserId,
    })
    .from(toolAuditItems)
    .innerJoin(tools, eq(tools.id, toolAuditItems.toolId))
    .where(eq(toolAuditItems.auditId, id))
    .orderBy(asc(tools.name));
  const [photos, thumbs] = await Promise.all([
    firstPhotos(items.map((i) => i.i.toolId)),
    getMediaUrls(
      items.map((i) => i.i.mediaId).filter((x): x is string => !!x),
      "thumb",
    ),
  ]);
  return {
    audit: {
      id: a.a.id,
      userId: a.a.userId,
      userName: a.name,
      dueOn: a.a.dueOn,
      status: a.a.status,
      submittedAt: a.a.submittedAt?.toISOString() ?? null,
      reviewedAt: a.a.reviewedAt?.toISOString() ?? null,
    },
    mine: a.a.userId === user.id,
    items: items.map((r) => ({
      id: r.i.id,
      toolId: r.i.toolId,
      name: r.name,
      serial: r.serial,
      assetTag: r.tag,
      expectedCondition: r.condition,
      present: r.i.present,
      condition: r.i.condition,
      note: r.i.note,
      mediaId: r.i.mediaId,
      photoUrl: r.i.mediaId ? (thumbs[r.i.mediaId] ?? null) : null,
      toolPhotoUrl: photos[r.i.toolId] ?? null,
      /** The viewer may open the tool's page (custody may have moved since). */
      canOpen: canViewTool(user, r),
    })),
  };
}

export async function listKits() {
  await toolViewer();
  const rows = await db
    .select({ k: toolKits, vehicle: vehicles.nickname, user: users.name })
    .from(toolKits)
    .leftJoin(vehicles, eq(vehicles.id, toolKits.vehicleId))
    .leftJoin(users, eq(users.id, toolKits.userId))
    .orderBy(asc(toolKits.name));
  const counts = rows.length
    ? await db
        .select({ kitId: tools.kitId, n: sql<number>`count(*)::int` })
        .from(tools)
        .where(
          and(
            inArray(
              tools.kitId,
              rows.map((r) => r.k.id),
            ),
            isNull(tools.deletedAt),
          ),
        )
        .groupBy(tools.kitId)
    : [];
  const n = new Map(counts.map((c) => [c.kitId, Number(c.n)]));
  return rows.map((r) => ({
    id: r.k.id,
    name: r.k.name,
    vehicleId: r.k.vehicleId,
    vehicleName: r.vehicle,
    userId: r.k.userId,
    userName: r.user,
    tools: n.get(r.k.id) ?? 0,
  }));
}

/** People and vehicles a tool can be checked out to. */
export async function listCustodians() {
  await requireUser("tools.manage");
  const [people, vans] = await Promise.all([
    db
      .select({ id: users.id, name: users.name, uses: users.usesCompanyTools })
      .from(users)
      .where(eq(users.status, "active"))
      .orderBy(asc(users.name)),
    db
      .select({ id: vehicles.id, name: vehicles.nickname })
      .from(vehicles)
      .where(and(isNull(vehicles.deletedAt), ne(vehicles.status, "retired")))
      .orderBy(asc(vehicles.nickname)),
  ]);
  return {
    users: people
      .filter((p) => p.uses)
      .map((p) => ({ id: p.id, name: p.name })),
    vehicles: vans,
  };
}

/** Theft report data (printable): serials, photos, values, last-seen custody. */
export async function getTheftReport(toolId: string) {
  await requireAnyPerm(["tools.view_all", "tools.report_incident"]);
  const t = await getTool(toolId);
  const h = await getToolHistory(toolId);
  const lastSeen = h.assignments[0] ?? null;
  return { ...t, lastSeen, incidents: h.incidents };
}
