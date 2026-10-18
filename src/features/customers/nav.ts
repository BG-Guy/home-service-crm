// Nav items for module `customers` (SPEC §13; BUILD_PLAN §3.3). Owner: B1.
// The owner may edit labels/order; keep keys and perms consistent with permissions.ts.
import type { NavItem } from "@/features/registry";

export const nav: readonly NavItem[] = [
  {
    key: "customers",
    href: "/customers",
    label: "Customers",
    icon: "customers",
    perm: "customers.view",
    tabPriority: { office: 4, admin: 3 },
    section: "customers",
    order: 1,
  },
];
