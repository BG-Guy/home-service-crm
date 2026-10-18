import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  rolePermissions,
  roles,
  userPermissionOverrides,
  users,
} from "@/db/schema";
import {
  effective,
  type Perm,
  type PermEffect,
  type PermSubject,
  toBaseRole,
} from "./permissions";

// DB-backed permission helpers (server only). The pure resolver lives in ./permissions.ts.

/** Load the resolver inputs for a user (role grid + overrides). */
export async function loadPermSubject(
  userId: string,
  role: string,
): Promise<PermSubject> {
  const [roleRows, gridRows, overrideRows] = await Promise.all([
    db
      .select({ baseRole: roles.baseRole })
      .from(roles)
      .where(eq(roles.key, role))
      .limit(1),
    db
      .select({ perm: rolePermissions.perm, granted: rolePermissions.granted })
      .from(rolePermissions)
      .where(eq(rolePermissions.role, role)),
    db
      .select({
        perm: userPermissionOverrides.perm,
        effect: userPermissionOverrides.effect,
      })
      .from(userPermissionOverrides)
      .where(eq(userPermissionOverrides.userId, userId)),
  ]);
  return {
    role,
    baseRole: toBaseRole(roleRows[0]?.baseRole ?? role),
    roleGrid: Object.fromEntries(gridRows.map((r) => [r.perm, r.granted])),
    overrides: Object.fromEntries(
      overrideRows.map((r) => [r.perm, r.effect as PermEffect]),
    ),
  };
}

/** Active users whose EFFECTIVE permission includes `perm` (automation `perm:` audiences). */
export async function listUsersWithPerm(perm: Perm): Promise<string[]> {
  const [userRows, roleRows, gridRows, overrideRows] = await Promise.all([
    db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.status, "active")),
    db.select({ key: roles.key, baseRole: roles.baseRole }).from(roles),
    db
      .select({ role: rolePermissions.role, granted: rolePermissions.granted })
      .from(rolePermissions)
      .where(eq(rolePermissions.perm, perm)),
    db
      .select({
        userId: userPermissionOverrides.userId,
        effect: userPermissionOverrides.effect,
      })
      .from(userPermissionOverrides)
      .where(eq(userPermissionOverrides.perm, perm)),
  ]);
  const base = new Map(roleRows.map((r) => [r.key, toBaseRole(r.baseRole)]));
  const grid = new Map(gridRows.map((r) => [r.role, r.granted]));
  const ov = new Map(
    overrideRows.map((r) => [r.userId, r.effect as PermEffect]),
  );
  return userRows
    .filter((u) => {
      const g = grid.get(u.role);
      const o = ov.get(u.id);
      return effective(
        {
          role: u.role,
          baseRole: base.get(u.role) ?? toBaseRole(u.role),
          roleGrid: g === undefined ? {} : { [perm]: g },
          overrides: o === undefined ? {} : { [perm]: o },
        },
        perm,
      );
    })
    .map((u) => u.id);
}
