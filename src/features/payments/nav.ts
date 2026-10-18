// Nav items for module `payments` (SPEC §13; BUILD_PLAN §3.3). Owner: B4.
// The owner may edit labels/order; keep keys and perms consistent with permissions.ts.
import type { NavItem } from "@/features/registry";

export const nav: readonly NavItem[] = [
  {
    key: "payments",
    href: "/payments",
    label: "Payments",
    icon: "payments",
    perm: "payments.view_all",
    tabPriority: { admin: 4 },
    byRole: { admin: { label: "Money", icon: "money" } },
    section: "money",
    order: 1,
    more: "work",
    moreOrder: 4,
  },
  {
    key: "settings.payments",
    href: "/settings/payments",
    label: "Payments",
    icon: "payments",
    perm: "settings.manage",
    section: "settings",
    settingsGroup: "money",
    description: "Methods, fees, tips, keyed cards and refund limits",
  },
  {
    key: "settings.deposits",
    href: "/settings/deposits",
    label: "Deposits",
    icon: "cash",
    perm: "settings.manage",
    section: "settings",
    settingsGroup: "money",
    flag: "deposits",
    description: "Deposit rules and policies",
  },
];
