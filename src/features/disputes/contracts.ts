// Contract types for B4 disputes / risk / readiness (BUILD_PLAN §5.2, §6.4). Types only.
import type { RiskBand } from "@/features/jobs/contracts";

export interface RiskResult {
  score: number;
  band: RiskBand;
  signals: { key: string; points: number; detail: string }[];
  computedAt: Date;
}
export interface ReadinessItem {
  key:
    | "signed_estimate"
    | "completion_signed"
    | "before_after_photos"
    | "geostamps"
    | "change_orders_signed"
    | "receipt_delivered"
    | "comms_log"
    | "strong_auth";
  label: string;
  weight: number;
  applicable: boolean;
  earned: boolean;
  hint: string;
}
export interface ReadinessResult {
  score: number;
  items: ReadinessItem[];
}
export interface ControlCheck {
  ok: boolean;
  missing: {
    key: string;
    label: string;
    overridable: boolean;
    action?:
      | "sign_estimate"
      | "capture_photos"
      | "completion_signature"
      | "collect_deposit"
      | "request_start_approval"
      | "change_order"
      | "prepay";
  }[];
}
export interface RiskControls {
  signedEstimate: boolean;
  minPhotos: boolean;
  depositOrHold: boolean;
  noKeyed: boolean;
  require3dsOrCardPresent: boolean;
  completionSignature: boolean;
  startApprovalOrPrepay: boolean;
}
export type JobRiskChipProps = { jobId: string; showWhy?: boolean };
export type JobReadinessRingProps = {
  jobId: string;
  size?: number;
  showWhy?: boolean;
};
