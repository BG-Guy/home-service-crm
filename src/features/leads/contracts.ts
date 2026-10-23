// Contract types for B1 leads (BUILD_PLAN §6.1). Types only.

import type { JobKind } from "@/features/jobs/kinds";

export interface LeadPrefill {
  leadId: string;
  customerId: string | null;
  propertyId: string | null;
  serviceTypeId: string | null;
  serviceText: string | null;
  quotedPriceCents: number | null;
  preferredDate: string | null;
  preferredWindow: string | null;
  notes: string | null;
  leadSourceId: string | null;
  /** What the office typed in the caller form (kept on the lead until booking). */
  kind: JobKind | null;
  priority: LeadPriority | null;
  afterHours: boolean;
}

export type LeadPriority = "normal" | "urgent" | "emergency";

// ---- Leads-flow redesign contracts (build SPEC §3.2 and §3.4) ----

/**
 * One lead box (contract 3.4): the inbox grid, the map drawer and the TL;DR of
 * the lead card. Built per viewer (`flags.mine`). Dates are ISO strings.
 */
export interface LeadBoxData {
  id: string;
  /** The person, else the phone, else the email, else "Unknown". */
  name: string;
  /** "Jacob W." for tight boxes. */
  shortName: string;
  initials: string;
  status: LeadStatus;
  /** Job type of the lead's service type (null when it has none). */
  kind: JobKind | null;
  /** The trade job ("Lockout") or what the lead typed. */
  serviceName: string | null;
  /** "6379 Webberville Rd" (+ unit); null when the lead has no street. */
  street: string | null;
  city: string | null;
  zip: string | null;
  /** "(512) 555-0128". */
  phone: string | null;
  /** E.164 for tel:/sms: links. */
  phoneE164: string | null;
  email: string | null;
  customerId: string | null;
  /**
   * Booked: the job's arrival window ("Fri, Oct 23 · 8–10 AM"); open: the day they
   * asked for ("Fri, Oct 23 · morning"). `date` is the YYYY-MM-DD day when known.
   */
  when: {
    kind: "arrival" | "requested";
    label: string;
    /** Tight boxes: "Fri 8–10 AM", "Today", "morning". */
    short: string;
    date: string | null;
  } | null;
  /** SLA clock start (created_at). */
  slaStart: string;
  /** First human response; null while unanswered. */
  respondedAt: string | null;
  /** Source name ("Website", "Google LSA"). */
  source: string | null;
  sourceKind: string | null;
  quoteCents: number | null;
  lostReason: string | null;
  /** The job a booked lead became (`cancelled` decides whether it can reopen). */
  job: {
    id: string;
    number: string | null;
    status: string;
    cancelled: boolean;
  } | null;
  assignedUserId: string | null;
  assignedName: string | null;
  /** Map position through the lead's property (geocoded). */
  lat: number | null;
  lng: number | null;
  spamScore: number;
  flags: {
    /** "Check": spam score over the review line, not yet cleared. */
    check: boolean;
    returning: boolean;
    test: boolean;
    /** ZIP outside the configured service ZIPs. */
    outsideArea: boolean;
    /** Assigned to the viewer. */
    mine: boolean;
    /** New, unanswered and past the reply target. */
    overdue: boolean;
  };
}

/** A lead pin on the map (contract 3.4). */
export interface LeadMapPoint {
  id: string;
  lat: number;
  lng: number;
  initials: string;
  status: LeadStatus;
  /** SLA clock start (created_at). */
  slaStart: string;
  respondedAt: string | null;
  name: string;
  /** Avatar color seed: the customer, else the lead (as the box avatar). */
  seed: string;
}

/** Today's jobs as small markers on the lead map (contract 3.4 `LeadsMap.jobs`). */
export interface LeadMapJob {
  id: string;
  lat: number;
  lng: number;
  label: string;
}

/** The lead card (sheet and /leads/[id]): the box plus the details. */
export interface LeadCardData extends LeadBoxData {
  address: {
    street: string;
    unit: string | null;
    city: string;
    state: string;
    zip: string;
  } | null;
  /** One line: "2210 E 7th St, Austin, TX 78702" (or the raw text the lead typed). */
  addressText: string | null;
  notes: string | null;
  serviceTypeId: string | null;
  sourceId: string | null;
  preferredDate: string | null;
  preferredWindow: string | null;
  priority: LeadPriority | null;
  afterHours: boolean;
  createdAt: string;
  respondedByName: string | null;
  /** The latest contact attempt on this lead. */
  lastContact: {
    channel: "call" | "text" | "email";
    /** Call outcome code ("no_answer"); null for messages. */
    outcome: string | null;
    at: string;
    byName: string | null;
  } | null;
  /** Up to 6 photos (the lead's, or a returning customer's recent job photos). */
  photos: { id: string; url: string; thumbUrl: string }[];
  spamReason: string | null;
  estimate: { id: string; number: string | null } | null;
  smsConsent: boolean;
  /** Closed leads: whether Reopen works now, where it goes, or why not. */
  reopen: { ok: true; to: LeadStatus } | { ok: false; reason: string } | null;
  /** The open status Reopen / Not spam return to. */
  previousStatus: LeadStatus | null;
}

/** An open lead for the same phone (contract 3.2, repeat callers). */
export interface CallerOpenLead {
  id: string;
  service: string | null;
  status: LeadStatus;
  createdAt: string;
  address: string | null;
}

/** `lookupCaller(phone)` (contract 3.2). */
export interface CallerLookup {
  matches: CallerMatch[];
  openLeads: CallerOpenLead[];
}

/** What a status change returns: the lead_events row Undo reverts. */
export interface LeadChangeResult {
  leadId: string;
  status: LeadStatus;
  /** Pass to `undoLeadChange`; null when nothing changed. */
  eventId: string | null;
}

// ---- B1-internal DTOs (types only; shared with client components) ----

export type LeadStatus =
  | "new"
  | "contacted"
  | "qualified"
  | "booked"
  | "lost"
  | "spam";

/**
 * Inbox views: `inbox` = every open lead (new, contacted, qualified) outside
 * "Check"; the status chips; `check` = flagged open leads; `all` = everything
 * but spam.
 */
export type LeadView =
  | "inbox"
  | "new"
  | "contacted"
  | "qualified"
  | "check"
  | "booked"
  | "lost"
  | "spam"
  | "all";

export type IntegrationKind =
  | "plain_form"
  | "js_snippet"
  | "hosted_form"
  | "json_api"
  | "preset";

export interface LeadListItem {
  id: string;
  status: LeadStatus;
  name: string;
  phoneDisplay: string | null;
  hasPhone: boolean;
  email: string | null;
  service: string | null;
  sourceName: string | null;
  sourceKind: string | null;
  quotedPriceCents: number | null;
  preferredDate: string | null;
  preferredWindow: string | null;
  createdAt: string;
  firstResponseAt: string | null;
  spamScore: number;
  flagged: boolean;
  isReturning: boolean;
  isTest: boolean;
  assignedUserId: string | null;
  assignedName: string | null;
  customerId: string | null;
  zip: string | null;
  inServiceArea: boolean | null;
  lostReason: string | null;
  notes: string | null;
}

export interface LeadSourceListItem {
  id: string;
  name: string;
  kind: string;
  integrationKind: IntegrationKind;
  preset: string;
  publicKey: string | null;
  active: boolean;
  leads30d: number;
  booked30d: number;
  lastLeadAt: string | null;
  hasSecret: boolean;
  hasHookSecret: boolean;
}

/** One-time secrets returned by create/rotate actions (never stored in clear). */
export interface IssuedSecrets {
  publicKey?: string | null;
  secretKey?: string | null;
  hookSecret?: string | null;
  hookUrl?: string | null;
  googleKey?: string | null;
}

export interface LeadPreviewResult {
  fields: { label: string; value: string }[];
  errors: Record<string, string[]>;
  warnings: string[];
  missingMappings: string[];
  spamScore: number;
  spamReasons: string[];
  extraKeys: string[];
}

/** A returning caller found by phone (call-to-booking step 1). */
export interface CallerMatch {
  customerId: string;
  name: string;
  /** Jobs on file (cancelled excluded). */
  jobs: number;
  /** Their primary (else first) service address; null without contact_view. */
  address: {
    propertyId: string;
    street: string;
    unit: string | null;
    city: string;
    state: string;
    zip: string;
  } | null;
}
