// Nav items for module `disputes` (SPEC §13; BUILD_PLAN §3.3). Owner: B4.
// The owner may edit labels/order; keep keys and perms consistent with permissions.ts.
import type { NavItem } from "@/features/registry";

export const nav: readonly NavItem[] = [
  {
    key: "disputes",
    href: "/disputes",
    label: "Disputes",
    icon: "disputes",
    perm: "disputes.view",
    flag: "chargeback_protection",
    section: "money",
    order: 2,
    badge: "disputes.open",
  },
  {
    key: "settings.chargebacks",
    href: "/settings/chargebacks",
    label: "Chargeback protection",
    icon: "security",
    perm: "settings.manage",
    flag: "chargeback_protection",
    section: "settings",
    settingsGroup: "money",
    description: "Risk weights, band controls, readiness and photo evidence",
  },
];
