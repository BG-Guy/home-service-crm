import type { NavItem } from "@/features/registry";
import type { Perm } from "@/lib/permissions";

// Nav items (SPEC §13; see NavItem in src/features/registry.ts). One item can feed
// the tab bar (tabPriority per role), the desktop sidebar (section/order), the
// More list (more/moreOrder) and the settings index (section 'settings').
// The `as Perm` casts go away once the module is registered (its keys join Perm).
export const nav: readonly NavItem[] = [
  {
    key: "example",
    href: "/example",
    label: "Examples",
    icon: "clipboard",
    perm: "example.view" as Perm,
    section: "work",
    order: 90,
    more: "work",
    moreOrder: 90,
  },
  {
    key: "settings.example",
    href: "/settings/example",
    label: "Examples",
    icon: "clipboard",
    perm: "example.manage" as Perm,
    section: "settings",
    settingsGroup: "work",
    description: "Reminder timing and default assignee",
  },
];
