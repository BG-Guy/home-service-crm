// Permission keys + default grants for module `messaging` (SPEC §4.2) and its feature flags (SPEC §5).
// Owner: B5. Keys and flag keys are FROZEN (BUILD_PLAN §11.3).
// Grant letters: A = admin, O = office, T = tech (base roles). Client-safe: data only.

export const grants = {
  "messages.send": "AOT", // Send to customers (own jobs if tech)
  "messages.view_all": "AO", // All conversations
  "messages.outbox_all": "AO", // Work everyone's outbox
  "messages.bulk_send": "A", // Bulk/broadcast (requires typed confirm)
  "templates.manage": "AO", // Edit message/doc templates
} as const satisfies Record<
  string,
  "" | "A" | "O" | "T" | "AO" | "AT" | "OT" | "AOT"
>;

export type MessagingPerm = keyof typeof grants;
export const perms = Object.keys(grants) as MessagingPerm[];

export const flags = [] as const;
