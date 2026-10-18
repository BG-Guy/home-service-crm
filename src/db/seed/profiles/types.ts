// Trade demo profiles (npm run seed:demo -- --profile=<key>). A profile holds every
// trade- or locale-specific input of the demo seed: the plan (src/db/seed/demo-plan.ts)
// builds customers, jobs, estimates, vehicles and tools from it, and the fragments read
// their copy (notes, checklists, vendors, message text…) from `ctx.profile`.
// Pure data, no imports beyond types: demo-plan and the fragments both load it.
import type { DemoLine, DemoUserKey, TechKey } from "../demo-plan";

/** [pricebook key, qty] — or [key, qty, part source] where a line needs one. */
export type ProfileLineSpec =
  | [string, number]
  | [string, number, NonNullable<DemoLine["partSource"]>];

export interface ProfilePricebookItem {
  key: string;
  kind: "service" | "labor" | "part" | "material" | "fee";
  name: string;
  /** Unit price in cents. */
  price: number;
  /** Unit cost in cents (parts and materials). */
  cost: number | null;
  category: string;
  /** Shown in the picker and on the customer-facing estimate (pricebook fragment). */
  description?: string;
  isSpecialOrder?: boolean;
}

/**
 * A job recipe. The plan picks recipes by job number (see buildJobs), so the order
 * of each list matters: PART_SCENARIOS[0] and [3] land on the past deposit jobs when
 * the list has 10 entries (see docs in the README / CLAUDE.md §5).
 */
export interface ProfileScenario {
  key: string;
  /** Service type key (base types or the profile's extra type). */
  service: string;
  title: string;
  lines: [string, number][];
  /** Job priority (default "normal"). */
  priority?: "normal" | "urgent" | "emergency";
  /** Arrival window start for past jobs, e.g. "19:30" for after-hours work. */
  window?: string;
  /** Never offer Good / Better / Best for this recipe (single-option estimate). */
  singleOption?: boolean;
}

export interface ProfileChecklistItem {
  id: string;
  label: string;
  type: "check" | "text" | "number" | "photo" | "signature" | "select";
  required?: boolean;
  options?: string[];
}

export interface ProfileAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
}

/** Area used for generated customer addresses. */
export interface ProfileZipArea {
  zip: string;
  /** City / suburb name (defaults to the metro city). */
  city?: string;
  /** Area center; when missing the metro `box` is used. */
  lat?: number;
  lng?: number;
  /** Streets in this area (defaults to the metro's list). */
  streets?: string[];
}

export interface ProfileTeamMember {
  hireDate: string;
  licenses?: {
    state: string;
    trade: string;
    number: string;
    expires_on?: string;
  }[];
  /** Service type keys. */
  skills?: string[];
  /** Inclusive numeric ZIP range served. */
  zips?: [number, number];
  home: ProfileAddress;
}

export interface ProfileVehicle {
  nickname: string;
  year: number;
  make: string;
  model: string;
  vin: string;
  tankGal: number;
  odometer: number;
  avgDailyMiles: number;
}

/** [key, name, category, brand, serial, cost cents, holder, calibration due in days] */
export type ProfileToolSpec = [
  string,
  string,
  string,
  string,
  string,
  number,
  TechKey | null,
  number | null,
];

export interface ProfileNote {
  body: string;
  by: "office" | "tech";
  pinned?: boolean;
  customer?: boolean;
}

export interface DemoProfile {
  key: string;
  /** Human label for the CLI ("Locksmith"). */
  label: string;

  // ------------------------------------------------------------ the business
  company: {
    name: string;
    legalName: string;
    phone: string;
    email: string;
    website: string;
    timezone: string;
    state: string;
    address: ProfileAddress;
    serviceZips: string[];
    license: { state: string; trade: string; number: string };
    taxBps: number;
    /** Brand accent (Settings → Branding); null keeps the system blue. */
    accent: string | null;
    emergencyPhone: string;
    googleReviewUrl: string;
    /** Clock-in point for the time fragment. */
    shop: { lat: number; lng: number };
    /** Supplier on part and material price-book items. */
    supplyVendor: string;
  };
  password: string;
  users: Record<DemoUserKey, { name: string; email: string; phone: string }>;
  pendingInvite: { name: string; email: string; phone: string };

  // ------------------------------------------------------------ customers
  metro: {
    city: string;
    state: string;
    streets: string[];
    zips: ProfileZipArea[];
    /** Fallback box for areas without a center: lat/lng of the SW corner + span (degrees). */
    box: { lat: number; lng: number; span: number };
    /** Jitter (degrees, full width) around an area center. */
    jitter: number;
    customerPhone(n: number): string;
    leadPhone(n: number): string;
  };
  /** Company names for C1–C4 (2 property managers, a commercial account, a home warranty). */
  accountNames: [string, string, string, string];

  // ------------------------------------------------------------ plan recipes
  pricebook: ProfilePricebookItem[];
  partScenarios: ProfileScenario[];
  laborScenarios: ProfileScenario[];
  specialJobs: {
    /** J12: C7's charged-back job. */
    dispute: { title: string; lines: ProfileLineSpec[]; discountCents: number };
    /** J67: on hold, waiting on the special-order part (deposit paid). */
    specialOrder: {
      title: string;
      lines: ProfileLineSpec[];
      depositCents: number;
    };
    /** J68: on hold, waiting on the customer (scenario key + title). */
    awaitingApproval: { scenario: string; title: string };
    /** J69: done this morning, paid cash. */
    todayCash: {
      title: string;
      lines: ProfileLineSpec[];
      discountCents: number;
    };
    /** J72: done this morning, paid by card with a tip. */
    todayCard: { scenario: string };
    /** J81: recurring maintenance. */
    recurring: { scenario: string; title: string; everyMonths: number };
  };
  leadServices: string[];
  standaloneEstimates: {
    /** C20, sent and unsold. */
    unsold: ProfileLineSpec[];
    /** C15, declined on price. */
    declinedPrice: ProfileLineSpec[];
    /** C16, declined (went with another company). */
    declinedOther: ProfileLineSpec[];
    /** C17, expired. */
    expired: ProfileLineSpec[];
  };
  vehicles: [ProfileVehicle, ProfileVehicle, ProfileVehicle];
  tools: ProfileToolSpec[];

  // ------------------------------------------------------------ fragment copy
  customers: {
    access: Record<
      string,
      { notes: string; gate?: string; pets?: string; site?: [string, string] }
    >;
    notes: { n: number; body: string; pinned?: boolean }[];
    landingUrl: string;
  };
  settings: {
    /** Extra service type (tech3's comp override pays a special rate on it). */
    extraServiceType: {
      key: string;
      name: string;
      color: string;
      icon: string;
      aliases: string[];
      defaultDurationMin: number;
      defaultPriceCents: number;
      contractKind: string;
      photosRequiredBefore: number;
      photosRequiredAfter: number;
      requiresOwnershipCheck: boolean;
      warrantyDays: number;
      /** Jobs of this type are flagged after-hours. */
      afterHours: boolean;
      checklist: { key: string; name: string; items: ProfileChecklistItem[] };
    };
    taxRateName: string;
    altTaxRate: { key: string; name: string; rateBps: number };
    /** Two property custom fields. */
    propertyFields: {
      key: string;
      label: string;
      type: "select" | "text";
      options?: string[];
      showOnInvoice: boolean;
    }[];
    /** Job tag applied to every 11th job. */
    jobTag: { key: string; name: string; color: string };
  };
  team: {
    members: Record<DemoUserKey, ProfileTeamMember>;
  };
  jobs: {
    holdNotes: { specialOrder: string; awaitingApproval: string };
    cancelNotes: Record<string, string>;
    notes: Record<number, ProfileNote[]>;
    rescheduleNote: string;
    startApprovalNote: string;
    officeTask: { title: string; body: string };
    techTask: { title: string };
  };
  estimates: {
    addons: {
      key: string;
      name: string;
      type: DemoLine["type"];
      cents: number;
      taxable: boolean;
    }[];
    bestUpgrade: {
      name: string;
      pricebookKey: string;
      type: DemoLine["type"];
      cents: number;
    };
  };
  payments: { officeFlagDetail: string };
  reviews: { feedback: Record<number, string> };
  notify: { reminder: { title: string; body(firstName: string): string } };
  leads: {
    addresses: { street: string; city: string; zip: string }[];
    outOfArea: { street: string; city: string; state: string; zip: string };
    campaign: string;
    landingUrl: string;
    pageUrl: string;
  };
  messaging: {
    consentPageUrl: string;
    confirmReply: string;
    replies: string[];
  };
  vehicleShops: {
    /** v1's brake job. */
    brakes: string;
    /** v3's oil change (match the make). */
    dealer: string;
  };
  tooling: {
    kit: { key: string; name: string; tools: string[] };
    /** Tool tech2's last tool check reported missing. */
    missing: { key: string; note: string };
    /** [task, interval days, last done (day offset)] by tool key. */
    maintenance: Record<string, [string, number, number]>;
    /** One logged maintenance (tool key; task and day come from `maintenance`). */
    maintenanceLog: { key: string; note: string };
    categoryColors: Record<string, string>;
  };
  parts: {
    vendors: string[];
    stockItems: string[];
    /** Big-ticket stock (fewer on hand). */
    bigItems: string[];
    /** Three items below par on Van 1 (restock request). */
    lowItems: [string, string, string];
    card: [
      { vendor: string; note: string; total: number },
      { vendor: string; note: string; total: number },
      { vendor: string; note: string; total: number },
    ];
    fuelVendors: [string, string];
    pending: [
      { vendor: string; note: string; total: number },
      { vendor: string; note: string; total: number },
    ];
    rejected: { vendor: string; note: string; total: number };
  };
  payroll: { settlementFlag: string };
}
