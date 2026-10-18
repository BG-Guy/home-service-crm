import "server-only";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { cache } from "react";
import { db, execRows } from "@/db";
import { invites, roles, serviceTypes, users } from "@/db/schema";
import { getCustodyBalances } from "@/features/payroll/api";
import { getClockStatuses } from "@/features/time/api";
import { getToolAuditStatuses } from "@/features/tools/api";
import { can } from "@/lib/auth/current";
import { toBaseRole } from "@/lib/permissions";
import type { SessionUser } from "@/lib/types";
import { getUserBriefs } from "./api";

// Team reads (SPEC M02; BUILD_PLAN §9 B8). Pages call requireUser first; these
// functions additionally take the viewer to decide which batch columns it may see.

export type TeamStatusFilter = "active" | "invited" | "deactivated";

export interface TeamMemberRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  roleName: string;
  baseRole: "admin" | "office" | "tech";
  status: string;
  workerType: "w2" | "1099";
  avatarUrl: string | null;
  color: string | null;
  lastLoginAt: Date | null;
  clockedInSince: Date | null;
  /** Cash + checks held (null when the viewer can't see payroll). */
  cashHeldCents: number | null;
  cashOldestAt: Date | null;
  /** Comp agreement: true when the latest plan version is unsigned. */
  agreementUnsigned: boolean;
  toolAuditOverdue: boolean;
  toolAuditDueOn: string | null;
}

export interface PendingInviteRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  roleName: string;
  workerType: string;
  createdAt: Date;
  expiresAt: Date;
  expired: boolean;
}

export const listRoleOptions = cache(
  async (): Promise<{ key: string; name: string; baseRole: string }[]> => {
    return db
      .select({ key: roles.key, name: roles.name, baseRole: roles.baseRole })
      .from(roles)
      .orderBy(desc(roles.builtin), asc(roles.name));
  },
);

async function compStatuses(ids: string[]) {
  try {
    const { getCompAgreementStatuses } = await import("@/features/payroll/api");
    return await getCompAgreementStatuses(ids);
  } catch {
    return {};
  }
}

/** Team list with the batch columns from B2 (clock), B6 (custody, agreement), B7 (tool audit). */
export async function listTeam(
  viewer: SessionUser,
  status: TeamStatusFilter = "active",
): Promise<TeamMemberRow[]> {
  const statuses =
    status === "active"
      ? ["active"]
      : status === "deactivated"
        ? ["deactivated"]
        : ["invited", "pending"];
  const rows = await db
    .select({
      id: users.id,
      status: users.status,
      lastLoginAt: users.lastLoginAt,
      roleName: roles.name,
      baseRole: roles.baseRole,
    })
    .from(users)
    .leftJoin(roles, eq(roles.key, users.role))
    .where(sql`${users.status} in ${statuses}`)
    .orderBy(asc(users.name));
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];
  const seePay = can(viewer, "payroll.view_all") || can(viewer, "users.manage");
  const techIds = rows
    .filter((r) => toBaseRole(r.baseRole) === "tech")
    .map((r) => r.id);
  const [briefs, clocks, custody, comp, audits] = await Promise.all([
    getUserBriefs(ids),
    safe(() => getClockStatuses(ids), {}),
    seePay && techIds.length
      ? safe(() => getCustodyBalances(techIds), {})
      : Promise.resolve({} as Awaited<ReturnType<typeof getCustodyBalances>>),
    techIds.length ? compStatuses(techIds) : Promise.resolve({}),
    techIds.length
      ? safe(() => getToolAuditStatuses(techIds), {})
      : Promise.resolve({} as Awaited<ReturnType<typeof getToolAuditStatuses>>),
  ]);
  return rows.flatMap((r) => {
    const b = briefs[r.id];
    if (!b) return [];
    const cust = custody[r.id];
    const agreement = (
      comp as Record<
        string,
        {
          required: boolean;
          signedVersion: number | null;
          currentVersion: number | null;
        }
      >
    )[r.id];
    const audit = audits[r.id];
    return [
      {
        id: r.id,
        name: b.name,
        email: b.email,
        phone: b.phone,
        role: b.role,
        roleName: r.roleName ?? b.role,
        baseRole: b.baseRole,
        status: r.status,
        workerType: b.workerType,
        avatarUrl: b.avatarUrl,
        color: b.color,
        lastLoginAt: r.lastLoginAt,
        clockedInSince: clocks[r.id]?.clockedIn
          ? (clocks[r.id]?.since ?? null)
          : null,
        cashHeldCents: seePay ? (cust?.heldCents ?? 0) : null,
        cashOldestAt: cust?.oldestAt ?? null,
        agreementUnsigned: !!(
          agreement?.required &&
          agreement.currentVersion != null &&
          agreement.signedVersion !== agreement.currentVersion
        ),
        toolAuditOverdue: !!audit?.overdue,
        toolAuditDueOn: audit?.nextDueOn ?? null,
      },
    ];
  });
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.error("[team] batch column failed", e);
    return fallback;
  }
}

/** Invites not yet accepted or revoked (expired ones are shown so they can be re-sent). */
export async function listPendingInvites(): Promise<PendingInviteRow[]> {
  const now = new Date();
  const rows = await db
    .select({
      id: invites.id,
      name: invites.name,
      email: invites.email,
      phone: invites.phone,
      role: invites.role,
      roleName: roles.name,
      workerType: invites.workerType,
      createdAt: invites.createdAt,
      expiresAt: invites.expiresAt,
    })
    .from(invites)
    .leftJoin(roles, eq(roles.key, invites.role))
    .where(and(isNull(invites.acceptedAt), isNull(invites.revokedAt)))
    .orderBy(desc(invites.createdAt));
  return rows.map((r) => ({
    ...r,
    roleName: r.roleName ?? r.role,
    expired: r.expiresAt <= now,
  }));
}

export async function countTeam(): Promise<{
  active: number;
  invited: number;
  deactivated: number;
}> {
  const [r] = await db
    .select({
      active: sql<number>`count(*) filter (where ${users.status} = 'active')::int`,
      deactivated: sql<number>`count(*) filter (where ${users.status} = 'deactivated')::int`,
    })
    .from(users);
  const [i] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(invites)
    .where(
      and(
        isNull(invites.acceptedAt),
        isNull(invites.revokedAt),
        gt(invites.expiresAt, new Date(Date.now() - 30 * 86_400_000)),
      ),
    );
  return {
    active: r?.active ?? 0,
    invited: i?.n ?? 0,
    deactivated: r?.deactivated ?? 0,
  };
}

export interface TeamMemberDetail {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  roleName: string;
  baseRole: "admin" | "office" | "tech";
  status: string;
  workerType: "w2" | "1099";
  avatarUrl: string | null;
  color: string | null;
  licenseNumbers: {
    state: string;
    trade: string;
    number: string;
    expires_on?: string;
  }[];
  skills: string[];
  serviceZips: string[];
  homeBase: {
    street?: string;
    unit?: string;
    city?: string;
    state?: string;
    zip?: string;
  } | null;
  hireDate: string | null;
  usesCompanyTools: boolean;
  usesCompanyVehicle: boolean;
  monitoringNoticeAckAt: Date | null;
  esignConsentAt: Date | null;
  lastLoginAt: Date | null;
  deactivatedAt: Date | null;
  createdAt: Date;
  overrideCount: number;
}

export async function getTeamMember(
  id: string,
): Promise<TeamMemberDetail | null> {
  const [r] = await db
    .select({
      u: users,
      roleName: roles.name,
      baseRole: roles.baseRole,
      overrides: sql<number>`(select count(*)::int from user_permission_overrides o where o.user_id = ${users.id})`,
    })
    .from(users)
    .leftJoin(roles, eq(roles.key, users.role))
    .where(eq(users.id, id))
    .limit(1);
  if (!r) return null;
  const brief = (await getUserBriefs([id]))[id];
  const u = r.u;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    roleName: r.roleName ?? u.role,
    baseRole: toBaseRole(r.baseRole ?? u.role),
    status: u.status,
    workerType: u.workerType === "w2" ? "w2" : "1099",
    avatarUrl: brief?.avatarUrl ?? null,
    color: u.color,
    licenseNumbers: u.licenseNumbers ?? [],
    skills: u.skills ?? [],
    serviceZips: u.serviceZips ?? [],
    homeBase: u.homeBase ?? null,
    hireDate: u.hireDate ?? null,
    usesCompanyTools: u.usesCompanyTools,
    usesCompanyVehicle: u.usesCompanyVehicle,
    monitoringNoticeAckAt: u.monitoringNoticeAckAt,
    esignConsentAt: u.esignConsentAt,
    lastLoginAt: u.lastLoginAt,
    deactivatedAt: u.deactivatedAt,
    createdAt: u.createdAt,
    overrideCount: Number(r.overrides ?? 0),
  };
}

export async function listSkillOptions(): Promise<
  { id: string; name: string }[]
> {
  return db
    .select({ id: serviceTypes.id, name: serviceTypes.name })
    .from(serviceTypes)
    .where(and(isNull(serviceTypes.deletedAt), eq(serviceTypes.active, true)))
    .orderBy(asc(serviceTypes.name));
}

/** Open jobs and cash held for the deactivation follow-up card. */
export async function getOffboardingState(userId: string): Promise<{
  openJobs: number;
  cashHeldCents: number;
  cashOldestAt: Date | null;
}> {
  const [j] = await execRows<{ n: number }>(sql`
    select count(distinct j.id)::int as n
    from jobs j join job_assignments a on a.job_id = j.id
    where a.user_id = ${userId}::uuid
      and j.status not in ('completed','closed','cancelled')`);
  const custody = await safe(() => getCustodyBalances([userId]), {});
  const c = custody[userId];
  return {
    openJobs: Number(j?.n ?? 0),
    cashHeldCents: c?.heldCents ?? 0,
    cashOldestAt: c?.oldestAt ?? null,
  };
}
