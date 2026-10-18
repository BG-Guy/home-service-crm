import "server-only";
import { desc, eq } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { riskAssessments } from "@/db/schema";
import { setJobReadiness, setJobRisk } from "@/features/jobs/api";
import type { RiskBand } from "@/features/jobs/contracts";
import { ensureDepositRequest } from "@/features/payments/api";
import { writeActivity } from "@/lib/activity";
import { getSettings, isEnabled } from "@/lib/settings";
import { SYSTEM_ACTOR } from "@/lib/types";
import type {
  ControlCheck,
  ReadinessItem,
  ReadinessResult,
  RiskControls,
  RiskResult,
} from "./contracts";
import { controlsForBand, evaluateControls } from "./controls";
import {
  loadControlFacts,
  loadJob,
  loadReadinessFacts,
  loadRiskFacts,
} from "./facts";
import { scoreReadiness } from "./readiness";
import { bandRank, RISK_SIGNAL_LABELS, scoreRisk } from "./risk";

// B4 risk / readiness / controls API (BUILD_PLAN §6.4, SPEC §11). The scoring is pure
// (risk.ts, readiness.ts, controls.ts); this file loads facts and persists results.

export type * from "./contracts";

type Trigger =
  | "estimate_changed"
  | "payer_changed"
  | "payment_method"
  | "schedule"
  | "manual";

const PRE_START = new Set(["unscheduled", "scheduled", "confirmed"]);

/** Current risk config from settings. */
async function riskConfig() {
  const s = await getSettings();
  return {
    weights: s.risk.weights,
    bands: s.risk.bands,
    noEstimateMinTicketCents: s.risk.no_estimate_min_ticket_cents,
  };
}

/** Score without persisting (UI previews, "why" sheet). */
export async function previewJobRisk(
  jobId: string,
): Promise<RiskResult | null> {
  const job = await loadJob(jobId);
  if (!job) return null;
  const r = scoreRisk(await loadRiskFacts(job), await riskConfig());
  return { ...r, computedAt: new Date() };
}

/**
 * Loads inputs, runs the pure engine, inserts `risk_assessments` (when the result changed
 * or on a manual run), updates the job cache via B2 setJobRisk. When the band rises to
 * ≥ High before the job starts, asks for a deposit (context `risk_changed`).
 */
export async function computeJobRisk(
  tx: Tx,
  jobId: string,
  trigger: Trigger,
): Promise<RiskResult> {
  const job = await loadJob(jobId);
  const now = new Date();
  if (!job) return { score: 0, band: "low", signals: [], computedAt: now };
  const r = scoreRisk(await loadRiskFacts(job, now), await riskConfig());
  const [prev] = await tx
    .select()
    .from(riskAssessments)
    .where(eq(riskAssessments.jobId, jobId))
    .orderBy(desc(riskAssessments.computedAt))
    .limit(1);
  const sigKey = (s: { key: string; points: number }[]) =>
    s
      .map((x) => `${x.key}:${x.points}`)
      .sort()
      .join(",");
  const changed =
    !prev ||
    prev.score !== r.score ||
    prev.band !== r.band ||
    sigKey(prev.signals) !== sigKey(r.signals);
  if (changed || trigger === "manual") {
    await tx.insert(riskAssessments).values({
      jobId,
      score: r.score,
      band: r.band,
      signals: r.signals,
      trigger,
      computedAt: now,
    });
  }
  if (job.riskScore !== r.score || job.riskBand !== r.band) {
    await setJobRisk(tx, jobId, { score: r.score, band: r.band });
    if (job.riskBand !== r.band) {
      const top = r.signals
        .filter((s) => s.points > 0)
        .sort((a, b) => b.points - a.points)
        .slice(0, 2)
        .map((s) => RISK_SIGNAL_LABELS[s.key].toLowerCase());
      await writeActivity(tx, {
        entity: { type: "job", id: jobId },
        customerId: job.customerId,
        jobId,
        kind: "job.risk_changed",
        summary: `Risk ${r.band} (${r.score})${top.length ? `: ${top.join(", ")}` : ""}`,
        data: { score: r.score, band: r.band, from: job.riskBand },
        actorUserId: null,
      });
      const rose =
        bandRank(r.band) >= bandRank("high") &&
        bandRank(r.band) > bandRank((job.riskBand as RiskBand) ?? "low");
      if (rose && PRE_START.has(job.status) && (await isEnabled("deposits")))
        await ensureDepositRequest(
          tx,
          { jobId, context: "risk_changed" },
          SYSTEM_ACTOR,
        );
    }
  }
  return { ...r, computedAt: now };
}

/** Latest stored assessment. */
export async function getJobRisk(jobId: string): Promise<RiskResult | null> {
  const [r] = await db
    .select()
    .from(riskAssessments)
    .where(eq(riskAssessments.jobId, jobId))
    .orderBy(desc(riskAssessments.computedAt))
    .limit(1);
  if (!r) return null;
  return {
    score: r.score,
    band: r.band as RiskBand,
    signals: r.signals.map((s) => ({
      key: s.key,
      points: s.points,
      detail: s.detail ?? "",
    })),
    computedAt: r.computedAt,
  };
}

async function readinessFor(jobId: string): Promise<ReadinessResult | null> {
  const job = await loadJob(jobId);
  if (!job) return null;
  const s = await getSettings();
  const r = scoreReadiness(
    await loadReadinessFacts(job),
    s.disputes.readiness_weights,
  );
  return {
    score: r.score,
    items: r.items.map((i) => ({ ...i }) as ReadinessItem),
  };
}

/** Score without persisting (UI). */
export async function previewReadiness(
  jobId: string,
): Promise<ReadinessResult | null> {
  return readinessFor(jobId);
}

/** Computes the §11.2 score and persists it via B2 setJobReadiness (when changed). */
export async function computeReadiness(
  tx: Tx,
  jobId: string,
): Promise<ReadinessResult> {
  const r = await readinessFor(jobId);
  if (!r) return { score: 0, items: [] };
  const job = await loadJob(jobId);
  if (job && job.readinessScore !== r.score)
    await setJobReadiness(tx, jobId, r.score);
  return r;
}

/**
 * Risk-band controls (§11.1), service-type requirements (signed estimate, photos with the
 * photos/before_after knock-ons), completion signature, deposit/hold, Critical start
 * approval or prepay, change order. B2 adds its own guards. overridable=true ⇒
 * jobs.override_requirements may bypass with a reason.
 */
export async function evaluateTransitionControls(
  jobId: string,
  to: "in_progress" | "completed",
): Promise<ControlCheck> {
  if (!(await isEnabled("chargeback_protection"))) {
    // Protection off: only service-type requirements still apply.
    const job = await loadJob(jobId);
    if (!job) return { ok: true, missing: [] };
    const f = await loadControlFacts(job, to);
    return evaluateControls({ ...f, enforceBandControls: false });
  }
  const job = await loadJob(jobId);
  if (!job) return { ok: true, missing: [] };
  return evaluateControls(await loadControlFacts(job, to));
}

/** Pure §11.1 band → controls table. */
export function riskControls(band: RiskBand): RiskControls {
  return controlsForBand(band);
}
