// Create buttons (SPEC §13.1; leads flow item 5): New lead, New job and New
// customer as named buttons in every top-level header, the page's own first. A
// page's own create action (New estimate, Upload receipt, New tool, New vehicle)
// lives on that page only and goes in front of the three there. Filtered by
// permission and feature flag on the server. Pure; shared by HeaderActions,
// CreateButtons and tests.
import type { FeatureFlag, FeatureFlags } from "@/lib/flags";
import type { Perm } from "@/lib/permissions";

/** The three create buttons every header shows (when allowed). */
export type HeaderCreateKey = "lead" | "job" | "customer";
/** Create actions that live on their own page only (`HeaderActions own`). */
export type PageCreateKey = "estimate" | "receipt" | "tool" | "vehicle";

export interface CreateItem {
  key: HeaderCreateKey | PageCreateKey;
  label: string;
  href: string;
  icon: string;
  /** Path prefixes where this item comes first (the page's own). */
  contexts: readonly string[];
  /** Pages where it is the main action: the accent pill on wide screens. */
  home: readonly string[];
  /** The page's own create action (set by `createItemsFor(…, own)`). */
  own?: boolean;
}

type Def = Omit<CreateItem, "own"> & { perm: Perm; flag?: FeatureFlag };

// Default order (no page match): the leads flow's order.
const HEADER: readonly Def[] = [
  {
    key: "lead",
    label: "New lead",
    href: "/leads/new",
    icon: "leads",
    perm: "leads.create",
    flag: "leads",
    contexts: ["/leads"],
    home: ["/leads"],
  },
  {
    key: "job",
    label: "New job",
    href: "/jobs/new",
    icon: "jobs",
    perm: "jobs.create",
    contexts: ["/jobs", "/schedule", "/today"],
    // Not on Today: its hero already holds the one primary action.
    home: ["/jobs", "/schedule"],
  },
  {
    key: "customer",
    label: "New customer",
    href: "/customers/new",
    icon: "customer",
    perm: "customers.create",
    contexts: ["/customers"],
    home: ["/customers"],
  },
];

const PAGE: Record<PageCreateKey, Def> = {
  estimate: {
    key: "estimate",
    label: "New estimate",
    href: "/estimates/new",
    icon: "estimates",
    perm: "estimates.create",
    flag: "estimates",
    contexts: ["/estimates"],
    home: ["/estimates"],
  },
  receipt: {
    key: "receipt",
    label: "Upload receipt",
    href: "/parts?new=receipt",
    icon: "invoices",
    perm: "parts.submit_receipt",
    flag: "parts",
    contexts: ["/parts"],
    home: ["/parts"],
  },
  tool: {
    key: "tool",
    label: "New tool",
    href: "/tools?new=tool",
    icon: "tools",
    perm: "tools.view_own",
    flag: "tools",
    contexts: ["/tools"],
    home: ["/tools"],
  },
  vehicle: {
    key: "vehicle",
    label: "New vehicle",
    href: "/vehicles?new=vehicle",
    icon: "vehicles",
    perm: "vehicles.manage",
    flag: "vehicles",
    contexts: ["/vehicles"],
    home: ["/vehicles"],
  },
};

const allowed = (d: Def, perms: ReadonlySet<Perm>, f: Partial<FeatureFlags>) =>
  perms.has(d.perm) && (!d.flag || f[d.flag] !== false);
const strip = ({ perm: _p, flag: _f, ...rest }: Def): CreateItem => rest;

/**
 * The header's create buttons for this viewer: the page's `own` item first (when
 * allowed), then New lead, New job and New customer (when allowed).
 */
export function createItemsFor(
  perms: ReadonlySet<Perm>,
  flags: Partial<FeatureFlags>,
  own?: PageCreateKey,
): CreateItem[] {
  const page = own ? PAGE[own] : undefined;
  return [
    ...(page && allowed(page, perms, flags)
      ? [{ ...strip(page), own: true }]
      : []),
    ...HEADER.filter((d) => allowed(d, perms, flags)).map(strip),
  ];
}

/** Can this viewer use a page's own create action (e.g. to show its trigger)? */
export function canCreate(
  key: PageCreateKey,
  perms: ReadonlySet<Perm>,
  flags: Partial<FeatureFlags>,
): boolean {
  return allowed(PAGE[key], perms, flags);
}

const UUID =
  /^\/customers\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

const under = (pathname: string, prefixes: readonly string[]) =>
  prefixes.some((c) => pathname === c || pathname.startsWith(`${c}/`));

/**
 * Order (and prefill) the buttons for the current page: the page's own item
 * first, else the item whose section this is; on a customer page New job (and
 * New estimate) carry `?customerId=` (Appendix A).
 */
export function contextualize<T extends CreateItem>(
  items: readonly T[],
  pathname: string,
): T[] {
  const customerId = UUID.exec(pathname)?.[1];
  const rank = (i: CreateItem) =>
    i.own ? 2 : under(pathname, i.contexts) ? 1 : 0;
  // Array.prototype.sort is stable: equal ranks keep the default order.
  const sorted = [...items].sort((a, b) => rank(b) - rank(a));
  if (!customerId) return sorted;
  return sorted.map((i) =>
    i.key === "job" || i.key === "estimate"
      ? { ...i, href: `${i.href}?customerId=${customerId}` }
      : i,
  );
}

/**
 * Is this the page's main create action (the accent pill on tablet and desktop)?
 * Only on the item's own list page, so a detail screen keeps its own primary.
 */
export function isPrimaryCreate(item: CreateItem, pathname: string): boolean {
  return item.own === true || item.home.includes(pathname);
}
