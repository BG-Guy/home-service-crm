// Contract types for B6 approvals (BUILD_PLAN §6.6, §6.10). Types only.
import type { ReactNode } from "react";
import type { Tx } from "@/db";
import type { Perm } from "@/lib/permissions";
import type { Actor } from "@/lib/types";

export type ApprovalEntityType =
  | "odometer"
  | "fuel"
  | "service"
  | "document"
  | "inspection"
  | "trip"
  | "part_purchase"
  | "job_cancel"
  | "job_start"
  | "settlement_flag";

export interface ApprovalRow {
  id: string;
  entityType: ApprovalEntityType;
  entityId: string;
  policy: "auto" | "auto_if_evidence" | "always_review";
  status: "pending" | "approved" | "rejected";
  requestedBy: string | null;
  reviewerId: string | null;
  decidedAt: Date | null;
  reason: string | null;
  evidence: Record<string, unknown> | null;
  createdAt: Date;
}

export type ApprovalDecision = {
  decision: "approved" | "rejected";
  reason?: string | null;
  edits?: Record<string, unknown>;
};

/** A correctable value shown in the edit-and-approve sheet; submitted as `edits[key]`. */
export interface ApprovalEditField {
  key: string;
  label: string;
  type: "money" | "text" | "date" | "number";
  value: string | number | null;
}

/** Serializable queue item for the /approvals client list. */
export interface ApprovalQueueItem {
  id: string;
  entityType: ApprovalEntityType;
  kindLabel: string;
  createdAt: string;
  requestedByName: string | null;
  clean: boolean;
  editable: boolean;
}

export interface ApprovalKindDef {
  entityTypes: ApprovalEntityType[];
  /** Decide permission: vehicles.log_approve | parts.approve_reimbursement | jobs.review_cancellations | jobs.approve_start | payroll.manage */
  perm: Perm;
  label: string;
  Row(p: { approval: ApprovalRow }): Promise<ReactNode>; // server component: one-line summary
  Detail(p: { approval: ApprovalRow }): Promise<ReactNode>; // server component: evidence side-by-side
  clean?(approval: ApprovalRow): boolean; // eligible for "Approve all clean"
  /** Optional (B6 addition): fields an approver may correct before approving ("edit and approve"). */
  editFields?(approval: ApprovalRow): Promise<ApprovalEditField[]>;
  /** Optional (B6 addition): link to the underlying record. */
  href?(approval: ApprovalRow): string | null;
  onDecide(
    tx: Tx,
    approval: ApprovalRow,
    d: ApprovalDecision,
    actor: Actor,
  ): Promise<void>;
}
