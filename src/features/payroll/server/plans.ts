import "server-only";
import { and, desc, eq, inArray, isNull, lte } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { compPlans, roles, techComp, users } from "@/db/schema";
import type { TechCompOverrides } from "@/db/schema/payroll";
import {
  type CompPlan,
  planForWorker,
  resolvePlan,
  type TechInput,
  type WorkerType,
} from "../engine";
import { settingsOf } from "./util";

export interface PlanVersion {
  id: string;
  planKey: string;
  name: string;
  version: number;
  effectiveFrom: string;
  plan: CompPlan;
  archivedAt: Date | null;
}

export interface TechPlan {
  userId: string;
  name: string;
  role: string;
  baseRole: string;
  workerType: WorkerType;
  planKey: string;
  planVersion: number;
  planName: string;
  plan: CompPlan;
  overrides: TechCompOverrides;
  techCompId: string | null;
  agreementSignatureId: string | null;
  agreementPlanVersion: number | null;
  roleRateBps: number | null;
}

/** The plan version in effect on `day` (latest version with effective_from ≤ day). */
export async function planVersionOn(
  exec: Tx,
  planKey: string,
  day: string,
): Promise<PlanVersion | null> {
  const rows = await exec
    .select()
    .from(compPlans)
    .where(
      and(eq(compPlans.planKey, planKey), lte(compPlans.effectiveFrom, day)),
    )
    .orderBy(desc(compPlans.version))
    .limit(1);
  let r = rows[0];
  if (!r) {
    [r] = await exec
      .select()
      .from(compPlans)
      .where(eq(compPlans.planKey, planKey))
      .orderBy(desc(compPlans.version))
      .limit(1);
  }
  if (!r) return null;
  return {
    id: r.id,
    planKey: r.planKey,
    name: r.name,
    version: r.version,
    effectiveFrom: r.effectiveFrom,
    plan: resolvePlan(r.config),
    archivedAt: r.archivedAt,
  };
}

/** Latest version of every plan key (for pickers and agreement status). */
export async function latestPlans(exec: Tx = db): Promise<PlanVersion[]> {
  const rows = await exec
    .select()
    .from(compPlans)
    .orderBy(desc(compPlans.version));
  const seen = new Set<string>();
  const out: PlanVersion[] = [];
  for (const r of rows) {
    if (seen.has(r.planKey)) continue;
    seen.add(r.planKey);
    out.push({
      id: r.id,
      planKey: r.planKey,
      name: r.name,
      version: r.version,
      effectiveFrom: r.effectiveFrom,
      plan: resolvePlan(r.config),
      archivedAt: r.archivedAt,
    });
  }
  return out;
}

/** Resolve the plan + overrides for each user on `day` (§M16 assignment). */
export async function techPlans(
  exec: Tx,
  userIds: string[],
  day: string,
): Promise<Map<string, TechPlan>> {
  const out = new Map<string, TechPlan>();
  if (userIds.length === 0) return out;
  const ids = [...new Set(userIds)];
  const s = await settingsOf(exec);
  const us = await exec
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      workerType: users.workerType,
      compPlanKey: users.compPlanKey,
      baseRole: roles.baseRole,
    })
    .from(users)
    .leftJoin(roles, eq(roles.key, users.role))
    .where(inArray(users.id, ids));
  const tcs = await exec
    .select()
    .from(techComp)
    .where(and(inArray(techComp.userId, ids), lte(techComp.effectiveFrom, day)))
    .orderBy(desc(techComp.effectiveFrom), desc(techComp.createdAt));
  const planCache = new Map<string, PlanVersion | null>();
  for (const u of us) {
    const tc = tcs.find((t) => t.userId === u.id) ?? null;
    const planKey = tc?.planKey ?? u.compPlanKey ?? s.payroll.default_plan_key;
    if (!planCache.has(planKey))
      planCache.set(planKey, await planVersionOn(exec, planKey, day));
    const pv = planCache.get(planKey) ?? null;
    const workerType: WorkerType = u.workerType === "w2" ? "w2" : "1099";
    const roleRate = s.payroll.role_rates_bps[u.role];
    out.set(u.id, {
      userId: u.id,
      name: u.name,
      role: u.role,
      baseRole: u.baseRole ?? u.role,
      workerType,
      planKey,
      planVersion: pv?.version ?? 1,
      planName: pv?.name ?? planKey,
      plan: planForWorker(pv?.plan ?? resolvePlan({}), workerType),
      overrides: tc?.overrides ?? {},
      techCompId: tc?.id ?? null,
      agreementSignatureId: tc?.agreementSignatureId ?? null,
      agreementPlanVersion: tc?.agreementPlanVersion ?? null,
      roleRateBps: roleRate ?? null,
    });
  }
  return out;
}

export function toTechInput(t: TechPlan): TechInput {
  return {
    userId: t.userId,
    name: t.name,
    workerType: t.workerType,
    overrides: t.overrides,
    roleRateBps: t.roleRateBps,
  };
}

/** Current (latest effective, any date) tech_comp row. */
export async function currentTechComp(exec: Tx, userId: string) {
  const [row] = await exec
    .select()
    .from(techComp)
    .where(eq(techComp.userId, userId))
    .orderBy(desc(techComp.effectiveFrom), desc(techComp.createdAt))
    .limit(1);
  return row ?? null;
}

/** Plans not archived (for assignment pickers). */
export async function activePlanKeys(
  exec: Tx = db,
): Promise<{ planKey: string; name: string; version: number }[]> {
  const rows = await exec
    .select({
      planKey: compPlans.planKey,
      name: compPlans.name,
      version: compPlans.version,
    })
    .from(compPlans)
    .where(isNull(compPlans.archivedAt))
    .orderBy(desc(compPlans.version));
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (seen.has(r.planKey)) return false;
    seen.add(r.planKey);
    return true;
  });
}
