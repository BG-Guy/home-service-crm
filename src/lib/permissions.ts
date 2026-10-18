// Permission keys, default grants and the resolver (SPEC §4.1–§4.2).
// Single source of truth: every module's `permissions.ts` table, aggregated here.
// The resolver is a pure function (golden-tested in tests/golden/permissions.test.ts).
// Client-safe (no DB). DB-backed helpers (loadPermSubject, listUsersWithPerm) live in
// ./permissions-db.ts (server-only).
import type { BaseRole } from "@/db/enums";
import { grants as auth } from "@/features/auth/permissions";
import { grants as automations } from "@/features/automations/permissions";
import { grants as customers } from "@/features/customers/permissions";
import { grants as data } from "@/features/data/permissions";
import { grants as disputes } from "@/features/disputes/permissions";
import { grants as estimates } from "@/features/estimates/permissions";
import { grants as insights } from "@/features/insights/permissions";
import { grants as invoices } from "@/features/invoices/permissions";
import { grants as jobs } from "@/features/jobs/permissions";
import { grants as leads } from "@/features/leads/permissions";
import { grants as map } from "@/features/map/permissions";
import { grants as media } from "@/features/media/permissions";
import { grants as messaging } from "@/features/messaging/permissions";
import { grants as notify } from "@/features/notify/permissions";
import { grants as parts } from "@/features/parts/permissions";
import { grants as payments } from "@/features/payments/permissions";
import { grants as payroll } from "@/features/payroll/permissions";
import { grants as portal } from "@/features/portal/permissions";
import { grants as reviews } from "@/features/reviews/permissions";
import { grants as settings } from "@/features/settings/permissions";
import { grants as team } from "@/features/team/permissions";
import { grants as tech } from "@/features/tech/permissions";
import { grants as tools } from "@/features/tools/permissions";
import { grants as vehicles } from "@/features/vehicles/permissions";

/** Module key → its grant table, in §5 order (drives the /settings/permissions grid sections). */
export const PERMISSIONS_BY_MODULE = {
  auth,
  team,
  customers,
  leads,
  jobs,
  tech,
  estimates,
  invoices,
  payments,
  disputes,
  media,
  messaging,
  automations,
  reviews,
  parts,
  payroll,
  vehicles,
  tools,
  map,
  insights,
  settings,
  notify,
  portal,
  data,
} as const;

/** Flat key → grant letters ("AOT", "A", "" …). */
export const PERMISSION_TABLE = {
  ...auth,
  ...team,
  ...customers,
  ...leads,
  ...jobs,
  ...tech,
  ...estimates,
  ...invoices,
  ...payments,
  ...disputes,
  ...media,
  ...messaging,
  ...automations,
  ...reviews,
  ...parts,
  ...payroll,
  ...vehicles,
  ...tools,
  ...map,
  ...insights,
  ...settings,
  ...notify,
  ...portal,
  ...data,
} as const;

/** Every permission key (typed union derived from all modules). */
export type Perm = keyof typeof PERMISSION_TABLE;

export const ALL_PERMS = Object.keys(PERMISSION_TABLE) as Perm[];

export function isPerm(key: string): key is Perm {
  return Object.hasOwn(PERMISSION_TABLE, key);
}

const LETTER: Record<BaseRole, string> = { admin: "A", office: "O", tech: "T" };

function grantsFor(role: BaseRole): ReadonlySet<Perm> {
  return new Set(
    ALL_PERMS.filter((p) =>
      (PERMISSION_TABLE[p] as string).includes(LETTER[role]),
    ),
  );
}

/** Code defaults per base role (SPEC §4.2). */
export const DEFAULT_GRANTS: Readonly<Record<BaseRole, ReadonlySet<Perm>>> = {
  admin: grantsFor("admin"),
  office: grantsFor("office"),
  tech: grantsFor("tech"),
};

/** Admins always hold these; they can't be revoked from the role (SPEC §4.1 locks). */
export const ADMIN_LOCKED_PERMS: readonly Perm[] = [
  "settings.permissions",
  "users.manage",
];
/** Never grantable to non-admins through a user override. */
export const ADMIN_ONLY_OVERRIDE_PERMS: readonly Perm[] = [
  "settings.permissions",
];

export type PermEffect = "allow" | "deny";

/** Everything the resolver needs about one user (pure data). */
export interface PermSubject {
  /** roles.key (may be custom). */
  role: string;
  /** roles.base_role: which DEFAULT_GRANTS the role inherits. */
  baseRole: BaseRole;
  /** user_permission_overrides for this user. */
  overrides?: Readonly<Partial<Record<string, PermEffect>>>;
  /** role_permissions rows for this user's role (admin-edited grid). */
  roleGrid?: Readonly<Partial<Record<string, boolean>>>;
}

/**
 * effective(user, perm) =
 *   user override (allow|deny)  ??  role grid (granted)  ??  DEFAULT_GRANTS[baseRole]
 * with locks: admin roles always hold ADMIN_LOCKED_PERMS; an override can't grant
 * settings.permissions to a non-admin.
 */
export function effective(subject: PermSubject, perm: Perm): boolean {
  const isAdmin = subject.baseRole === "admin";
  if (isAdmin && ADMIN_LOCKED_PERMS.includes(perm)) return true;

  const override = subject.overrides?.[perm];
  if (override === "deny") return false;
  if (override === "allow") {
    if (!isAdmin && ADMIN_ONLY_OVERRIDE_PERMS.includes(perm)) {
      // fall through: an override can't grant this to a non-admin
    } else {
      return true;
    }
  }

  const grid = subject.roleGrid?.[perm];
  if (typeof grid === "boolean") return grid;

  return DEFAULT_GRANTS[subject.baseRole]?.has(perm) ?? false;
}

/** All effective permissions of a subject. */
export function resolvePerms(subject: PermSubject): Set<Perm> {
  const out = new Set<Perm>();
  for (const p of ALL_PERMS) if (effective(subject, p)) out.add(p);
  return out;
}

/** Does `user` hold `perm`? (SessionUser carries a resolved set.) */
export function can(
  user: { perms: ReadonlySet<Perm> } | null | undefined,
  perm: Perm,
): boolean {
  return !!user && user.perms.has(perm);
}

export function canAll(
  user: { perms: ReadonlySet<Perm> } | null | undefined,
  perms: readonly Perm[],
): boolean {
  return !!user && perms.every((p) => user.perms.has(p));
}

export function canAny(
  user: { perms: ReadonlySet<Perm> } | null | undefined,
  perms: readonly Perm[],
): boolean {
  return !!user && perms.some((p) => user.perms.has(p));
}

/** Lock check for a role-grid edit (B8 calls this before writing role_permissions). */
export function checkRoleGridChange(
  baseRole: BaseRole,
  perm: Perm,
  granted: boolean,
): { ok: true } | { ok: false; reason: string } {
  if (!granted && baseRole === "admin" && ADMIN_LOCKED_PERMS.includes(perm)) {
    return { ok: false, reason: `Admins always keep ${perm}.` };
  }
  return { ok: true };
}

/** Lock check for a user override (B8 calls this before writing user_permission_overrides). */
export function checkOverrideChange(
  baseRole: BaseRole,
  perm: Perm,
  effect: PermEffect | null,
): { ok: true } | { ok: false; reason: string } {
  if (
    effect === "allow" &&
    baseRole !== "admin" &&
    ADMIN_ONLY_OVERRIDE_PERMS.includes(perm)
  ) {
    return { ok: false, reason: `${perm} can only be held by admins.` };
  }
  if (
    effect === "deny" &&
    baseRole === "admin" &&
    ADMIN_LOCKED_PERMS.includes(perm)
  ) {
    return { ok: false, reason: `Admins always keep ${perm}.` };
  }
  return { ok: true };
}

export function toBaseRole(value: string | null | undefined): BaseRole {
  return value === "admin" || value === "office" || value === "tech"
    ? value
    : "tech";
}
