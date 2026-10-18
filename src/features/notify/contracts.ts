// Contract types for B5 notifications / activity (BUILD_PLAN §5.2, §6.5). Types only.
import type { Perm } from "@/lib/permissions";
import type { EntityRef } from "@/lib/types";

export interface NotifyInput {
  to: { userIds?: string[]; perm?: Perm; role?: string };
  type: string; // template key, e.g. 'staff.generic'
  title: string;
  body?: string | null;
  url?: string | null;
  entity?: EntityRef;
  priority?: "normal" | "high";
  channels?: ("in_app" | "push" | "email")[]; // default: per-user prefs
}

export type TimelineFilter = "all" | "messages" | "jobs" | "money" | "notes";
export type ActivityTimelineProps = {
  customerId?: string;
  jobId?: string;
  entity?: EntityRef;
  filter?: TimelineFilter;
  showFilterChips?: boolean;
  limit?: number;
};
export type NotificationPreferencesProps = { userId: string };

// ------------------------------------------------------------------ B5 internal DTOs
// (UI ↔ actions; not part of the frozen cross-module contract)

/** One timeline row (S33). `id` is the activity row id (cursor). */
export interface ActivityItemDTO {
  id: number;
  at: string;
  kind: string;
  summary: string;
  actor: string | null;
  href: string | null;
}

/** Timeline scope: exactly one of these is set. */
export interface TimelineScope {
  customerId?: string;
  jobId?: string;
  entity?: EntityRef;
}

export interface NotificationDTO {
  id: string;
  type: string;
  title: string;
  body: string | null;
  url: string | null;
  priority: string;
  read: boolean;
  at: string;
}

export interface AuditRowDTO {
  id: number;
  at: string;
  actor: string;
  actorKind: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
}
