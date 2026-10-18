// Contract types for B1 customers (BUILD_PLAN §5.2, §6.1). Types only — importable from client code.

export type CustomerType =
  | "residential"
  | "commercial"
  | "property_manager"
  | "home_warranty";
export type SmsStatus = "unknown" | "transactional" | "marketing" | "opted_out";

export interface AddressInput {
  street: string;
  unit?: string | null;
  city: string;
  state: string;
  zip: string;
  lat?: number | null;
  lng?: number | null;
  label?: string | null;
}

export interface FindOrCreateCustomerInput {
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  phone?: string | null; // any format → E.164 (region US); invalid → null + warning
  email?: string | null; // lower-cased
  type?: CustomerType;
  address?: AddressInput | null;
  leadSourceId?: string | null;
  source?: string | null;
  firstTouch?: Record<string, unknown> | null;
  isTest?: boolean;
}

export interface FindOrCreateCustomerResult {
  customerId: string;
  created: boolean;
  matchedBy: "phone" | "email" | null;
  propertyId: string | null;
  propertyCreated: boolean;
  warnings: string[];
}

export interface CustomerFlags {
  doNotService: boolean;
  prepayRequired: boolean;
  disputeHistory: boolean;
  vip: boolean;
  taxExempt: boolean;
  doNotText: boolean;
  doNotContact: boolean;
}

export interface CustomerBrief {
  id: string;
  displayName: string;
  firstName: string | null;
  type: CustomerType;
  phone: string | null;
  phoneMasked: string | null;
  email: string | null;
  contactRevealed: boolean;
  preferredChannel: "sms" | "whatsapp" | "email" | "call";
  smsStatus: SmsStatus;
  flags: CustomerFlags;
  balanceCents: number | null;
  tags: { id: string; name: string; color: string }[];
}

export interface PropertyBrief {
  id: string;
  customerId: string;
  label: string | null;
  street: string;
  unit: string | null;
  city: string;
  state: string;
  zip: string;
  addressShort: string;
  lat: number | null;
  lng: number | null;
  timezone: string | null;
  accessNotes: string | null;
  gateCode: string | null; // only when revealed
  pets: string | null;
  siteContactName: string | null;
  siteContactPhone: string | null;
  /**
   * True outside the viewer's contact window (SPEC §4.2): street shows no house
   * number, unit/lat/lng/access notes/gate code are null, site phone is masked.
   */
  masked?: boolean;
}

export type SearchHit = {
  type: "customer" | "job" | "invoice" | "estimate" | "lead";
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

// §5.2 slot props
export type CustomerCardProps = {
  customerId: string;
  jobId?: string;
  variant?: "full" | "compact" | "header";
  showActions?: boolean;
};
export type PropertyCardProps = {
  propertyId: string;
  jobId?: string;
  variant?: "full" | "compact";
};
export type CustomerPickerProps = {
  name?: string; // default 'customer'
  defaultCustomerId?: string;
  defaultPropertyId?: string;
  allowCreate?: boolean;
  requireProperty?: boolean;
  onChange?: (v: { customerId: string; propertyId: string | null }) => void;
};

// ---- B1-internal DTOs (types only; also used by client components) ----

export type CustomerFlagKey = keyof CustomerFlags;

export interface CustomerListItem {
  id: string;
  displayName: string;
  type: CustomerType;
  phoneDisplay: string | null; // formatted or masked
  email: string | null;
  addressShort: string | null;
  flags: CustomerFlags;
  tags: { id: string; name: string; color: string }[];
  createdAt: string;
}

export interface PropertyView {
  id: string;
  label: string | null;
  street: string;
  unit: string | null;
  city: string;
  state: string;
  zip: string;
  addressLine: string;
  lat: number | null;
  lng: number | null;
  geocodeStatus: string;
  accessNotes: string | null;
  hasGateCode: boolean;
  gateCode: string | null; // only for editors
  pets: string | null;
  siteContactName: string | null;
  siteContactPhone: string | null;
  propertyType: string | null;
  isPrimary: boolean;
  custom: Record<string, unknown>;
  /** Address details hidden outside the viewer's contact window (SPEC §4.2). */
  masked?: boolean;
}

export interface CustomerEditable {
  id: string;
  type: CustomerType;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  companyName: string | null;
  phone: string | null; // E.164
  phoneAlt: string | null;
  email: string | null;
  preferredChannel: "sms" | "whatsapp" | "email" | "call";
  language: string;
  notes: string | null;
  custom: Record<string, unknown>;
}

export interface DuplicateCandidate {
  id: string;
  displayName: string;
  phoneDisplay: string | null;
  email: string | null;
  addressShort: string | null;
  reason: "phone" | "email" | "address";
}

export type CallOutcome =
  | "connected"
  | "no_answer"
  | "voicemail"
  | "wrong_number"
  | "busy";

export interface PickerCustomer {
  id: string;
  displayName: string;
  subtitle: string;
  properties: { id: string; label: string | null; addressLine: string }[];
}
