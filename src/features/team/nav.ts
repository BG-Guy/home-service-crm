// Nav items for module `team` (SPEC §13; BUILD_PLAN §3.3). Owner: B8.
// The owner may edit labels/order; keep keys and perms consistent with permissions.ts.
import type { NavItem } from "@/features/registry";

export const nav: readonly NavItem[] = [
  {
    key: "team",
    href: "/team",
    label: "Team",
    icon: "team",
    perm: ["users.manage", "users.invite"],
    section: "operations",
    order: 2,
    more: "team",
    moreOrder: 1,
  },
];
