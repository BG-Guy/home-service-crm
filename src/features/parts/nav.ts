// Nav items for module `parts` (SPEC §13; BUILD_PLAN §3.3). Owner: B6.
// The owner may edit labels/order; keep keys and perms consistent with permissions.ts.
import type { NavItem } from "@/features/registry";

export const nav: readonly NavItem[] = [
  {
    key: "parts",
    href: "/parts",
    label: "Parts",
    moreLabel: "Parts & Receipts",
    icon: "parts",
    perm: [
      "parts.add_to_job",
      "parts.submit_receipt",
      "parts.approve_reimbursement",
    ],
    flag: "parts",
    section: "operations",
    order: 5,
    more: "fleet",
    moreOrder: 3,
  },
  {
    key: "inventory",
    href: "/inventory",
    label: "Inventory",
    icon: "inventory",
    perm: "inventory.view",
    flag: "inventory",
    section: "operations",
    order: 6,
    more: "fleet",
    moreOrder: 4,
  },
  {
    key: "settings.parts",
    href: "/settings/parts",
    label: "Parts & receipts",
    icon: "parts",
    perm: "settings.manage",
    section: "settings",
    settingsGroup: "money",
    flag: "parts",
    description: "Receipt rules, AI matching and auto-approval",
  },
];
