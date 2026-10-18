// Nav items for module `vehicles` (SPEC §13; BUILD_PLAN §3.3). Owner: B7.
// The owner may edit labels/order; keep keys and perms consistent with permissions.ts.
import type { NavItem } from "@/features/registry";

export const nav: readonly NavItem[] = [
  {
    key: "vehicles",
    href: "/vehicles",
    label: "Vehicles",
    icon: "vehicles",
    perm: ["vehicles.view_own", "vehicles.view_all"],
    flag: "vehicles",
    section: "operations",
    order: 3,
    more: "fleet",
    moreOrder: 1,
  },
  {
    key: "settings.vehicles",
    href: "/settings/vehicles",
    label: "Vehicles",
    icon: "vehicles",
    perm: "settings.manage",
    section: "settings",
    settingsGroup: "fleet",
    flag: "vehicles",
    description: "Log policies, inspections and reminder seeds",
  },
];
