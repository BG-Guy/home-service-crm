import "server-only";
import { assertJobAccess } from "@/features/jobs/api";
import { getCurrentUser } from "@/lib/auth/current";
import { getCompanyTimezone, isEnabled } from "@/lib/settings";
import { formatDateTime } from "@/lib/time";
import {
  getJobRisk,
  previewJobRisk,
  previewReadiness,
  riskControls,
} from "./api";
import { ReadinessWhyButton, RiskWhyButton } from "./components/ScoreSheets";
import type { JobReadinessRingProps, JobRiskChipProps } from "./contracts";
import { RISK_SIGNAL_LABELS, type RiskSignalKey } from "./risk";

// Server UI slots produced by B4 (BUILD_PLAN §5.1). Each checks its own permission,
// row scope and feature flag (`chargeback_protection`) and returns null otherwise.

async function visible(jobId: string) {
  const user = await getCurrentUser();
  if (!user) return null;
  if (!(await isEnabled("chargeback_protection"))) return null;
  try {
    return await assertJobAccess(user, jobId, "read");
  } catch {
    return null;
  }
}

/** Human labels for the controls a band requires (§11.1 table). */
async function controlLabels(band: "low" | "medium" | "high" | "critical") {
  const c = riskControls(band);
  const photos =
    (await isEnabled("photos")) && (await isEnabled("before_after"));
  const out: string[] = [];
  if (c.signedEstimate) out.push("Signed estimate before Complete");
  if (c.minPhotos)
    out.push(
      photos
        ? "At least 1 before and 1 after photo"
        : "Completion signature (photos are off)",
    );
  if (c.depositOrHold) out.push("Deposit or card hold");
  if (c.require3dsOrCardPresent)
    out.push("Card only in person or by a 3-D Secure link (no typed cards)");
  if (c.completionSignature) out.push("Customer signs the completion form");
  if (c.startApprovalOrPrepay)
    out.push("Admin approval to start, prepayment, or cash/bank transfer only");
  return [...new Set(out)];
}

/** S21 — Risk band chip plus a "why" sheet listing signals (§11.1). */
export async function JobRiskChip({ jobId, showWhy = true }: JobRiskChipProps) {
  const job = await visible(jobId);
  if (!job) return null;
  const r = (await getJobRisk(jobId)) ?? (await previewJobRisk(jobId));
  if (!r) return null;
  const tz = await getCompanyTimezone();
  return (
    <RiskWhyButton
      band={r.band}
      score={r.score}
      showWhy={showWhy}
      computedAt={formatDateTime(r.computedAt, tz)}
      controls={await controlLabels(r.band)}
      signals={r.signals
        .filter((s) => s.points !== 0)
        .sort((a, b) => b.points - a.points)
        .map((s) => ({
          key: s.key,
          points: s.points,
          detail: s.detail,
          label: RISK_SIGNAL_LABELS[s.key as RiskSignalKey] ?? s.key,
        }))}
    />
  );
}

/** S22 — Readiness ring plus missing items (§11.2). */
export async function JobReadinessRing({
  jobId,
  size = 36,
  showWhy = true,
}: JobReadinessRingProps) {
  const job = await visible(jobId);
  if (!job) return null;
  const r = await previewReadiness(jobId);
  if (!r) return null;
  return (
    <ReadinessWhyButton
      score={r.score}
      size={size}
      showWhy={showWhy}
      items={r.items.map((i) => ({
        key: i.key,
        label: i.label,
        weight: i.weight,
        applicable: i.applicable,
        earned: i.earned,
        hint: i.hint,
      }))}
    />
  );
}
