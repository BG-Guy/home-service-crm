// Contract types for B2 jobs (BUILD_PLAN §5.2, §6.2). Types only.
import type { PropertyBrief } from "@/features/customers/contracts";
import type { EntityRef } from "@/lib/types";

export type JobStatus =
  | "unscheduled"
  | "scheduled"
  | "confirmed"
  | "en_route"
  | "arrived"
  | "in_progress"
  | "on_hold"
  | "completed"
  | "closed"
  | "cancelled";
export type PaymentStatus =
  | "none"
  | "deposit_paid"
  | "partial"
  | "paid"
  | "refunded"
  | "disputed";
export type RiskBand = "low" | "medium" | "high" | "critical";

export interface CreateJobInput {
  customerId: string;
  propertyId: string;
  serviceTypeId?: string | null;
  title: string;
  description?: string | null;
  customerNotes?: string | null;
  priority?: "normal" | "urgent" | "emergency";
  afterHours?: boolean;
  leadId?: string | null;
  estimateId?: string | null;
  windowStart?: Date | null;
  windowEnd?: Date | null;
  scheduledStart?: Date | null;
  scheduledEnd?: Date | null;
  assignees?: {
    userId: string;
    role: "primary" | "helper";
    splitBps: number;
  }[];
  callbackOfJobId?: string | null;
  callbackReason?: "workmanship" | "part" | "customer" | "other" | null;
  recurrence?: { every: "weeks" | "months"; n: number; until?: string } | null;
  custom?: Record<string, unknown>;
}

export interface JobView {
  id: string;
  number: string;
  status: JobStatus;
  paymentStatus: PaymentStatus;
  customerId: string;
  propertyId: string;
  serviceTypeId: string | null;
  serviceTypeName: string | null;
  leadId: string | null;
  estimateId: string | null;
  title: string;
  priority: "normal" | "urgent" | "emergency";
  afterHours: boolean;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  windowStart: Date | null;
  windowEnd: Date | null;
  enRouteAt: Date | null;
  arrivedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  riskScore: number | null;
  riskBand: RiskBand | null;
  readinessScore: number | null;
  isCallback: boolean;
  callbackOfJobId: string | null;
  visitCount: number;
  settlementLockedAt: Date | null;
  assignees: {
    userId: string;
    name: string;
    role: "primary" | "helper";
    splitBps: number;
  }[];
  viewerIsAssignee: boolean;
}

export interface JobContext extends JobView {
  customer: {
    id: string;
    displayName: string;
    firstName: string | null;
    phone: string | null;
    email: string | null;
    preferredChannel: string;
    smsStatus: string;
  };
  property: PropertyBrief;
  primaryTechId: string | null;
}

export interface TechDayJob {
  jobId: string;
  number: string;
  status: JobStatus;
  propertyId: string;
  addressShort: string;
  lat: number | null;
  lng: number | null;
  serviceTypeName: string | null;
  windowStart: Date | null;
  arrivedAt: Date | null;
  completedAt: Date | null;
}

/**
 * A job type for pickers (booking, New job, caller form): `listServiceTypeOptions()`
 * in ./service-types.ts. `kind` groups it under Free estimate / Service call /
 * Project (labels and defaults in ./kinds.ts); `primary` marks the kind's own row,
 * which a booking uses when no trade job ("What's the job?" chip) is picked.
 */
export interface ServiceTypeOption {
  id: string;
  name: string;
  kind: "estimate" | "service" | "project";
  /** Icon name from src/ui/icons.ts (resolve with `iconFor`), or null. */
  icon: string | null;
  /** Hex color, or null. */
  color: string | null;
  defaultDurationMin: number;
  defaultPriceCents: number | null;
  /** ⚖️ Lockout-style jobs: ID + proof of address before opening (checklist enforced). */
  requiresOwnershipCheck: boolean;
  active: boolean;
  /** The kind's own row (see `KindGroup.primary` in ./kinds.ts). */
  primary: boolean;
}

export interface HistoricalJobRow {
  customerId: string;
  propertyId: string;
  serviceText: string;
  completedOn: string;
  totalCents: number;
  techUserId?: string | null;
  notes?: string | null;
  externalRef?: string | null;
}

// §5.2 slot props
export type CustomerJobsPanelProps = { customerId: string; limit?: number };
export type NotesPanelProps = {
  entity: EntityRef;
  customerId?: string;
  jobId?: string;
  allowCustomerVisible?: boolean;
};
export type ReassignJobsListProps = { userId: string };
export type PortalJobActionsProps = {
  token: string;
  jobId: string;
  status: JobStatus;
  confirmedAt: string | null;
};
export type AssignJobButtonProps = {
  jobId: string;
  label?: string;
  variant?: "filled" | "tinted" | "gray" | "plain";
};
