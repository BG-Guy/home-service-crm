// Contract types for B5 messaging (BUILD_PLAN §5.2, §6.5). Types only.
import type { SmsStatus } from "@/features/customers/contracts";
import type { EntityRef } from "@/lib/types";

export type MsgChannel = "sms" | "whatsapp" | "email" | "push" | "in_app";
export type Purpose = "transactional" | "marketing" | "review" | "internal";
export type Audience =
  | { type: "customer"; customerId: string; to?: string | null }
  | { type: "user"; userId: string }
  | { type: "address"; to: string; name?: string | null }; // invites / reset links (no user/customer yet)
export type ScheduledStatus =
  | "scheduled"
  | "deferred_quiet"
  | "pending_tap"
  | "sent"
  | "sent_manual"
  | "skipped"
  | "delivered"
  | "failed"
  | "canceled"
  | "suppressed_optout"
  | "expired";

export interface EnqueueMessageInput {
  templateKey?: string; // preferred; rendered with buildContext(entity) + vars at send time
  body?: string;
  subject?: string; // free text (composer); still passes every compliance check
  channel: MsgChannel | "customer_preferred";
  purpose?: Purpose; // required with free text; else template's purpose
  audience: Audience;
  entity?: EntityRef;
  jobId?: string | null;
  leadId?: string | null;
  vars?: Record<string, string>; // pre-formatted extras: eta_minutes, amount, count …
  sendAt?: Date; // default now
  dedupeKey?: string; // default `manual:<uuid>`; automations use automation:entity:step
  outboxAssigneeUserId?: string | null; // link-mode owner override
  manualOverride?: boolean; // transactional one-off after explicit UI warning; never marketing/review
}

export interface ConsentStatus {
  smsStatus: SmsStatus;
  doNotText: boolean;
  doNotContact: boolean;
  canSmsTransactional: boolean;
  canSmsMarketing: boolean;
  canEmail: boolean;
}

export interface RecordConsentInput {
  customerId: string;
  address: string;
  channel: "sms" | "whatsapp" | "email";
  purpose: "transactional" | "marketing";
  action: "grant" | "revoke";
  source:
    | "web_form"
    | "verbal"
    | "sms_keyword"
    | "admin"
    | "import"
    | "portal"
    | "natural_language";
  textShown?: string | null;
  pageUrl?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  actorUserId?: string | null;
  messageId?: string | null;
}

// §5.2 slot props
export type MessageComposerProps = {
  customerId: string;
  jobId?: string;
  leadId?: string;
  defaultChannel?: "sms" | "whatsapp" | "email";
  templateKeys?: string[];
  compact?: boolean;
};
export type JobMessagesPanelProps = { jobId: string };
export type ConsentPanelProps = { customerId: string };
export type OutboxCountBadgeProps = { scope?: "mine" | "all" };

// ------------------------------------------------------------------ B5 internal DTOs
// (UI ↔ actions; not part of the frozen cross-module contract)

/** One outbox card (link-mode send waiting for a person to tap Send). */
export interface OutboxCard {
  id: string;
  customerId: string | null;
  customerName: string;
  jobId: string | null;
  jobNumber: string | null;
  to: string;
  channel: "sms" | "whatsapp";
  body: string;
  templateKey: string;
  templateLabel: string;
  dueAt: string;
  expiresAt: string | null;
  assignedUserId: string | null;
  assignedName: string | null;
  purpose: Purpose;
}

export interface ThreadSummary {
  customerId: string;
  name: string;
  lastBody: string;
  lastAt: string;
  lastDirection: "in" | "out";
  lastChannel: string;
  pending: number;
}

export interface ThreadMessage {
  id: string;
  kind: "message" | "scheduled";
  direction: "in" | "out";
  channel: string;
  body: string;
  subject: string | null;
  status: string;
  at: string;
  sender: string | null;
  templateKey: string | null;
  jobId: string | null;
  jobNumber: string | null;
  error: string | null;
  /** Scheduled sends: whether the viewer may cancel it. */
  cancellable?: boolean;
}

/** Templates offered by the composer. */
export interface ComposerTemplate {
  key: string;
  label: string;
  channels: string[];
  purpose: Purpose;
}

export interface ComposerData {
  customerId: string;
  customerName: string;
  phone: string | null;
  email: string | null;
  smsStatus: SmsStatus;
  doNotText: boolean;
  doNotContact: boolean;
  canSms: boolean;
  canEmail: boolean;
  whatsappEnabled: boolean;
  preferredChannel: "sms" | "whatsapp" | "email";
  templates: ComposerTemplate[];
  /** Per-device sms: separator from Settings ('auto' = by user agent). */
  linkDelimiter: "auto" | "?" | "&" | "?&";
  /** Tech outside the contact window: texting is locked (email still works). */
  textingLocked?: boolean;
}

export type ComposerSendResult = {
  scheduledMessageId: string;
  status: ScheduledStatus;
  channel: MsgChannel;
  to: string | null;
  body: string;
  reason?: string | null;
};
