import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { serviceTypes } from "@/db/schema";
import type { ServiceTypeOption } from "./contracts";
import { kindOf, splitByKind } from "./kinds";

// Job types for pickers (leads-flow redesign, item 6): the three kinds and the
// trade's jobs under them. A plain read with no permission check and no
// @/lib/auth/current import, so pages, actions and api.ts can all call it; callers
// check access first (like settings' listServiceTypes).

/**
 * Live job types sorted by sort order then name; archived ones only with
 * `includeInactive`. Group them with `splitByKind` (./kinds.ts); `primary` is set
 * on each kind's own row among the rows returned.
 */
export async function listServiceTypeOptions(
  opts: { includeInactive?: boolean; tx?: Tx } = {},
): Promise<ServiceTypeOption[]> {
  const conds = [isNull(serviceTypes.deletedAt)];
  if (!opts.includeInactive) conds.push(eq(serviceTypes.active, true));
  const rows = await (opts.tx ?? db)
    .select({
      id: serviceTypes.id,
      name: serviceTypes.name,
      kind: serviceTypes.kind,
      icon: serviceTypes.icon,
      color: serviceTypes.color,
      defaultDurationMin: serviceTypes.defaultDurationMin,
      defaultPriceCents: serviceTypes.defaultPriceCents,
      requiresOwnershipCheck: serviceTypes.requiresOwnershipCheck,
      active: serviceTypes.active,
    })
    .from(serviceTypes)
    .where(and(...conds))
    .orderBy(asc(serviceTypes.sort), asc(serviceTypes.name));
  // The kind's own row is picked among live rows, so an archived "Project" never
  // shadows the one in use.
  const primaries = new Set(
    splitByKind(rows.filter((r) => r.active))
      .map((g) => g.primary?.id)
      .filter(Boolean),
  );
  return rows.map((r) => ({
    ...r,
    kind: kindOf(r.kind),
    primary: primaries.has(r.id),
  }));
}
