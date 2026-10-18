// Nav items for module `invoices` (SPEC §13; BUILD_PLAN §3.3). Owner: B3.
// The owner may edit labels/order; keep keys and perms consistent with permissions.ts.
import type { NavItem } from "@/features/registry";

export const nav: readonly NavItem[] = [
  {
    key: "invoices",
    href: "/invoices",
    label: "Invoices",
    icon: "invoices",
    perm: "invoices.view",
    section: "work",
    order: 5,
    more: "work",
    moreOrder: 3,
    badge: "invoices.overdue",
  },
  {
    key: "settings.invoices",
    href: "/settings/invoices",
    label: "Invoices & estimates",
    icon: "invoices",
    perm: "settings.manage",
    section: "settings",
    settingsGroup: "money",
    description: "Numbering, terms, policies, photos on invoices",
  },
];
