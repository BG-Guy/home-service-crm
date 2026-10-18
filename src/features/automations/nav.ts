// Nav items for module `automations` (SPEC §13; BUILD_PLAN §3.3). Owner: B5.
// The owner may edit labels/order; keep keys and perms consistent with permissions.ts.
import type { NavItem } from "@/features/registry";

export const nav: readonly NavItem[] = [
  {
    key: "settings.automations",
    href: "/settings/automations",
    label: "Automations",
    icon: "timer",
    perm: "automations.manage",
    section: "settings",
    settingsGroup: "communication",
    description: "Built-in and custom automations",
  },
  {
    key: "settings.reminders",
    href: "/settings/reminders",
    label: "Reminders",
    icon: "notifications",
    perm: "reminders.manage",
    section: "settings",
    settingsGroup: "communication",
    description: "Custom recurring reminders",
  },
];
