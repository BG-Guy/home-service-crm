// Contract types for B3 estimates (BUILD_PLAN §5.2, §6.3). Types only.
export interface ChangeOrderStatus {
  signedTotalCents: number | null;
  currentTotalCents: number;
  thresholdExceeded: boolean;
  required: boolean; // thresholdExceeded && no approved+signed CO covering the delta
  pendingChangeOrderIds: string[];
}
export interface EstimateBrief {
  id: string;
  number: string;
  status:
    | "draft"
    | "sent"
    | "viewed"
    | "approved"
    | "declined"
    | "expired"
    | "superseded";
  jobId: string | null;
  customerId: string;
  totalCents: number; // recommended or max option
  sentAt: Date | null;
  expiresAt: Date | null;
}
export type JobEstimatePanelProps = { jobId: string };
export type CustomerEstimatesPanelProps = { customerId: string };
