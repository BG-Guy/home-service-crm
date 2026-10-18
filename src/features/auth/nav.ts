// Nav items for module `auth` (SPEC §13; BUILD_PLAN §3.3). Owner: F.
// The owner may edit labels/order; keep keys and perms consistent with permissions.ts.
import type { NavItem } from "@/features/registry";

export const nav: readonly NavItem[] = [
  {
    key: "account.install",
    href: "/more?install=1",
    label: "Install app",
    icon: "install",
    more: "account",
    moreOrder: 4,
    action: "install",
  },
  {
    key: "account.signout",
    href: "/api/auth/logout",
    label: "Sign out",
    icon: "signout",
    more: "account",
    moreOrder: 5,
    action: "signout",
  },
];
