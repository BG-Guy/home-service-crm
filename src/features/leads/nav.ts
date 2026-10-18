// Nav items for module `leads` (SPEC §13; BUILD_PLAN §3.3). Owner: B1.
// The owner may edit labels/order; keep keys and perms consistent with permissions.ts.
import type { NavItem } from "@/features/registry";

export const nav: readonly NavItem[] = [
  {
    key: "leads",
    href: "/leads",
    label: "Leads",
    icon: "leads",
    perm: "leads.view",
    flag: "leads",
    tabPriority: { office: 3 },
    section: "work",
    order: 2,
    more: "work",
    moreOrder: 1,
    badge: "leads.new",
  },
  {
    key: "settings.lead-sources",
    href: "/settings/lead-sources",
    label: "Lead sources",
    icon: "leads",
    perm: "settings.api_keys",
    section: "settings",
    settingsGroup: "work",
    flag: "leads",
    description: "Website forms, marketplaces and integration snippets",
  },
  {
    key: "settings.api-keys",
    href: "/settings/api-keys",
    label: "API keys",
    icon: "key",
    perm: "settings.api_keys",
    section: "settings",
    settingsGroup: "system",
    description: "Server API keys for Zapier and integrations",
  },
];
