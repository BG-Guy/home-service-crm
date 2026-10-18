// Nav items for module `map` (SPEC §13; BUILD_PLAN §3.3). Owner: B7.
// The owner may edit labels/order; keep keys and perms consistent with permissions.ts.
import type { NavItem } from "@/features/registry";

export const nav: readonly NavItem[] = [
  {
    key: "map",
    href: "/map",
    label: "Map",
    icon: "map",
    perm: "map.view",
    flag: "map",
    section: "operations",
    order: 1,
    more: "team",
    moreOrder: 2,
  },
  {
    key: "settings.map",
    href: "/settings/map",
    label: "Live map",
    icon: "map",
    perm: "settings.manage",
    section: "settings",
    settingsGroup: "fleet",
    flag: "map",
    description: "Ping interval and breadcrumbs",
  },
];
