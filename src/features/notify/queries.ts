import "server-only";
import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  not,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import {
  activity,
  auditLog,
  leads,
  notifications,
  tools,
  users,
  vehicles,
} from "@/db/schema";
import { assertCustomerAccess } from "@/features/customers/api";
import { assertEstimateAccess } from "@/features/estimates/access";
import { assertInvoiceAccess } from "@/features/invoices/api";
import { assertJobAccess } from "@/features/jobs/api";
import { requireUser } from "@/lib/auth/current";
import type { Perm } from "@/lib/permissions";
import { getCompany } from "@/lib/settings";
import {
  addDaysToKey,
  parseDateKey,
  safeTimeZone,
  zonedTimeToUtc,
} from "@/lib/time";
import type { SessionUser } from "@/lib/types";
import type {
  ActivityItemDTO,
  AuditRowDTO,
  NotificationDTO,
  TimelineFilter,
  TimelineScope,
} from "./contracts";
import { activityHref, HIDDEN_KINDS, TIMELINE_PREFIXES } from "./timeline";

// Notify read DAL: activity timeline (S33), notifications (/notifications, bell),
// audit log (/settings/audit). Every entry point checks the viewer first.

const has = (u: SessionUser, p: string) => u.perms.has(p as Perm);

/**
 * May the viewer read this timeline? Row scope per entity (BUILD_PLAN §5.0),
 * the same rule as the entity's own page: a module permission alone is not
 * enough (QA T5-04), the viewer must be able to open that very row.
 */
export async function canViewTimeline(
  user: SessionUser,
  scope: TimelineScope,
): Promise<boolean> {
  try {
    if (scope.jobId) {
      await assertJobAccess(user, scope.jobId, "read");
      return true;
    }
    if (scope.customerId) {
      await assertCustomerAccess(user, scope.customerId, "read");
      return true;
    }
    const e = scope.entity;
    if (!e) return false;
    switch (e.type) {
      case "customer":
        await assertCustomerAccess(user, e.id, "read");
        return true;
      case "job":
        await assertJobAccess(user, e.id, "read");
        return true;
      case "lead":
        return await canViewLead(user, e.id);
      case "estimate":
        await assertEstimateAccess(user, e.id, "read");
        return true;
      case "invoice":
        await assertInvoiceAccess(user, e.id, "read");
        return true;
      case "vehicle":
        return await canViewVehicleRow(user, e.id);
      case "tool":
        return await canViewToolRow(user, e.id);
      case "user":
        return e.id === user.id || has(user, "users.manage");
      default:
        return has(user, "audit.view");
    }
  } catch {
    return false;
  }
}

/** Leads have no row scope beyond `leads.view` (leads/queries.ts), but the row must exist. */
async function canViewLead(user: SessionUser, id: string): Promise<boolean> {
  if (!has(user, "leads.view")) return false;
  const [l] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(eq(leads.id, id))
    .limit(1);
  return !!l;
}

/** Mirrors vehicles/engine.ts `canViewVehicle`: view_all, or view_own on the vehicle assigned to me. */
async function canViewVehicleRow(
  user: SessionUser,
  id: string,
): Promise<boolean> {
  const [v] = await db
    .select({ assignedUserId: vehicles.assignedUserId })
    .from(vehicles)
    .where(eq(vehicles.id, id))
    .limit(1);
  if (!v) return false;
  if (has(user, "vehicles.view_all")) return true;
  return has(user, "vehicles.view_own") && v.assignedUserId === user.id;
}

/** Mirrors tools/queries.ts `canViewTool`: view_all, or view_own on a tool in my custody or owned by me. */
async function canViewToolRow(user: SessionUser, id: string): Promise<boolean> {
  const [t] = await db
    .select({
      currentUserId: tools.currentUserId,
      ownerUserId: tools.ownerUserId,
    })
    .from(tools)
    .where(eq(tools.id, id))
    .limit(1);
  if (!t) return false;
  if (has(user, "tools.view_all")) return true;
  return (
    has(user, "tools.view_own") &&
    (t.currentUserId === user.id || t.ownerUserId === user.id)
  );
}

function filterWhere(f: TimelineFilter): SQL | undefined {
  if (f === "all") return not(inArray(activity.kind, HIDDEN_KINDS));
  const parts = TIMELINE_PREFIXES[f].map(
    (p) => sql`${activity.kind} like ${`${p}%`}`,
  );
  return or(...parts);
}

/**
 * Rows on a customer's timeline that belong to a job the viewer can't open stay
 * hidden: a tech assigned to one of the customer's jobs sees that job's rows and
 * the job-less customer rows, not other techs' jobs (T5-04).
 */
function jobRowScope(viewer: SessionUser): SQL | undefined {
  if (has(viewer, "jobs.view_all")) return undefined;
  return sql`(${activity.jobId} is null or exists (select 1 from job_assignments ja where ja.job_id = ${activity.jobId} and ja.user_id = ${viewer.id}))`;
}

function scopeWhere(
  scope: TimelineScope,
  viewer: SessionUser,
): SQL | undefined {
  if (scope.jobId) return eq(activity.jobId, scope.jobId);
  if (scope.customerId)
    return and(eq(activity.customerId, scope.customerId), jobRowScope(viewer));
  if (scope.entity) {
    const own = and(
      eq(activity.entityType, scope.entity.type),
      eq(activity.entityId, scope.entity.id),
    );
    return scope.entity.type === "customer"
      ? and(own, jobRowScope(viewer))
      : own;
  }
  return sql`false`;
}

/**
 * One page of activity, newest first. `before` = cursor (activity id).
 * Call `canViewTimeline(viewer, scope)` first; `viewer` narrows rows further.
 */
export async function fetchActivity(
  viewer: SessionUser,
  scope: TimelineScope,
  filter: TimelineFilter,
  opts: { before?: number | null; limit?: number } = {},
): Promise<{ items: ActivityItemDTO[]; nextBefore: number | null }> {
  const limit = Math.min(100, Math.max(5, opts.limit ?? 25));
  const rows = await db
    .select({
      id: activity.id,
      at: activity.createdAt,
      kind: activity.kind,
      summary: activity.summary,
      entityType: activity.entityType,
      entityId: activity.entityId,
      jobId: activity.jobId,
      customerId: activity.customerId,
      actor: users.name,
    })
    .from(activity)
    .leftJoin(users, eq(users.id, activity.actorUserId))
    .where(
      and(
        scopeWhere(scope, viewer),
        filterWhere(filter),
        opts.before ? lt(activity.id, opts.before) : undefined,
      ),
    )
    .orderBy(desc(activity.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return {
    items: page.map((r) => ({
      id: Number(r.id),
      at: r.at.toISOString(),
      kind: r.kind,
      summary: r.summary,
      actor: r.actor,
      href:
        // Don't link a row back to the page it is shown on.
        (scope.jobId && r.entityType === "job") ||
        (scope.customerId && r.entityType === "customer")
          ? null
          : (activityHref(r.entityType, r.entityId, {
              jobId: r.jobId,
              customerId: r.customerId,
            }) ?? null),
    })),
    nextBefore: rows.length > limit ? Number(page[page.length - 1]?.id) : null,
  };
}

// ------------------------------------------------------------------ notifications

export async function listNotifications(opts: {
  before?: string | null;
  limit?: number;
  unreadOnly?: boolean;
}): Promise<{ items: NotificationDTO[]; nextBefore: string | null }> {
  const user = await requireUser();
  const limit = Math.min(100, opts.limit ?? 50);
  const rows = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, user.id),
        opts.unreadOnly ? isNull(notifications.readAt) : undefined,
        opts.before
          ? lt(notifications.createdAt, new Date(opts.before))
          : undefined,
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return {
    items: page.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      url: n.url,
      priority: n.priority,
      read: !!n.readAt,
      at: n.createdAt.toISOString(),
    })),
    nextBefore:
      rows.length > limit
        ? (page[page.length - 1]?.createdAt.toISOString() ?? null)
        : null,
  };
}

// ------------------------------------------------------------------ audit log

export interface AuditFilter {
  actor?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
  before?: number | null;
}

export async function listAudit(f: AuditFilter): Promise<{
  rows: AuditRowDTO[];
  nextBefore: number | null;
  actors: { id: string; name: string }[];
}> {
  await requireUser("audit.view");
  const tz = safeTimeZone((await getCompany()).timezone);
  const day = (k: string) => zonedTimeToUtc(parseDateKey(k), tz);
  const valid = (k?: string) => !!k && /^\d{4}-\d{2}-\d{2}$/.test(k);
  const limit = 50;
  const rows = await db
    .select({
      id: auditLog.id,
      at: auditLog.createdAt,
      actorUserId: auditLog.actorUserId,
      actorKind: auditLog.actorKind,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      before: auditLog.before,
      after: auditLog.after,
      ip: auditLog.ip,
      actor: users.name,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .where(
      and(
        f.actor === "system"
          ? isNull(auditLog.actorUserId)
          : f.actor
            ? eq(auditLog.actorUserId, f.actor)
            : undefined,
        f.action
          ? ilike(auditLog.action, `${f.action.replace(/[\\%_]/g, "\\$&")}%`)
          : undefined,
        f.entityType ? eq(auditLog.entityType, f.entityType) : undefined,
        f.entityId && /^[0-9a-f-]{36}$/i.test(f.entityId)
          ? eq(auditLog.entityId, f.entityId)
          : undefined,
        valid(f.from)
          ? gte(auditLog.createdAt, day(f.from as string))
          : undefined,
        valid(f.to)
          ? lt(auditLog.createdAt, day(addDaysToKey(f.to as string, 1)))
          : undefined,
        f.before ? lt(auditLog.id, f.before) : undefined,
      ),
    )
    .orderBy(desc(auditLog.id))
    .limit(limit + 1);
  const actors = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .orderBy(users.name);
  const page = rows.slice(0, limit);
  return {
    rows: page.map((r) => ({
      id: Number(r.id),
      at: r.at.toISOString(),
      actor: r.actor ?? (r.actorKind === "user" ? "Unknown user" : r.actorKind),
      actorKind: r.actorKind,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      before: r.before,
      after: r.after,
      ip: r.ip,
    })),
    nextBefore: rows.length > limit ? Number(page[page.length - 1]?.id) : null,
    actors,
  };
}
