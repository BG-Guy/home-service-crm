// Transition controls (SPEC §11.1 bands → controls, M05 guards, M11 photo knock-ons).
// PURE: `evaluateControls(facts)` decides what's missing; ./api.ts loads the facts.
// B2 adds its own guards (assignee, window, geostamp, checklist, ownership template).
import type { ControlCheck, RiskControls } from "./contracts";
import type { RiskBand } from "./risk";

/** §11.1 band → controls table (pure; frozen contract `riskControls`). */
export function controlsForBand(band: RiskBand): RiskControls {
  const medium = band === "medium" || band === "high" || band === "critical";
  const high = band === "high" || band === "critical";
  return {
    signedEstimate: medium,
    minPhotos: medium,
    depositOrHold: high,
    noKeyed: high,
    require3dsOrCardPresent: high,
    completionSignature: high,
    startApprovalOrPrepay: band === "critical",
  };
}

export interface ControlFacts {
  to: "in_progress" | "completed";
  band: RiskBand | null;
  /** settings.risk.enforce_controls (band controls on/off). */
  enforceBandControls: boolean;
  /** flags `photos` AND `before_after` (both on ⇒ photo controls apply). */
  photosEnabled: boolean;
  depositsEnabled: boolean;
  /** Service type requirements (null when no service type). */
  serviceType: {
    requiresSignedEstimate: boolean;
    photosRequiredBefore: number;
    photosRequiredAfter: number;
  } | null;
  hasSignedAuthorization: boolean;
  beforePhotos: number;
  afterPhotos: number;
  completionSigned: boolean;
  /** A deposit/hold is paid, held, applied or waived — or the job is already (pre)paid. */
  depositSatisfied: boolean;
  /** An open deposit request exists (required/requested). */
  depositOutstanding: boolean;
  /** Critical band: approvals row (entity job_start) is approved. */
  startApproved: boolean;
  /** Critical band: the ticket is fully prepaid. */
  prepaid: boolean;
  /** settings.risk.critical_control. */
  criticalControl: "approval" | "prepay" | "cash_only";
  /** B3 getChangeOrderStatus().required. */
  changeOrderRequired: boolean;
}

type Missing = ControlCheck["missing"][number];

/** What blocks the transition. `overridable` ⇒ jobs.override_requirements may bypass (with a reason). */
export function evaluateControls(f: ControlFacts): ControlCheck {
  const missing: Missing[] = [];
  const c =
    f.enforceBandControls && f.band
      ? controlsForBand(f.band)
      : controlsForBand("low");
  const st = f.serviceType;
  const needBefore = f.photosEnabled ? (st?.photosRequiredBefore ?? 0) : 0;
  const needAfter = f.photosEnabled ? (st?.photosRequiredAfter ?? 0) : 0;
  const sigEstimate = (why: string) =>
    missing.push({
      key: "signed_estimate",
      label: `Signed estimate required (${why})`,
      overridable: true,
      action: "sign_estimate",
    });

  if (f.to === "in_progress") {
    if (st?.requiresSignedEstimate && !f.hasSignedAuthorization)
      sigEstimate("service type");
    if (needBefore > 0 && f.beforePhotos < needBefore)
      missing.push({
        key: "photos_before",
        label: `Take ${needBefore - f.beforePhotos} more before photo${needBefore - f.beforePhotos === 1 ? "" : "s"}`,
        overridable: true,
        action: "capture_photos",
      });
    if (c.depositOrHold && f.depositsEnabled && !f.depositSatisfied)
      missing.push({
        key: "deposit",
        label: f.depositOutstanding
          ? "Collect the required deposit (high risk)"
          : "Take a deposit or card hold (high risk)",
        overridable: true,
        action: "collect_deposit",
      });
    if (c.startApprovalOrPrepay && !f.startApproved && !f.prepaid) {
      if (f.criticalControl === "prepay")
        missing.push({
          key: "prepay",
          label: "Critical risk: collect payment before starting",
          overridable: false,
          action: "prepay",
        });
      else if (f.criticalControl === "approval")
        missing.push({
          key: "start_approval",
          label: "Critical risk: admin approval or prepayment to start",
          overridable: false,
          action: "request_start_approval",
        });
      // cash_only: the start is allowed; the payment sheet restricts card methods.
    }
  } else {
    if (
      (c.signedEstimate || st?.requiresSignedEstimate) &&
      !f.hasSignedAuthorization
    )
      sigEstimate(c.signedEstimate ? "risk" : "service type");
    // Min photo set for Medium+; replaced by the completion signature when photos are off.
    const minBefore = Math.max(needBefore, c.minPhotos ? 1 : 0);
    const minAfter = Math.max(needAfter, c.minPhotos ? 1 : 0);
    if (f.photosEnabled) {
      if (f.beforePhotos < minBefore)
        missing.push({
          key: "photos_before",
          label: `Before photos: ${f.beforePhotos} of ${minBefore}`,
          overridable: true,
          action: "capture_photos",
        });
      if (f.afterPhotos < minAfter)
        missing.push({
          key: "photos_after",
          label: `After photos: ${f.afterPhotos} of ${minAfter}`,
          overridable: true,
          action: "capture_photos",
        });
    }
    const sigNeeded =
      c.completionSignature || (c.minPhotos && !f.photosEnabled);
    if (sigNeeded && !f.completionSigned)
      missing.push({
        key: "completion_signature",
        label: "Customer completion signature",
        overridable: true,
        action: "completion_signature",
      });
    if (f.changeOrderRequired)
      missing.push({
        key: "change_order",
        label: "Signed change order for the extra work",
        overridable: true,
        action: "change_order",
      });
  }
  return { ok: missing.length === 0, missing };
}
