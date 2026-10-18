import "server-only";
import { and, asc, eq, inArray, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { roles, users } from "@/db/schema";
import { getMediaUrls } from "@/features/media/api";
import { type Perm, toBaseRole } from "@/lib/permissions";
import { listUsersWithPerm } from "@/lib/permissions-db";
import type { UserBrief } from "./contracts";

// B8 team API (BUILD_PLAN §6.8). F stubs (level F) — B8 may refine, keep signatures.

export type * from "./contracts";

async function briefs(where: SQL | undefined): Promise<UserBrief[]> {
  const rows = await db
    .select({ u: users, baseRole: roles.baseRole })
    .from(users)
    .leftJoin(roles, eq(roles.key, users.role))
    .where(where)
    .orderBy(asc(users.name));
  const avatarIds = rows
    .map((r) => r.u.avatarMediaId)
    .filter((x): x is string => !!x);
  const urls = avatarIds.length ? await getMediaUrls(avatarIds, "thumb") : {};
  return rows.map(({ u, baseRole }) => ({
    id: u.id,
    name: u.name,
    firstName: u.name.trim().split(/\s+/)[0] ?? u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    baseRole: toBaseRole(baseRole ?? u.role),
    status: u.status,
    workerType: u.workerType === "w2" ? "w2" : "1099",
    color: u.color,
    avatarUrl: u.avatarMediaId ? (urls[u.avatarMediaId] ?? null) : null,
    licenseNumbers: (u.licenseNumbers ?? []).map((l) => ({
      state: l.state,
      trade: l.trade,
      number: l.number,
      expiresOn: l.expires_on ?? null,
    })),
    usesCompanyTools: u.usesCompanyTools,
    usesCompanyVehicle: u.usesCompanyVehicle,
  }));
}

/** stub F */
export async function getUserBriefs(
  userIds: string[],
): Promise<Record<string, UserBrief>> {
  if (userIds.length === 0) return {};
  const list = await briefs(inArray(users.id, [...new Set(userIds)]));
  return Object.fromEntries(list.map((b) => [b.id, b]));
}

/** stub F: filter by roles / statuses (default active) / effective permission. */
export async function listUsers(q?: {
  roles?: string[];
  statuses?: string[];
  perm?: Perm;
}): Promise<UserBrief[]> {
  const conds: SQL[] = [
    inArray(users.status, q?.statuses?.length ? q.statuses : ["active"]),
  ];
  if (q?.roles?.length) conds.push(inArray(users.role, q.roles));
  if (q?.perm) {
    const ids = await listUsersWithPerm(q.perm);
    if (ids.length === 0) return [];
    conds.push(inArray(users.id, ids));
  }
  return briefs(and(...conds));
}
