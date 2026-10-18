// Nav items for module `payroll` (SPEC §13; BUILD_PLAN §3.3). Owner: B6.
// The owner may edit labels/order; keep keys and perms consistent with permissions.ts.
import type { NavItem } from "@/features/registry";

export const nav: readonly NavItem[] = [
  {
    key: "payroll",
    href: "/pay",
    label: "Payroll",
    icon: "payroll",
    perm: "payroll.view_own",
    flag: "payroll",
    tabPriority: { tech: 4 },
    byRole: {
      tech: { label: "Pay", icon: "pay" },
      admin: { href: "/pay/settlements" },
    },
    section: "money",
    order: 3,
    more: "team",
    moreOrder: 3,
  },
  {
    key: "approvals",
    href: "/approvals",
    label: "Approvals",
    icon: "approvals",
    perm: [
      "vehicles.log_approve",
      "parts.approve_reimbursement",
      "jobs.review_cancellations",
      "jobs.approve_start",
      "payroll.manage",
    ],
    section: "operations",
    order: 7,
    more: "work",
    moreOrder: 7,
    badge: "approvals.pending",
  },
  {
    key: "settings.commission",
    href: "/settings/commission",
    label: "Commission & payroll",
    icon: "payroll",
    perm: "comp_plans.manage",
    section: "settings",
    settingsGroup: "team",
    flag: "payroll",
    description: "Plans, assignments, pay periods and payouts",
  },
];
