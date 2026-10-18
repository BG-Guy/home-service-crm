import "server-only";
import type { Tx } from "@/db";
import { activity } from "@/db/schema";
import { currentActor } from "./context";
import type { EntityRef } from "./types";

// Human timeline writer (SPEC M22, BUILD_PLAN §7.0 + Appendix C). The EMITTER of an
// event writes the activity row in the same transaction (kind = event type), or a
// '<entity>.<verb>' kind for non-event entries (note.added, call.logged, …).
// Never put PII-sensitive data in `summary`.

export interface ActivityInput {
  entity: EntityRef;
  customerId?: string | null;
  jobId?: string | null;
  /** Event type or '<entity>.<verb>'. */
  kind: string;
  summary: string;
  data?: unknown;
  /** Defaults to the current actor's user id. */
  actorUserId?: string | null;
}

export async function writeActivity(tx: Tx, a: ActivityInput): Promise<void> {
  await tx.insert(activity).values({
    entityType: a.entity.type,
    entityId: a.entity.id,
    customerId:
      a.customerId ?? (a.entity.type === "customer" ? a.entity.id : null),
    jobId: a.jobId ?? (a.entity.type === "job" ? a.entity.id : null),
    kind: a.kind,
    summary: a.summary.slice(0, 500),
    data: a.data === undefined ? null : a.data,
    actorUserId:
      a.actorUserId === undefined
        ? (currentActor()?.userId ?? null)
        : a.actorUserId,
  });
}

/** Timeline filter chips (BUILD_PLAN Appendix C) → kind prefixes. */
export const TIMELINE_FILTERS = {
  messages: ["message.", "consent.", "call.", "review."],
  jobs: ["job.", "estimate.", "change_order.", "lead.", "photo.", "signature."],
  money: [
    "invoice.",
    "payment.",
    "refund.",
    "deposit.",
    "dispute.",
    "efw.",
    "credit_note.",
  ],
  notes: ["note."],
} as const;

/** Kinds hidden from the "All" filter. */
export const TIMELINE_HIDDEN_KINDS = ["customer.viewed"] as const;
