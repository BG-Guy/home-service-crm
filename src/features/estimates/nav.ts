// Nav items for module `estimates` (SPEC §13; BUILD_PLAN §3.3). Owner: B3.
// The owner may edit labels/order; keep keys and perms consistent with permissions.ts.
import type { NavItem } from "@/features/registry";

export const nav: readonly NavItem[] = [
  {
    key: "estimates",
    href: "/estimates",
    label: "Estimates",
    icon: "estimates",
    perm: "estimates.view",
    flag: "estimates",
    section: "work",
    order: 4,
    more: "work",
    moreOrder: 2,
  },
  {
    key: "settings.pricebook",
    href: "/settings/pricebook",
    label: "Price book",
    icon: "parts",
    perm: "pricebook.manage",
    section: "settings",
    settingsGroup: "money",
    description: "Services, parts, fees and the markup matrix",
  },
];
