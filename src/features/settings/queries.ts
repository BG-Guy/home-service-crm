import "server-only";
import { and, asc, count, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import {
  checklistTemplates,
  customFieldDefs,
  entityTags,
  rolePermissions,
  roles,
  serviceTypes,
  sessions,
  tags,
  taxRates,
  userPermissionOverrides,
  users,
} from "@/db/schema";
import type { ChecklistItemDef, CustomFieldEntity } from "./contracts";

// Reads for B8's own settings screens (BUILD_PLAN §3.3). Other modules use api.ts.
// Pages call requireUser(perm) before any of these.

export type ServiceTypeFull = typeof serviceTypes.$inferSelect;

export async function listServiceTypesFull(): Promise<ServiceTypeFull[]> {
  return db
    .select()
    .from(serviceTypes)
    .where(isNull(serviceTypes.deletedAt))
    .orderBy(
      desc(serviceTypes.active),
      asc(serviceTypes.sort),
      asc(serviceTypes.name),
    );
}

export interface ChecklistTemplateRow {
  id: string;
  name: string;
  items: ChecklistItemDef[];
  usedBy: { id: string; name: string }[];
}

export async function listChecklistTemplates(): Promise<
  ChecklistTemplateRow[]
> {
  const [rows, st] = await Promise.all([
    db.select().from(checklistTemplates).orderBy(asc(checklistTemplates.name)),
    db
      .select({
        id: serviceTypes.id,
        name: serviceTypes.name,
        tpl: serviceTypes.checklistTemplateId,
      })
      .from(serviceTypes)
      .where(isNull(serviceTypes.deletedAt)),
  ]);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    items: (r.items ?? []).map((i) => ({
      ...i,
      required: i.required ?? false,
    })),
    usedBy: st
      .filter((s) => s.tpl === r.id)
      .map((s) => ({ id: s.id, name: s.name })),
  }));
}

export interface TagRow {
  id: string;
  name: string;
  color: string;
  appliesTo: string[];
  uses: number;
}

export async function listTagsWithUsage(): Promise<TagRow[]> {
  const rows = await db
    .select({
      id: tags.id,
      name: tags.name,
      color: tags.color,
      appliesTo: tags.appliesTo,
      uses: sql<number>`count(${entityTags.entityId})::int`,
    })
    .from(tags)
    .leftJoin(entityTags, eq(entityTags.tagId, tags.id))
    .groupBy(tags.id)
    .orderBy(asc(sql`lower(${tags.name})`));
  return rows.map((r) => ({ ...r, uses: Number(r.uses) }));
}

export type CustomFieldDefRow = typeof customFieldDefs.$inferSelect;

export async function listCustomFieldDefs(
  entityType?: CustomFieldEntity,
): Promise<CustomFieldDefRow[]> {
  return db
    .select()
    .from(customFieldDefs)
    .where(entityType ? eq(customFieldDefs.entityType, entityType) : undefined)
    .orderBy(
      desc(customFieldDefs.active),
      asc(customFieldDefs.sort),
      asc(customFieldDefs.label),
    );
}

export async function countCustomFieldsByEntity(): Promise<
  Record<string, number>
> {
  const rows = await db
    .select({ e: customFieldDefs.entityType, n: count() })
    .from(customFieldDefs)
    .where(eq(customFieldDefs.active, true))
    .groupBy(customFieldDefs.entityType);
  return Object.fromEntries(rows.map((r) => [r.e, Number(r.n)]));
}

export type TaxRateRow = typeof taxRates.$inferSelect;

export async function listTaxRatesFull(): Promise<TaxRateRow[]> {
  return db
    .select()
    .from(taxRates)
    .orderBy(
      desc(taxRates.active),
      desc(taxRates.isDefault),
      asc(taxRates.name),
    );
}

export interface RoleRow {
  key: string;
  name: string;
  baseRole: "admin" | "office" | "tech";
  builtin: boolean;
  members: number;
}

export const listRoles = cache(async (): Promise<RoleRow[]> => {
  const rows = await db
    .select({
      key: roles.key,
      name: roles.name,
      baseRole: roles.baseRole,
      builtin: roles.builtin,
      members: sql<number>`count(${users.id}) filter (where ${users.status} = 'active')::int`,
    })
    .from(roles)
    .leftJoin(users, eq(users.role, roles.key))
    .groupBy(roles.key)
    .orderBy(
      sql`case ${roles.baseRole} when 'admin' then 0 when 'office' then 1 else 2 end`,
      asc(roles.name),
    );
  return rows.map((r) => ({
    ...r,
    baseRole:
      r.baseRole === "admin" || r.baseRole === "office" ? r.baseRole : "tech",
    members: Number(r.members),
  }));
});

/** role key → perm → granted (explicit grid rows only). */
export async function getRoleGrid(): Promise<
  Record<string, Record<string, boolean>>
> {
  const rows = await db
    .select({
      role: rolePermissions.role,
      perm: rolePermissions.perm,
      granted: rolePermissions.granted,
    })
    .from(rolePermissions);
  const out: Record<string, Record<string, boolean>> = {};
  for (const r of rows) {
    const m = out[r.role] ?? {};
    m[r.perm] = r.granted;
    out[r.role] = m;
  }
  return out;
}

export interface OverrideSummary {
  userId: string;
  name: string;
  role: string;
  status: string;
  overrides: number;
}

/** Every non-deactivated user with their override count (for the overrides index). */
export async function listUsersWithOverrideCounts(): Promise<
  OverrideSummary[]
> {
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      role: users.role,
      status: users.status,
      overrides: sql<number>`count(${userPermissionOverrides.perm})::int`,
    })
    .from(users)
    .leftJoin(
      userPermissionOverrides,
      eq(userPermissionOverrides.userId, users.id),
    )
    .where(sql`${users.status} <> 'deactivated'`)
    .groupBy(users.id)
    .orderBy(asc(users.name));
  return rows.map((r) => ({ ...r, overrides: Number(r.overrides) }));
}

export async function getUserOverrides(userId: string): Promise<
  {
    perm: string;
    effect: "allow" | "deny";
    reason: string | null;
    createdAt: Date;
  }[]
> {
  const rows = await db
    .select()
    .from(userPermissionOverrides)
    .where(eq(userPermissionOverrides.userId, userId));
  return rows.map((r) => ({
    perm: r.perm,
    effect: r.effect === "deny" ? "deny" : "allow",
    reason: r.reason,
    createdAt: r.createdAt,
  }));
}

export async function getUserForPermissions(userId: string) {
  const [u] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      status: users.status,
      baseRole: roles.baseRole,
      roleName: roles.name,
    })
    .from(users)
    .leftJoin(roles, eq(roles.key, users.role))
    .where(eq(users.id, userId))
    .limit(1);
  return u ?? null;
}

/** Count of active admins (lock: at least one must remain). */
export async function countActiveAdmins(): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(users)
    .innerJoin(roles, eq(roles.key, users.role))
    .where(and(eq(users.status, "active"), eq(roles.baseRole, "admin")));
  return Number(r?.n ?? 0);
}

export interface MySession {
  id: string;
  current: boolean;
  userAgent: string | null;
  ip: string | null;
  lastSeenAt: Date;
  createdAt: Date;
}

/** My live sessions (profile → devices). */
export async function listMySessions(
  userId: string,
  currentSessionId: string,
): Promise<MySession[]> {
  const rows = await db
    .select({
      id: sessions.id,
      userAgent: sessions.userAgent,
      ip: sessions.ip,
      lastSeenAt: sessions.lastSeenAt,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(sessions.lastSeenAt));
  return rows.map((r) => ({ ...r, current: r.id === currentSessionId }));
}

export async function getMyProfile(userId: string) {
  const [u] = await db
    .select({
      name: users.name,
      email: users.email,
      phone: users.phone,
      avatarMediaId: users.avatarMediaId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return u ?? null;
}
