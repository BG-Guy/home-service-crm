// Demo plan (BUILD_PLAN §10.2): a pure, deterministic data object shared by every demo
// seed fragment so they can reference each other without querying. Dates are relative
// (dayOffset + "HH:MM" in the company zone, resolved with ctx.at()). Plan totals are
// authoritative: invoices store them and payments sum to them.
// Trade- and locale-specific inputs (company, metro, price book, job recipes, fleet,
// tools) come from a trade profile in ./profiles; `buildPlan(profile)` is pure, and
// DEMO is the plan for the profile chosen by DEMO_PROFILE (default "default").
import { lineTotalCents, taxCents } from "@/lib/money";
import { mulberry32, seedId } from "./demo-ids";
import { resolveDemoProfile } from "./profiles";
import type {
  DemoProfile,
  ProfileLineSpec,
  ProfileScenario,
} from "./profiles/types";

/**
 * Today's plan has history up to about this clock time (J69/J72 done and paid by
 * 09:50, J70 in progress and J73 en route from 11:00). `ctx.atPast` shifts those
 * times back when the seed runs earlier in the day.
 */
export const DEMO_TODAY_PAST_UNTIL = "11:30";

export type DemoUserKey = "admin" | "office" | "tech1" | "tech2" | "tech3";
export type TechKey = "tech1" | "tech2" | "tech3";

export interface DemoUser {
  key: DemoUserKey;
  id: string;
  email: string;
  name: string;
  role: "admin" | "office" | "tech";
  phone: string;
  color: string;
  workerType: "w2" | "1099";
  planKey: string | null;
  vehicleKey: string | null;
  /** tech_comp overrides (B6). */
  compOverrides: Record<string, unknown>;
  /** Comp agreement signed (B3 seeds signatures for tech1/tech2). */
  agreementSigned: boolean;
  /** Extra permission overrides (B8). */
  permOverrides: { perm: string; effect: "allow" | "deny" }[];
  bankChangedDaysAgo: number | null;
}

export interface DemoPricebookItem {
  key: string;
  id: string;
  kind: "service" | "labor" | "part" | "material" | "fee";
  sku: string | null;
  name: string;
  category: string;
  unitPriceCents: number;
  unitCostCents: number | null;
  taxable: boolean;
  isSpecialOrder: boolean;
  warrantyDays: number | null;
  manufacturerWarrantyMonths: number | null;
  vendor: string | null;
}

export interface DemoProperty {
  key: string; // 'c<n>-<k>'
  id: string;
  label: string | null;
  street: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
}

export interface DemoCustomer {
  n: number;
  id: string;
  type: "residential" | "commercial" | "property_manager" | "home_warranty";
  firstName: string;
  lastName: string;
  displayName: string;
  companyName: string | null;
  phone: string;
  email: string;
  terms: "due_on_receipt" | "net_30";
  flags: {
    vip: boolean;
    disputeHistory: boolean;
    prepayRequired: boolean;
    doNotText: boolean;
    optedOut: boolean;
    taxExempt: boolean;
  };
  tags: string[];
  sourceKey: string;
  properties: DemoProperty[];
}

export interface DemoLeadSource {
  key: "website" | "google_lsa" | "thumbtack" | "referral" | "phone";
  id: string;
  name: string;
  kind: string;
  integrationKind:
    | "plain_form"
    | "js_snippet"
    | "hosted_form"
    | "json_api"
    | "preset";
  publicKey: string | null;
  costModel: "none" | "per_lead" | "monthly";
  defaultCostCents: number | null;
  monthlySpendCents: number | null;
}

export interface DemoLead {
  n: number;
  id: string;
  sourceKey: DemoLeadSource["key"];
  status: "new" | "contacted" | "qualified" | "booked" | "lost" | "spam";
  customerN: number | null;
  name: string;
  phone: string;
  email: string | null;
  service: string;
  serviceTypeKey: string | null;
  quotedPriceCents: number | null;
  minutesAgo: number;
  lostReason: string | null;
  jobN: number | null;
  spamScore: number;
  isReturning: boolean;
  smsConsent: boolean;
  firstResponseMinutes: number | null;
}

export interface DemoLine {
  pricebookKey: string;
  type: "service" | "labor" | "part" | "material" | "fee" | "discount";
  name: string;
  qty: number;
  unitPriceCents: number;
  unitCostCents: number | null;
  taxable: boolean;
  partSource:
    | "company_stock"
    | "company_po"
    | "company_card"
    | "tech_purchased"
    | null;
  isServiceFee: boolean;
  totalCents: number;
}

export interface DemoTotals {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}

export interface DemoPayment {
  key: string; // 'j<n>-<k>'
  id: string;
  kind: "deposit" | "payment";
  method: "card" | "cash" | "check" | "zelle" | "venmo";
  amountCents: number;
  tipCents: number;
  dayOffset: number;
  hhmm: string;
  collectedBy: TechKey | null;
  providerRef: string | null;
  verified: boolean;
}

export interface DemoJob {
  n: number;
  id: string;
  number: string;
  customerN: number;
  customerId: string;
  propertyKey: string;
  propertyId: string;
  serviceTypeKey: string;
  title: string;
  status:
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
  priority: "normal" | "urgent" | "emergency";
  dayOffset: number | null;
  windowStart: string | null; // HH:MM
  windowMinutes: number;
  tech: TechKey | null;
  helper: TechKey | null;
  lines: DemoLine[];
  totals: DemoTotals;
  invoiced: boolean;
  payments: DemoPayment[];
  paymentStatus:
    | "none"
    | "deposit_paid"
    | "partial"
    | "paid"
    | "refunded"
    | "disputed";
  deposit: {
    amountCents: number;
    status: "required" | "paid" | "applied";
    dayOffset: number;
  } | null;
  estimate: { outcome: "approved" | "sent" | "viewed"; options: 1 | 3 } | null;
  photos: { before: number; after: number; problem: number };
  review: {
    requested: boolean;
    clicked: boolean;
    rating: number | null;
    wantsCallback: boolean;
  } | null;
  cancelReason: string | null;
  cancelledAfterArrival: boolean;
  callbackOf: number | null;
  callbackReason: "workmanship" | "part" | null;
  leadN: number | null;
  recurring: boolean;
  risk: "low" | "medium" | "high" | "critical";
  refund: {
    amountCents: number;
    status: "succeeded" | "scheduled";
    dueInDays: number | null;
  } | null;
  dispute: {
    category: string;
    status: string;
    amountCents: number;
    dueInDays: number;
    readinessAtOpen: number;
  } | null;
  revisedAfterPayment: boolean;
}

export interface DemoStandaloneEstimate {
  key: string;
  id: string;
  customerN: number;
  status: "sent" | "declined" | "expired";
  dayOffset: number;
  lines: DemoLine[];
  totals: DemoTotals;
}

export interface DemoVehicle {
  key: "v1" | "v2" | "v3";
  id: string;
  nickname: string;
  year: number;
  make: string;
  model: string;
  vin: string;
  ownership: "company_owned" | "leased" | "tech_owned";
  assignedTo: TechKey;
  tankGal: number;
  odometer: number;
  avgDailyMiles: number;
}

export interface DemoTool {
  key: string;
  id: string;
  name: string;
  category: string;
  brand: string;
  serial: string;
  costCents: number;
  assignedTo: TechKey | null;
  calibrationDueInDays: number | null;
}

// ------------------------------------------------------------------ builders
// Everything trade- or locale-specific comes from the profile; the shapes below
// (who works when, which jobs carry deposits, refunds, disputes…) are shared.

const ROT: TechKey[] = ["tech1", "tech2", "tech3"];
const WINDOWS = ["08:00", "10:00", "13:00", "15:00"];
const GBB = new Set([3, 12, 21, 30, 39, 48]);
const HELPER_JOBS = new Set([5, 15, 25, 35, 52, 80]);
const DEPOSIT_JOBS = new Set([10, 20, 30, 40, 50]);
const AR_DAYS: Record<number, number> = {
  55: -45,
  56: -38,
  57: -33,
  58: -20,
  59: -12,
  60: -3,
};

const FIRST = [
  "James",
  "Emma",
  "Liam",
  "Olivia",
  "Noah",
  "Ava",
  "Elijah",
  "Sophia",
  "Lucas",
  "Mia",
  "Mason",
  "Isabella",
  "Logan",
  "Amelia",
  "Ethan",
  "Harper",
  "Aiden",
  "Evelyn",
  "Jacob",
  "Abigail",
  "Michael",
  "Ella",
  "Daniel",
  "Grace",
  "Henry",
  "Chloe",
  "Jackson",
  "Lily",
  "Sebastian",
  "Zoey",
  "Jack",
  "Nora",
  "Owen",
  "Riley",
  "Wyatt",
  "Aria",
  "Luke",
  "Layla",
  "Grayson",
  "Hannah",
];
const LAST = [
  "Smith",
  "Johnson",
  "Williams",
  "Brown",
  "Jones",
  "Garcia",
  "Miller",
  "Davis",
  "Rodriguez",
  "Martinez",
  "Hernandez",
  "Lopez",
  "Gonzalez",
  "Wilson",
  "Anderson",
  "Thomas",
  "Taylor",
  "Moore",
  "Jackson",
  "Martin",
  "Lee",
  "Perez",
  "Thompson",
  "White",
  "Harris",
  "Sanchez",
  "Clark",
  "Ramirez",
  "Lewis",
  "Robinson",
  "Walker",
  "Young",
  "Allen",
  "King",
  "Wright",
  "Scott",
  "Torres",
  "Nguyen",
  "Hill",
  "Flores",
];

const SOURCES: DemoLeadSource[] = [
  {
    key: "website",
    id: seedId("lead_source", "website"),
    name: "Website",
    kind: "website",
    integrationKind: "js_snippet",
    publicKey: "pk_demo_website0001",
    costModel: "none",
    defaultCostCents: null,
    monthlySpendCents: 15000,
  },
  {
    key: "google_lsa",
    id: seedId("lead_source", "google_lsa"),
    name: "Google Local Services",
    kind: "google_lsa",
    integrationKind: "preset",
    publicKey: null,
    costModel: "per_lead",
    defaultCostCents: 3500,
    monthlySpendCents: 90000,
  },
  {
    key: "thumbtack",
    id: seedId("lead_source", "thumbtack"),
    name: "Thumbtack",
    kind: "thumbtack",
    integrationKind: "preset",
    publicKey: null,
    costModel: "per_lead",
    defaultCostCents: 2200,
    monthlySpendCents: 45000,
  },
  {
    key: "referral",
    id: seedId("lead_source", "referral"),
    name: "Referral",
    kind: "referral",
    integrationKind: "json_api",
    publicKey: null,
    costModel: "none",
    defaultCostCents: null,
    monthlySpendCents: null,
  },
  {
    key: "phone",
    id: seedId("lead_source", "phone"),
    name: "Phone call",
    kind: "phone",
    integrationKind: "json_api",
    publicKey: null,
    costModel: "none",
    defaultCostCents: null,
    monthlySpendCents: null,
  },
];

/** Plan totals for a set of lines at a tax rate (defaults to the active profile's). */
export function totalsOf(
  lines: DemoLine[],
  taxBps: number = DEMO_PROFILE.company.taxBps,
): DemoTotals {
  let subtotal = 0;
  let disc = 0;
  let tax = 0;
  for (const l of lines) {
    if (l.type === "discount") disc += Math.abs(l.totalCents);
    else subtotal += l.totalCents;
    if (l.taxable && l.type !== "discount")
      tax += taxCents(l.totalCents, taxBps);
  }
  return {
    subtotalCents: subtotal,
    discountCents: disc,
    taxCents: tax,
    totalCents: subtotal - disc + tax,
  };
}

function discount(cents: number): DemoLine {
  return {
    pricebookKey: "discount",
    type: "discount",
    name: "Discount",
    qty: 1,
    unitPriceCents: cents,
    unitCostCents: null,
    taxable: false,
    partSource: null,
    isServiceFee: false,
    totalCents: -cents,
  };
}

function methodFor(n: number): DemoPayment["method"] {
  if (DEPOSIT_JOBS.has(n) || n === 12 || n === 25 || n === 33) return "card";
  // Fixed mix over the remaining 44 paid jobs: card 22, cash 12, check 4, zelle 4, venmo 2.
  const order: DemoPayment["method"][] = [
    "card",
    "cash",
    "card",
    "check",
    "card",
    "cash",
    "zelle",
    "card",
    "cash",
    "venmo",
    "card",
  ];
  return order[n % order.length] as DemoPayment["method"];
}

/** Final payment time: 16:30, or 90 min into an evening (after-hours) window. */
function paymentTime(windowStart: string | null): string {
  if (!windowStart || windowStart <= "15:00") return "16:30";
  const [h = 0, m = 0] = windowStart.split(":").map(Number);
  const t = Math.min(h * 60 + m + 90, 23 * 60 + 50);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

// 7 is coprime with 39, so jobs spread over every customer (13 hit only C1, C14
// and C27: QA T4-10). C20 has no jobs (it maps to C40); J12 stays C7's dispute.
function customerFor(n: number): number {
  if (n === 12) return 7;
  const c = ((n * 7) % 39) + 1;
  return c === 20 ? 40 : c;
}

function blankJob(
  n: number,
  customerN: number,
  customers: DemoCustomer[],
): DemoJob {
  const c = customers[customerN - 1] as DemoCustomer;
  const prop = c.properties[n % c.properties.length] as DemoProperty;
  return {
    n,
    id: seedId("job", n),
    number: `J-${1000 + n}`,
    customerN,
    customerId: c.id,
    propertyKey: prop.key,
    propertyId: prop.id,
    serviceTypeKey: "repair",
    title: "",
    status: "completed",
    priority: "normal",
    dayOffset: null,
    windowStart: null,
    windowMinutes: 120,
    tech: ROT[(n - 1) % 3] as TechKey,
    helper: null,
    lines: [],
    totals: { subtotalCents: 0, discountCents: 0, taxCents: 0, totalCents: 0 },
    invoiced: false,
    payments: [],
    paymentStatus: "none",
    deposit: null,
    estimate: null,
    photos: { before: 0, after: 0, problem: 0 },
    review: null,
    cancelReason: null,
    cancelledAfterArrival: false,
    callbackOf: null,
    callbackReason: null,
    leadN: null,
    recurring: false,
    risk: "low",
    refund: null,
    dispute: null,
    revisedAfterPayment: false,
  };
}

/** Build the whole demo plan for a trade profile. Pure and deterministic. */
export function buildPlan(profile: DemoProfile) {
  const rng = mulberry32(42);
  const pick = <T>(arr: readonly T[]): T =>
    arr[Math.floor(rng() * arr.length)] as T;
  const taxBps = profile.company.taxBps;
  const totals = (lines: DemoLine[]) => totalsOf(lines, taxBps);

  // ---------------------------------------------------------------- users
  const USERS: DemoUser[] = (
    [
      ["admin", "admin", "#007AFF", "1099", null, null],
      ["office", "office", "#AF52DE", "w2", null, null],
      ["tech1", "tech", "#34C759", "1099", "partner_25", "v1"],
      ["tech2", "tech", "#FF9500", "w2", "partner_25", "v2"],
      ["tech3", "tech", "#FF2D55", "1099", "partner_25", "v3"],
    ] as const
  ).map(([key, role, color, workerType, planKey, vehicleKey]) => {
    const u = profile.users[key];
    return {
      key,
      id: seedId("user", key),
      email: u.email,
      name: u.name,
      role,
      phone: u.phone,
      color,
      workerType,
      planKey,
      vehicleKey,
      compOverrides:
        key === "tech1"
          ? { cash_settlement: "net_in_payout" }
          : key === "tech2"
            ? { cash_settlement: "separate_remittance" }
            : key === "tech3"
              ? {
                  tech_keeps_cash: false,
                  by_service_type: {
                    [seedId(
                      "service_type",
                      profile.settings.extraServiceType.key,
                    )]: 5000,
                  },
                }
              : {},
      agreementSigned: key === "tech1" || key === "tech2",
      permOverrides:
        key === "tech1"
          ? [{ perm: "vehicles.log_trusted", effect: "allow" as const }]
          : [],
      bankChangedDaysAgo: key === "tech1" ? 2 : null,
    };
  });

  // ---------------------------------------------------------------- price book
  const pb = (
    key: string,
    kind: DemoPricebookItem["kind"],
    name: string,
    price: number,
    cost: number | null,
    category: string,
    extra: Partial<DemoPricebookItem> = {},
  ): DemoPricebookItem => ({
    key,
    id: seedId("pricebook", key),
    kind,
    sku:
      kind === "part" || kind === "material"
        ? `SKU-${key.toUpperCase().replace(/_/g, "-")}`
        : null,
    name,
    category,
    unitPriceCents: price,
    unitCostCents: cost,
    taxable: kind === "part" || kind === "material",
    isSpecialOrder: false,
    warrantyDays: kind === "service" || kind === "labor" ? 90 : null,
    manufacturerWarrantyMonths: kind === "part" ? 12 : null,
    vendor:
      kind === "part" || kind === "material"
        ? profile.company.supplyVendor
        : null,
    ...extra,
  });
  const PRICEBOOK = profile.pricebook.map((p) =>
    pb(
      p.key,
      p.kind,
      p.name,
      p.price,
      p.cost,
      p.category,
      p.isSpecialOrder ? { isSpecialOrder: true } : {},
    ),
  );
  const PB = new Map(PRICEBOOK.map((p) => [p.key, p]));

  function line(
    key: string,
    qty: number,
    partSource: DemoLine["partSource"] = null,
    overrides: Partial<DemoLine> = {},
  ): DemoLine {
    const p = PB.get(key);
    if (!p)
      throw new Error(
        `demo pricebook item ${key} missing (profile ${profile.key})`,
      );
    const unit = overrides.unitPriceCents ?? p.unitPriceCents;
    const isPart = p.kind === "part" || p.kind === "material";
    return {
      pricebookKey: key,
      type: p.kind,
      name: p.name,
      qty,
      unitPriceCents: unit,
      unitCostCents: p.unitCostCents,
      taxable: p.taxable,
      partSource: isPart ? (partSource ?? "company_stock") : null,
      isServiceFee: key === "service_call",
      totalCents: lineTotalCents(qty, unit),
      ...overrides,
    };
  }
  const specLines = (specs: ProfileLineSpec[]): DemoLine[] =>
    specs.map(([k, q, src]) => line(k, q, src ?? null));

  // ---------------------------------------------------------------- customers
  function property(n: number, k: number, label: string | null): DemoProperty {
    const m = profile.metro;
    // rng order (street number, street, area, lat, lng) is part of the plan.
    const num = 100 + Math.floor(rng() * 8900);
    const streetR = rng();
    const area = pick(m.zips);
    // Streets of the area when the profile lists them, else the metro's.
    const streets = area.streets?.length ? area.streets : m.streets;
    const street = `${num} ${streets[Math.floor(streetR * streets.length)]}`;
    const latR = rng();
    const lngR = rng();
    const centered = area.lat != null && area.lng != null;
    return {
      key: `c${n}-${k}`,
      id: seedId("property", `c${n}-${k}`),
      label,
      street,
      city: area.city ?? m.city,
      state: m.state,
      zip: area.zip,
      lat: centered
        ? Math.round(((area.lat as number) + (latR - 0.5) * m.jitter) * 1e6) /
          1e6
        : Math.round((m.box.lat + latR * m.box.span) * 1e6) / 1e6,
      lng: centered
        ? Math.round(
            ((area.lng as number) +
              ((lngR - 0.5) * m.jitter) /
                Math.cos(((area.lat as number) * Math.PI) / 180)) *
              1e6,
          ) / 1e6
        : Math.round((m.box.lng + lngR * m.box.span) * 1e6) / 1e6,
    };
  }

  function buildCustomers(): DemoCustomer[] {
    const out: DemoCustomer[] = [];
    for (let n = 1; n <= 40; n++) {
      const first = FIRST[n - 1] as string;
      const last = LAST[(n * 7) % 40] as string;
      const type: DemoCustomer["type"] =
        n <= 2
          ? "property_manager"
          : n === 3
            ? "commercial"
            : n === 4
              ? "home_warranty"
              : "residential";
      const companyName = n <= 4 ? (profile.accountNames[n - 1] ?? null) : null;
      const propCount = n <= 3 ? 3 : n === 9 || n === 10 ? 2 : 1;
      const properties = Array.from({ length: propCount }, (_, i) =>
        property(
          n,
          i + 1,
          propCount > 1
            ? n <= 3
              ? `Unit ${i + 1}`
              : i === 0
                ? "Home"
                : "Rental"
            : null,
        ),
      );
      out.push({
        n,
        id: seedId("customer", n),
        type,
        firstName: first,
        lastName: last,
        displayName: companyName ?? `${first} ${last}`,
        companyName,
        phone: profile.metro.customerPhone(n),
        email: `${first.toLowerCase()}.${last.toLowerCase()}${n}@example.com`,
        terms: n <= 3 ? "net_30" : "due_on_receipt",
        flags: {
          vip: n === 6,
          disputeHistory: n === 7,
          prepayRequired: n === 8,
          doNotText: n === 13,
          optedOut: n === 12,
          taxExempt: n === 4,
        },
        tags:
          n === 6
            ? ["VIP"]
            : n === 7
              ? ["Complaint"]
              : n <= 3
                ? ["Commercial"]
                : n === 4
                  ? ["Warranty"]
                  : [],
        sourceKey: (
          ["website", "google_lsa", "thumbtack", "referral", "phone"] as const
        )[n % 5] as string,
        properties,
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- jobs
  const PART_SCENARIOS = profile.partScenarios;
  const LABOR_SCENARIOS = profile.laborScenarios;
  const scenario = (key: string): ProfileScenario => {
    const s =
      PART_SCENARIOS.find((x) => x.key === key) ??
      LABOR_SCENARIOS.find((x) => x.key === key);
    if (!s)
      throw new Error(`demo scenario ${key} missing (profile ${profile.key})`);
    return s;
  };

  function applyScenario(
    j: DemoJob,
    s: ProfileScenario,
    partSource: DemoLine["partSource"],
  ): void {
    j.serviceTypeKey = s.service;
    j.title = s.title;
    j.lines = s.lines.map(([k, q]) => line(k, q, partSource));
    j.totals = totals(j.lines);
    if (s.priority) j.priority = s.priority;
  }

  function buildJobs(customers: DemoCustomer[]): DemoJob[] {
    const jobs: DemoJob[] = [];
    const special = profile.specialJobs;
    for (let n = 1; n <= 90; n++) {
      const j = blankJob(n, customerFor(n), customers);
      if (n <= 60) {
        // Past work: days −60 … −2.
        j.dayOffset = AR_DAYS[n] ?? -60 + Math.floor(((n - 1) * 58) / 59);
        j.windowStart = WINDOWS[n % WINDOWS.length] as string;
        const s =
          n % 3 === 1
            ? (PART_SCENARIOS[n % PART_SCENARIOS.length] as ProfileScenario)
            : n % 6 === 2
              ? (PART_SCENARIOS[
                  (n + 3) % PART_SCENARIOS.length
                ] as ProfileScenario)
              : (LABOR_SCENARIOS[
                  n % LABOR_SCENARIOS.length
                ] as ProfileScenario);
        applyScenario(
          j,
          s,
          n % 3 === 1 ? "company_stock" : n % 6 === 2 ? "tech_purchased" : null,
        );
        if (s.window) j.windowStart = s.window;
        if (n === 12) {
          // The charged-back job is a regular daytime repair whatever recipe it got.
          j.serviceTypeKey = "repair";
          j.priority = "normal";
          j.windowStart = WINDOWS[n % WINDOWS.length] as string;
          j.title = special.dispute.title;
          j.lines = specLines(special.dispute.lines);
          if (special.dispute.discountCents)
            j.lines.push(discount(special.dispute.discountCents));
          j.totals = totals(j.lines);
          j.dispute = {
            category: "product_unacceptable",
            status: "needs_response",
            amountCents: j.totals.totalCents,
            dueInDays: 5,
            readinessAtOpen: 72,
          };
        }
        if (n === 45 || n === 46) {
          j.callbackOf = n === 45 ? 15 : 16;
          j.callbackReason = n === 45 ? "workmanship" : "part";
          j.title = `Callback for J-${1000 + (j.callbackOf as number)}`;
          j.lines = [];
          j.totals = totals([]);
        }
        j.invoiced = true;
        j.estimate =
          n % 3 === 0
            ? {
                outcome: "approved",
                options: GBB.has(n) && (n === 12 || !s.singleOption) ? 3 : 1,
              }
            : null;
        j.photos =
          n % 2 === 0
            ? { before: 2, after: 2, problem: 0 }
            : { before: 0, after: 0, problem: 0 };
        j.review =
          n % 2 === 1 && n <= 59
            ? {
                requested: true,
                clicked: n <= 35,
                rating:
                  n === 1 || n === 3 ? 5 : n === 5 ? 4 : n === 7 ? 2 : null,
                wantsCallback: n === 7,
              }
            : null;
        j.helper = HELPER_JOBS.has(n) ? (ROT[n % 3] as TechKey) : null;
        if (j.helper === j.tech) j.helper = ROT[(n + 1) % 3] as TechKey;
        // Payments
        if (n >= 55 || j.totals.totalCents === 0) {
          j.paymentStatus = j.totals.totalCents === 0 ? "paid" : "none";
        } else {
          const method = methodFor(n);
          let remaining = j.totals.totalCents;
          if (DEPOSIT_JOBS.has(n)) {
            const dep =
              Math.round((j.totals.totalCents * 0.25) / 500) * 500 || 500;
            j.deposit = {
              amountCents: dep,
              status: "applied",
              dayOffset: (j.dayOffset as number) - 3,
            };
            j.payments.push({
              key: `j${n}-dep`,
              id: seedId("payment", `j${n}-dep`),
              kind: "deposit",
              method: "card",
              amountCents: dep,
              tipCents: 0,
              dayOffset: (j.dayOffset as number) - 3,
              hhmm: "11:00",
              collectedBy: null,
              providerRef: `pi_demo_${n}d`,
              verified: true,
            });
            remaining -= dep;
          }
          const tip =
            method === "card" && n % 4 === 0 ? Math.round(remaining * 0.15) : 0;
          j.payments.push({
            key: `j${n}-1`,
            id: seedId("payment", `j${n}-1`),
            kind: "payment",
            method,
            amountCents: remaining,
            tipCents: tip,
            dayOffset: j.dayOffset as number,
            hhmm: paymentTime(j.windowStart),
            collectedBy: method === "card" ? null : (j.tech as TechKey),
            providerRef: method === "card" ? `pi_demo_${n}` : null,
            verified: !(method !== "card" && n >= 48 && n <= 54 && n % 2 === 0),
          });
          j.paymentStatus = n === 12 ? "disputed" : "paid";
        }
        if (n === 25)
          j.refund = {
            amountCents: 5000,
            status: "succeeded",
            dueInDays: null,
          };
        if (n === 33) {
          j.revisedAfterPayment = true;
          j.refund = { amountCents: 2500, status: "scheduled", dueInDays: 2 };
        }
        j.status =
          j.paymentStatus === "paid" &&
          (j.dayOffset as number) <= -14 &&
          n !== 12
            ? "closed"
            : "completed";
        j.risk = n === 12 ? "high" : n % 7 === 0 ? "medium" : "low";
      } else if (n <= 66) {
        const i = n - 61;
        j.status = "cancelled";
        j.dayOffset = [-30, -24, -18, -12, -8, -5][i] as number;
        j.windowStart = "10:00";
        j.cancelReason = [
          "customer_cancelled",
          "customer_no_show",
          "price",
          "duplicate",
          "weather",
          "customer_cancelled",
        ][i] as string;
        applyScenario(
          j,
          LABOR_SCENARIOS[i % LABOR_SCENARIOS.length] as ProfileScenario,
          null,
        );
        if (n === 62) {
          j.lines = [line("cancel_fee", 1)];
          j.totals = totals(j.lines);
          j.invoiced = true;
        } else {
          j.lines = [];
          j.totals = totals([]);
        }
        if (n === 66) {
          j.tech = "tech2";
          j.cancelledAfterArrival = true;
          j.photos = { before: 0, after: 0, problem: 1 };
        }
      } else if (n <= 68) {
        j.status = "on_hold";
        j.dayOffset = n === 67 ? -6 : -3;
        j.windowStart = "09:00";
        if (n === 67) {
          j.title = special.specialOrder.title;
          j.serviceTypeKey = "repair";
          j.lines = specLines(special.specialOrder.lines);
          j.totals = totals(j.lines);
          j.deposit = {
            amountCents: special.specialOrder.depositCents,
            status: "paid",
            dayOffset: -6,
          };
          j.payments.push({
            key: "j67-dep",
            id: seedId("payment", "j67-dep"),
            kind: "deposit",
            method: "card",
            amountCents: special.specialOrder.depositCents,
            tipCents: 0,
            dayOffset: -6,
            hhmm: "12:00",
            collectedBy: null,
            providerRef: "pi_demo_67d",
            verified: true,
          });
          j.paymentStatus = "deposit_paid";
        } else {
          applyScenario(
            j,
            scenario(special.awaitingApproval.scenario),
            "company_stock",
          );
          j.title = special.awaitingApproval.title;
        }
      } else if (n <= 76) {
        j.dayOffset = 0;
        const today: Record<number, [TechKey, DemoJob["status"], string]> = {
          69: ["tech1", "completed", "08:00"],
          70: ["tech1", "in_progress", "11:00"],
          71: ["tech1", "scheduled", "15:00"],
          72: ["tech2", "completed", "08:00"],
          73: ["tech2", "en_route", "11:00"],
          74: ["tech2", "confirmed", "14:00"],
          75: ["tech3", "arrived", "10:00"],
          76: ["tech3", "scheduled", "14:00"],
        };
        const [tech, status, start] = today[n] as [
          TechKey,
          DemoJob["status"],
          string,
        ];
        j.tech = tech;
        j.status = status;
        j.windowStart = start;
        if (n === 69) {
          j.title = special.todayCash.title;
          j.lines = specLines(special.todayCash.lines);
          if (special.todayCash.discountCents)
            j.lines.push(discount(special.todayCash.discountCents));
          j.totals = totals(j.lines);
          j.invoiced = true;
          j.payments.push({
            key: "j69-1",
            id: seedId("payment", "j69-1"),
            kind: "payment",
            method: "cash",
            amountCents: j.totals.totalCents,
            tipCents: 0,
            dayOffset: 0,
            hhmm: "09:40",
            collectedBy: "tech1",
            providerRef: null,
            verified: false,
          });
          j.paymentStatus = "paid";
        } else if (n === 72) {
          applyScenario(
            j,
            scenario(special.todayCard.scenario),
            "company_stock",
          );
          j.invoiced = true;
          j.payments.push({
            key: "j72-1",
            id: seedId("payment", "j72-1"),
            kind: "payment",
            method: "card",
            amountCents: j.totals.totalCents,
            tipCents: 2000,
            dayOffset: 0,
            hhmm: "09:50",
            collectedBy: null,
            providerRef: "pi_demo_72",
            verified: true,
          });
          j.paymentStatus = "paid";
        } else {
          applyScenario(
            j,
            PART_SCENARIOS[n % PART_SCENARIOS.length] as ProfileScenario,
            "company_stock",
          );
        }
        if (n === 76) j.risk = "critical";
        if (n === 70) j.leadN = 5;
      } else if (n <= 87) {
        j.dayOffset = n <= 79 ? 1 : 2 + ((n - 80) % 13);
        j.windowStart = WINDOWS[n % WINDOWS.length] as string;
        j.status =
          n === 77 || n === 78
            ? "scheduled"
            : n % 2 === 0
              ? "confirmed"
              : "scheduled";
        if (n === 79) j.status = "confirmed";
        applyScenario(
          j,
          PART_SCENARIOS[n % PART_SCENARIOS.length] as ProfileScenario,
          "company_stock",
        );
        if (n === 79) j.estimate = { outcome: "sent", options: 3 };
        if (n === 82) j.estimate = { outcome: "viewed", options: 1 };
        if (n === 80)
          j.deposit = { amountCents: 5000, status: "required", dayOffset: -1 };
        if (n === 81) {
          j.recurring = true;
          applyScenario(
            j,
            scenario(special.recurring.scenario),
            "company_stock",
          );
          j.title = special.recurring.title;
        }
        j.helper = HELPER_JOBS.has(n) ? "tech2" : null;
      } else {
        j.status = "unscheduled";
        j.tech = null;
        applyScenario(
          j,
          LABOR_SCENARIOS[n % LABOR_SCENARIOS.length] as ProfileScenario,
          null,
        );
      }
      jobs.push(j);
    }
    // Lead conversions (L1–L8 → J88, J77, J78, J80, J70, J55, J40, J30).
    const conv = [88, 77, 78, 80, 70, 55, 40, 30];
    conv.forEach((jobN, i) => {
      const j = jobs[jobN - 1] as DemoJob;
      j.leadN = i + 1;
    });
    return jobs;
  }

  // ---------------------------------------------------------------- leads
  function buildLeads(customers: DemoCustomer[], jobs: DemoJob[]): DemoLead[] {
    const leads: DemoLead[] = [];
    const conv = [88, 77, 78, 80, 70, 55, 40, 30];
    const services = profile.leadServices;
    for (let n = 1; n <= 25; n++) {
      const jobN = n <= 8 ? (conv[n - 1] as number) : null;
      const job = jobN ? jobs[jobN - 1] : undefined;
      const customerN = job ? job.customerN : n === 14 ? 3 : null;
      const c = customerN ? customers[customerN - 1] : undefined;
      const status: DemoLead["status"] =
        n <= 8
          ? "booked"
          : n <= 14
            ? "new"
            : n <= 18
              ? "contacted"
              : n <= 20
                ? "qualified"
                : n <= 23
                  ? "lost"
                  : n === 24
                    ? "spam"
                    : "lost";
      const minutesAgo =
        n === 9
          ? 2
          : n === 10
            ? 4
            : n === 11
              ? 12
              : n === 12
                ? 40
                : n <= 14
                  ? 90
                  : n <= 8
                    ? 60 * 24 * (n + 2)
                    : 60 * 24 * (n - 10);
      leads.push({
        n,
        id: seedId("lead", n),
        sourceKey: (
          ["website", "google_lsa", "thumbtack", "referral", "phone"] as const
        )[n % 5] as DemoLeadSource["key"],
        status,
        customerN,
        name: c
          ? `${c.firstName} ${c.lastName}`
          : `${FIRST[(n * 3) % 40]} ${LAST[(n * 11) % 40]}`,
        phone: c ? c.phone : profile.metro.leadPhone(n),
        email: c ? c.email : n % 3 === 0 ? null : `lead${n}@example.com`,
        service: services[n % services.length] as string,
        serviceTypeKey: null,
        quotedPriceCents: n % 4 === 0 ? 15000 + n * 500 : null,
        minutesAgo,
        lostReason:
          n === 21
            ? "price"
            : n === 22
              ? "timing"
              : n === 23
                ? "out_of_area"
                : n === 25
                  ? "no_answer"
                  : null,
        jobN,
        spamScore: n === 13 ? 70 : n === 24 ? 95 : 0,
        isReturning: n === 14,
        smsConsent: n % 2 === 0 || n <= 8,
        firstResponseMinutes: status === "new" ? null : 3 + (n % 9),
      });
    }
    return leads;
  }

  // ---------------------------------------------------------------- estimates
  function buildStandaloneEstimates(): DemoStandaloneEstimate[] {
    const mk = (
      key: string,
      customerN: number,
      status: DemoStandaloneEstimate["status"],
      dayOffset: number,
      lines: DemoLine[],
    ) => ({
      key,
      id: seedId("estimate", key),
      customerN,
      status,
      dayOffset,
      lines,
      totals: totals(lines),
    });
    const s = profile.standaloneEstimates;
    return [
      mk("c20-unsold", 20, "sent", -6, specLines(s.unsold)),
      mk("c15-declined", 15, "declined", -20, specLines(s.declinedPrice)),
      mk("c16-declined", 16, "declined", -26, specLines(s.declinedOther)),
      mk("c17-expired", 17, "expired", -45, specLines(s.expired)),
    ];
  }

  // ---------------------------------------------------------------- fleet + tools
  const VEHICLES: DemoVehicle[] = profile.vehicles.map((v, i) => ({
    key: (["v1", "v2", "v3"] as const)[i] as DemoVehicle["key"],
    id: seedId("vehicle", `v${i + 1}`),
    nickname: v.nickname,
    year: v.year,
    make: v.make,
    model: v.model,
    vin: v.vin,
    ownership: i === 2 ? "tech_owned" : "company_owned",
    assignedTo: ROT[i] as TechKey,
    tankGal: v.tankGal,
    odometer: v.odometer,
    avgDailyMiles: v.avgDailyMiles,
  }));

  const TOOLS: DemoTool[] = profile.tools.map(
    ([key, name, category, brand, serial, cost, to, cal]) => ({
      key,
      id: seedId("tool", key),
      name,
      category,
      brand,
      serial,
      costCents: cost,
      assignedTo: to ?? null,
      calibrationDueInDays: cal ?? null,
    }),
  );

  const customers = buildCustomers();
  const jobs = buildJobs(customers);
  const leads = buildLeads(customers, jobs);
  const c = profile.company;
  return {
    company: {
      name: c.name,
      legalName: c.legalName,
      timezone: c.timezone,
      state: c.state,
      phone: c.phone,
      email: c.email,
      website: c.website,
      address: {
        street: c.address.street,
        city: c.address.city,
        state: c.address.state,
        zip: c.address.zip,
        lat: c.address.lat,
        lng: c.address.lng,
      },
      serviceZips: [...c.serviceZips],
      license: {
        state: c.license.state,
        trade: c.license.trade,
        number: c.license.number,
      },
    },
    password: profile.password,
    taxBps,
    users: USERS,
    pendingInvite: {
      name: profile.pendingInvite.name,
      email: profile.pendingInvite.email,
      role: "tech" as const,
      workerType: "1099" as const,
    },
    pricebook: PRICEBOOK,
    customers,
    leadSources: SOURCES,
    leads,
    jobs,
    estimates: buildStandaloneEstimates(),
    vehicles: VEHICLES,
    tools: TOOLS,
  };
}

export type DemoPlan = ReturnType<typeof buildPlan>;

/**
 * The profile this process seeds: DEMO_PROFILE env var (set by `npm run seed:demo --
 * --profile=<key>`), default "default". Read once, at module evaluation, because the
 * fragments import DEMO at module level.
 */
export const DEMO_PROFILE: DemoProfile = resolveDemoProfile(
  process.env.DEMO_PROFILE,
);
export const DEMO: DemoPlan = buildPlan(DEMO_PROFILE);

export const DEMO_TZ = DEMO.company.timezone;
export const DEMO_TAX_BPS = DEMO.taxBps;
export const DEMO_PASSWORD = DEMO.password;

const DEMO_PB = new Map(DEMO.pricebook.map((p) => [p.key, p]));

/** Lookup helpers for fragments. */
export const demoUser = (key: DemoUserKey): DemoUser =>
  DEMO.users.find((u) => u.key === key) as DemoUser;
export const demoJob = (n: number): DemoJob => DEMO.jobs[n - 1] as DemoJob;
export const demoCustomer = (n: number): DemoCustomer =>
  DEMO.customers[n - 1] as DemoCustomer;
export const demoPricebook = (key: string): DemoPricebookItem | undefined =>
  DEMO_PB.get(key);
