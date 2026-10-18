import "server-only";
import { and, count, eq, inArray } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { approvals } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import type { Actor, SessionUser } from "@/lib/types";
import type {
  ApprovalDecision,
  ApprovalEntityType,
  ApprovalRow,
} from "./contracts";

// B6 approvals API (BUILD_PLAN §6.6, §6.10): one row per pending entity; decisions run the
// producing kind's onDecide in the same transaction. Kinds live in approval-kinds.tsx files.

export type * from "./contracts";

function toRow(r: typeof approvals.$inferSelect): ApprovalRow {
  return {
    id: r.id,
    entityType: r.entityType as ApprovalEntityType,
    entityId: r.entityId,
    policy: r.policy as ApprovalRow["policy"],
    status: r.status as ApprovalRow["status"],
    requestedBy: r.requestedBy,
    reviewerId: r.reviewerId,
    decidedAt: r.decidedAt,
    reason: r.reason,
    evidence: (r.evidence as Record<string, unknown> | null) ?? null,
    createdAt: r.createdAt,
  };
}

/** One pending row per entity (returns the existing one). Producers emit their own events. */
export async function createApproval(
  tx: Tx,
  input: {
    entityType: ApprovalEntityType;
    entityId: string;
    policy: ApprovalRow["policy"];
    requestedBy: string | null;
    evidence?: Record<string, unknown>;
  },
  _actor: Actor,
): Promise<{ approvalId: string }> {
  const [existing] = await tx
    .select({ id: approvals.id })
    .from(approvals)
    .where(
      and(
        eq(approvals.entityType, input.entityType),
        eq(approvals.entityId, input.entityId),
        eq(approvals.status, "pending"),
      ),
    )
    .limit(1);
  if (existing) return { approvalId: existing.id };
  const [row] = await tx
    .insert(approvals)
    .values({
      entityType: input.entityType,
      entityId: input.entityId,
      policy: input.policy,
      requestedBy: input.requestedBy,
      evidence: input.evidence ?? null,
    })
    .returning({ id: approvals.id });
  if (!row) throw new Error("approval insert failed");
  return { approvalId: row.id };
}

/** Checks the kind's perm (user actors), updates the row, calls kind.onDecide (same tx), audits. */
export async function decideApproval(
  tx: Tx,
  approvalId: string,
  d: ApprovalDecision,
  actor: Actor,
): Promise<void> {
  const [r] = await tx
    .select()
    .from(approvals)
    .where(eq(approvals.id, approvalId))
    .for("update");
  if (!r) throw new NotFoundError("Approval");
  if (r.status !== "pending")
    throw new ConflictError(
      "already_decided",
      "This item was already decided.",
    );
  const row = toRow(r);
  const { getApprovalKind } = await import("./registry");
  const kind = getApprovalKind(row.entityType);
  if (kind && actor.kind === "user" && actor.userId) {
    const { loadPermSubject } = await import("@/lib/permissions-db");
    const { effective } = await import("@/lib/permissions");
    const { users } = await import("@/db/schema");
    const [u] = await tx
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, actor.userId))
      .limit(1);
    if (
      !u ||
      !effective(await loadPermSubject(actor.userId, u.role), kind.perm)
    )
      throw new ForbiddenError(undefined, kind.perm);
  }
  await tx
    .update(approvals)
    .set({
      status: d.decision,
      reviewerId: actor.userId,
      decidedAt: new Date(),
      reason: d.reason ?? null,
    })
    .where(eq(approvals.id, approvalId));
  if (kind) await kind.onDecide(tx, row, d, actor);
  await writeAudit(tx, {
    actor,
    action: `approval.${d.decision}`,
    entity: { type: "approval", id: approvalId },
    before: { status: "pending" },
    after: {
      status: d.decision,
      reason: d.reason ?? null,
      edits: d.edits ?? null,
      entity_type: row.entityType,
      entity_id: row.entityId,
    },
  });
}

/** Latest approval row for an entity (any status). */
export async function getApprovalFor(
  entityType: ApprovalEntityType,
  entityId: string,
): Promise<ApprovalRow | null> {
  const rows = await db
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.entityType, entityType),
        eq(approvals.entityId, entityId),
      ),
    );
  const sorted = rows.sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
  return sorted[0] ? toRow(sorted[0]) : null;
}

/** Pending rows of the kinds the user may decide (nav badge, B8). */
export async function countPendingApprovals(
  user: SessionUser,
): Promise<number> {
  const { enabledApprovalKinds } = await import("./registry");
  const { getFeatureFlags } = await import("@/lib/settings");
  const types = enabledApprovalKinds(await getFeatureFlags())
    .filter((k) => user.perms.has(k.perm))
    .flatMap((k) => k.entityTypes);
  if (types.length === 0) return 0;
  const [r] = await db
    .select({ n: count() })
    .from(approvals)
    .where(
      and(
        eq(approvals.status, "pending"),
        inArray(approvals.entityType, types),
      ),
    );
  return r?.n ?? 0;
}
