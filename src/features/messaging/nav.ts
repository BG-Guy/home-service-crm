// Nav items for module `messaging` (SPEC §13; BUILD_PLAN §3.3). Owner: B5.
// The owner may edit labels/order; keep keys and perms consistent with permissions.ts.
import type { NavItem } from "@/features/registry";

export const nav: readonly NavItem[] = [
  {
    key: "messages",
    href: "/messages",
    label: "Messages",
    icon: "messages",
    perm: "messages.send",
    tabPriority: { tech: 3 },
    byRole: {
      tech: { label: "Inbox", href: "/messages/outbox", icon: "inbox" },
    },
    section: "customers",
    order: 2,
    more: "work",
    moreOrder: 5,
    badge: "messages.outbox",
  },
  {
    key: "settings.messaging",
    href: "/settings/messaging",
    label: "Messaging",
    icon: "messages",
    perm: "settings.manage",
    section: "settings",
    settingsGroup: "communication",
    description: "SMS driver, outbox owners, WhatsApp and email",
  },
  {
    key: "settings.templates",
    href: "/settings/templates",
    label: "Templates",
    icon: "threads",
    perm: "templates.manage",
    section: "settings",
    settingsGroup: "communication",
    description: "Message and document templates",
  },
];
