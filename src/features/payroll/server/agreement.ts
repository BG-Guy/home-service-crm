import "server-only";
import { eq } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { techComp, users } from "@/db/schema";
import type { Actor } from "@/lib/types";
import { type AgreementDoc, renderAgreement } from "../engine";
import { latestPlans, planVersionOn, techPlans } from "./plans";
import { companyName, companyTz, settingsOf, todayKey } from "./util";

export interface AgreementState {
  doc: AgreementDoc;
  techCompId: string | null;
  planKey: string;
  planVersion: number;
  signedVersion: number | null;
  signatureId: string | null;
  required: boolean;
}

/** The comp agreement the user should sign: their plan's LATEST version + overrides. */
export async function agreementFor(
  userId: string,
  exec: Tx = db,
): Promise<AgreementState | null> {
  const tz = await companyTz(exec);
  const today = todayKey(tz);
  const tp = (await techPlans(exec, [userId], today)).get(userId);
  if (!tp) return null;
  const latest = (await latestPlans(exec)).find(
    (p) => p.planKey === tp.planKey,
  );
  const pv = latest ?? (await planVersionOn(exec, tp.planKey, today));
  const plan = pv?.plan ?? tp.plan;
  const version = pv?.version ?? tp.planVersion;
  const doc = renderAgreement({
    companyName: await companyName(exec),
    techName: tp.name,
    workerType: tp.workerType,
    planKey: tp.planKey,
    planName: pv?.name ?? tp.planName,
    planVersion: version,
    plan,
    overrides: tp.overrides,
  });
  const signedVersion = tp.agreementSignatureId
    ? tp.agreementPlanVersion
    : null;
  return {
    doc,
    techCompId: tp.techCompId,
    planKey: tp.planKey,
    planVersion: version,
    signedVersion,
    signatureId: tp.agreementSignatureId,
    required: signedVersion !== version,
  };
}

/** Make sure the user has a tech_comp row (the agreement's doc id). */
export async function ensureTechComp(
  tx: Tx,
  userId: string,
  actor: Actor,
): Promise<string> {
  const [cur] = await tx
    .select({ id: techComp.id })
    .from(techComp)
    .where(eq(techComp.userId, userId))
    .limit(1);
  if (cur) {
    const tp = (
      await techPlans(tx, [userId], todayKey(await companyTz(tx)))
    ).get(userId);
    if (tp?.techCompId) return tp.techCompId;
    return cur.id;
  }
  const s = await settingsOf(tx);
  const [u] = await tx
    .select({ planKey: users.compPlanKey, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const [row] = await tx
    .insert(techComp)
    .values({
      userId,
      planKey: u?.planKey ?? s.payroll.default_plan_key,
      overrides: {},
      effectiveFrom: "2000-01-01",
      createdBy: actor.userId,
    })
    .returning({ id: techComp.id });
  if (!row) throw new Error("tech_comp insert failed");
  return row.id;
}
