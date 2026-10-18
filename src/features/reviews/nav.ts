// Nav items for module `reviews` (SPEC §13; BUILD_PLAN §3.3). Owner: B5.
// The owner may edit labels/order; keep keys and perms consistent with permissions.ts.
import type { NavItem } from "@/features/registry";

export const nav: readonly NavItem[] = [
  {
    key: "reviews",
    href: "/reviews",
    label: "Reviews",
    icon: "reviews",
    perm: "reviews.view",
    flag: "reviews",
    section: "customers",
    order: 3,
    more: "work",
    moreOrder: 6,
  },
  {
    key: "settings.reviews",
    href: "/settings/reviews",
    label: "Reviews",
    icon: "reviews",
    perm: "settings.manage",
    section: "settings",
    settingsGroup: "communication",
    flag: "reviews",
    description: "Google review link and timing",
  },
];
