// Nav items for module `data` (SPEC §13; BUILD_PLAN §3.3). Owner: B1.
// The owner may edit labels/order; keep keys and perms consistent with permissions.ts.
import type { NavItem } from "@/features/registry";

export const nav: readonly NavItem[] = [
  {
    key: "settings.data",
    href: "/settings/data",
    label: "Data",
    icon: "data",
    perm: ["data.export", "data.import"],
    section: "settings",
    settingsGroup: "system",
    description: "Export, import, backups and demo reset",
    more: "admin",
    moreOrder: 3,
  },
];
