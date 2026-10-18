// Client-safe pieces of the automation engine (editor + engine share them). Pure.

export type CancelScope = "entity" | "customer" | "subject_user" | "actor_user";
export interface CancelRule {
  event: string;
  when?: unknown;
  scope?: CancelScope;
}

/** cancel_on entries: "event" or { event, when?, scope? }. Unknown shapes are ignored. */
export function normalizeCancelOn(v: unknown): CancelRule[] {
  if (!Array.isArray(v)) return [];
  const out: CancelRule[] = [];
  for (const item of v) {
    if (typeof item === "string" && item.trim())
      out.push({ event: item.trim() });
    else if (
      item &&
      typeof item === "object" &&
      typeof (item as CancelRule).event === "string"
    ) {
      const r = item as CancelRule;
      out.push({ event: r.event, when: r.when, scope: r.scope });
    }
  }
  return out;
}
