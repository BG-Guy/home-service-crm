// Nav items for module `notify` (SPEC §13; BUILD_PLAN §3.3). Owner: B5.
// The owner may edit labels/order; keep keys and perms consistent with permissions.ts.
import type { NavItem } from "@/features/registry";

export const nav: readonly NavItem[] = [
  {
    key: "notifications",
    href: "/notifications",
    label: "Notifications",
    icon: "notifications",
    more: "account",
    moreOrder: 1,
    badge: "notifications.unread",
  },
  {
    key: "settings.audit",
    href: "/settings/audit",
    label: "Audit log",
    icon: "audit",
    perm: "audit.view",
    section: "settings",
    settingsGroup: "system",
    description: "Who changed what, and when",
    more: "admin",
    moreOrder: 2,
  },
];
