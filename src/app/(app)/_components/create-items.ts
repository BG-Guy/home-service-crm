// Global "+" menu entries (SPEC §13.1): context-aware create actions, filtered by
// permission and feature flag on the server. Pure; shared by HeaderActions and tests.
import type { FeatureFlag, FeatureFlags } from "@/lib/flags";
import type { Perm } from "@/lib/permissions";

export interface CreateItem {
  key:
    | "job"
    | "lead"
    | "customer"
    | "estimate"
    | "receipt"
    | "vehicle"
    | "tool";
  label: string;
  href: string;
  icon: string;
  /** Path prefixes where this item moves to the top of the sheet. */
  contexts: readonly string[];
}

const ALL: (CreateItem & { perm: Perm; flag?: FeatureFlag })[] = [
  {
    key: "job",
    label: "New job",
    href: "/jobs/new",
    icon: "jobs",
    perm: "jobs.create",
    contexts: ["/jobs", "/schedule", "/today"],
  },
  {
    key: "lead",
    label: "New lead",
    href: "/leads/new",
    icon: "leads",
    perm: "leads.create",
    flag: "leads",
    contexts: ["/leads"],
  },
  {
    key: "customer",
    label: "New customer",
    href: "/customers/new",
    icon: "customers",
    perm: "customers.create",
    contexts: ["/customers"],
  },
  {
    key: "estimate",
    label: "New estimate",
    href: "/estimates/new",
    icon: "estimates",
    perm: "estimates.create",
    flag: "estimates",
    contexts: ["/estimates"],
  },
  {
    key: "receipt",
    label: "Upload receipt",
    href: "/parts?new=receipt",
    icon: "parts",
    perm: "parts.submit_receipt",
    flag: "parts",
    contexts: ["/parts", "/pay"],
  },
  {
    key: "vehicle",
    label: "New vehicle",
    href: "/vehicles?new=vehicle",
    icon: "vehicles",
    perm: "vehicles.manage",
    flag: "vehicles",
    contexts: ["/vehicles"],
  },
  {
    key: "tool",
    label: "New tool",
    href: "/tools?new=tool",
    icon: "tools",
    perm: "tools.view_own",
    flag: "tools",
    contexts: ["/tools"],
  },
];

export function createItemsFor(
  perms: ReadonlySet<Perm>,
  flags: Partial<FeatureFlags>,
): CreateItem[] {
  return ALL.filter(
    (i) => perms.has(i.perm) && (!i.flag || flags[i.flag] !== false),
  ).map(({ perm: _p, flag: _f, ...rest }) => rest);
}

const UUID =
  /^\/customers\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

/**
 * Order (and prefill) the menu for the current page: the matching item first, and
 * on a customer page the job/estimate links carry `?customerId=` (Appendix A).
 */
export function contextualize<T extends CreateItem>(
  items: readonly T[],
  pathname: string,
): T[] {
  const customerId = UUID.exec(pathname)?.[1];
  const hit = (i: CreateItem) =>
    i.contexts.some((c) => pathname === c || pathname.startsWith(`${c}/`));
  const sorted = [...items].sort((a, b) => Number(hit(b)) - Number(hit(a)));
  if (!customerId) return sorted;
  return sorted.map((i) =>
    i.key === "job" || i.key === "estimate"
      ? { ...i, href: `${i.href}?customerId=${customerId}` }
      : i,
  );
}
