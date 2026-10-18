// Nav items for module `tools` (SPEC §13; BUILD_PLAN §3.3). Owner: B7.
// The owner may edit labels/order; keep keys and perms consistent with permissions.ts.
import type { NavItem } from "@/features/registry";

export const nav: readonly NavItem[] = [
  {
    key: "tools",
    href: "/tools",
    label: "Tools",
    icon: "tools",
    perm: ["tools.view_own", "tools.view_all"],
    flag: "tools",
    section: "operations",
    order: 4,
    more: "fleet",
    moreOrder: 2,
  },
  {
    key: "settings.tools",
    href: "/settings/tools",
    label: "Tools",
    icon: "tools",
    perm: "settings.manage",
    section: "settings",
    settingsGroup: "fleet",
    flag: "tools",
    description: "Audits, maintenance and deductions",
  },
];
