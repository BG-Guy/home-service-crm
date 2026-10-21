// Nav items for module `jobs` (SPEC §13; BUILD_PLAN §3.3). Owner: B2.
// The owner may edit labels/order; keep keys and perms consistent with permissions.ts.
import type { NavItem } from "@/features/registry";

export const nav: readonly NavItem[] = [
  {
    key: "schedule",
    href: "/schedule",
    label: "Schedule",
    icon: "schedule",
    perm: "schedule.view_all",
    tabPriority: { office: 2, admin: 2 },
    section: "work",
    order: 1,
  },
  {
    key: "jobs",
    href: "/jobs",
    label: "Jobs",
    icon: "jobs",
    perm: ["jobs.view_all", "jobs.view_own"],
    tabPriority: { tech: 2 },
    byRole: { tech: { href: "/jobs?mine=1" } },
    section: "work",
    order: 3,
  },
  {
    // Assign hub: tech routes on a map + who to send (lead decision, Oct 2026).
    key: "dispatch",
    href: "/dispatch",
    label: "Assign",
    icon: "route",
    perm: "jobs.assign",
    section: "work",
    order: 1.5,
    more: "work",
    moreOrder: 1.5,
  },
  {
    key: "tasks",
    href: "/tasks",
    label: "Tasks",
    icon: "tasks",
    more: "work",
    moreOrder: 8,
    badge: "tasks.due",
    // Desktop sidebar too (SPEC §13.2 Work), after Invoices (QA T3-22).
    section: "work",
    order: 6,
  },
  {
    key: "time",
    href: "/time",
    label: "Time clock",
    icon: "time",
    perm: "time.clock_self",
    more: "team",
    moreOrder: 4,
    // Desktop sidebar: Operations, next to Team (QA T3-22).
    section: "operations",
    order: 2,
  },
  {
    key: "settings.jobs",
    href: "/settings/jobs",
    label: "Jobs & scheduling",
    icon: "jobs",
    perm: "settings.manage",
    section: "settings",
    settingsGroup: "work",
    description: "Arrival windows, confirmations and cancellation policy",
  },
];
