// Nav items for module `tech` (SPEC §13; BUILD_PLAN §3.3). Owner: B2.
// The owner may edit labels/order; keep keys and perms consistent with permissions.ts.
import type { NavItem } from "@/features/registry";

export const nav: readonly NavItem[] = [
  {
    key: "today",
    href: "/today",
    label: "Today",
    icon: "today",
    tabPriority: { tech: 1, office: 1 },
    section: "overview",
    order: 1,
  },
];
