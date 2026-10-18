// Internal DTOs for the jobs module UI (not cross-module contracts; those live in
// contracts.ts). Client-safe: types only, dates as ISO strings when they cross to
// client components.
import type { ChecklistPhotoTag } from "./checklist";
import type { JobStatus, PaymentStatus, RiskBand } from "./contracts";
import type { GuardMiss } from "./machine";

export interface JobListItem {
  id: string;
  number: string;
  title: string;
  status: JobStatus;
  paymentStatus: PaymentStatus;
  priority: "normal" | "urgent" | "emergency";
  customerId: string;
  customerName: string;
  propertyId: string;
  addressShort: string;
  /** Street masked: outside the viewer's contact window (no navigation link). */
  addressMasked?: boolean;
  /** The property's geocode, only when the address is revealed (route map pin). */
  lat?: number | null;
  lng?: number | null;
  city: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  serviceTypeName: string | null;
  isCallback: boolean;
  riskBand: RiskBand | null;
  assignees: {
    userId: string;
    name: string;
    role: string;
    color: string | null;
  }[];
  cancelledAfterArrival: boolean;
}

export interface JobListFilters {
  status?: JobStatus[];
  tech?: string;
  from?: string;
  to?: string;
  mine?: boolean;
  callback?: boolean;
  cancelledAfterArrival?: boolean;
  unassigned?: boolean;
  unconfirmed?: boolean;
  noInvoiceAfter48h?: boolean;
  /** Open deposit request (required/requested) — Appendix A, B8 ops board. */
  depositDue?: boolean;
  q?: string;
  /** Tech "My jobs" segment. */
  view?: "upcoming" | "past" | "all";
  cursor?: string | null;
}

export interface ChecklistItemView {
  id: string;
  label: string;
  type: "check" | "text" | "number" | "photo" | "signature" | "select";
  required: boolean;
  options?: string[];
  answer: unknown;
  answeredAt: string | null;
  answeredByName: string | null;
  /** Photo items: the media tag the photo is filed under. */
  photoTag?: ChecklistPhotoTag;
}

export interface StatusEventView {
  id: string;
  from: string | null;
  to: string;
  at: string;
  actorName: string | null;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  distanceM: number | null;
  etaMinutes: number | null;
  note: string | null;
}

export interface JobDetail {
  id: string;
  number: string;
  title: string;
  description: string | null;
  customerNotes: string | null;
  status: JobStatus;
  paymentStatus: PaymentStatus;
  priority: "normal" | "urgent" | "emergency";
  afterHours: boolean;
  customerId: string;
  customerName: string;
  customerFirstName: string | null;
  propertyId: string;
  addressShort: string;
  addressFull: string;
  /** Outside the viewer's contact window: street masked, no lat/lng (SPEC §4.2). */
  addressMasked: boolean;
  lat: number | null;
  lng: number | null;
  serviceTypeId: string | null;
  serviceTypeName: string | null;
  leadId: string | null;
  estimateId: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  confirmedAt: string | null;
  enRouteAt: string | null;
  etaAt: string | null;
  arrivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  closedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  cancelNote: string | null;
  cancelReviewStatus: string | null;
  isCallback: boolean;
  callbackOfJobId: string | null;
  callbackOfNumber: string | null;
  callbackReason: string | null;
  callbacks: { id: string; number: string; status: JobStatus }[];
  warrantyExpiresAt: string | null;
  recurrence: { every: "weeks" | "months"; n: number; until?: string } | null;
  visitCount: number;
  riskScore: number | null;
  riskBand: RiskBand | null;
  readinessScore: number | null;
  settlementLockedAt: string | null;
  holdReason: string | null;
  rescheduleRequestedAt: string | null;
  rescheduleNote: string | null;
  assignees: {
    userId: string;
    name: string;
    role: "primary" | "helper";
    splitBps: number;
    color: string | null;
  }[];
  viewerIsAssignee: boolean;
  checklist: ChecklistItemView[];
  custom: Record<string, unknown>;
  createdAt: string;
  createdByName: string | null;
  createdById: string | null;
}

/** Pre-computed transition checks passed to the action bar (re-checked by the action). */
export interface TransitionPreview {
  ok: boolean;
  missing: GuardMiss[];
  errors: GuardMiss[];
}

export interface TechContact {
  phone: string | null;
  phoneMasked: string | null;
  revealed: boolean;
}

export type TransitionResult =
  | {
      status: "done";
      from: JobStatus;
      to: JobStatus;
      warnings: string[];
      invoiceId?: string | null;
    }
  | { status: "blocked"; missing: GuardMiss[] };

export interface AssignOption {
  userId: string;
  name: string;
  color: string | null;
  clockedIn: boolean;
  jobsThatDay: number;
  conflicts: string[];
  outsideZip: boolean;
}

export interface AssignOptions {
  jobId: string;
  number: string;
  title: string;
  status: JobStatus;
  date: string | null;
  start: string | null;
  minutes: number;
  windowLengths: number[];
  assignees: { userId: string; role: "primary" | "helper"; splitBps: number }[];
  techs: AssignOption[];
  tz: string;
}
