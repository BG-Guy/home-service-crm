// Nav items for module `insights` (SPEC §13; BUILD_PLAN §3.3). Owner: B8.
// The owner may edit labels/order; keep keys and perms consistent with permissions.ts.
import type { NavItem } from "@/features/registry";

export const nav: readonly NavItem[] = [
  {
    key: "insights",
    href: "/insights",
    label: "Insights",
    icon: "insights",
    perm: [
      "insights.view_own",
      "insights.view_ops",
      "insights.view_financials",
      "insights.view_team",
    ],
    tabPriority: { admin: 1 },
    byRole: { admin: { label: "Home", icon: "home" } },
    section: "overview",
    order: 2,
    more: "insights",
    moreOrder: 1,
  },
];
