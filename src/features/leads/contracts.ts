// Contract types for B1 leads (BUILD_PLAN §6.1). Types only.

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
}

// ---- B1-internal DTOs (types only; shared with client components) ----

export type LeadStatus =
  | "new"
  | "contacted"
  | "qualified"
  | "booked"
  | "lost"
  | "spam";

export type LeadView = "inbox" | "check" | "booked" | "lost" | "spam" | "all";

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
