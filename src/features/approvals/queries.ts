import "server-only";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import { approvals, users } from "@/db/schema";
import { requireAnyPerm } from "@/lib/auth/current";
import type { FeatureFlags } from "@/lib/flags";
import { getFeatureFlags } from "@/lib/settings";
import type { SessionUser } from "@/lib/types";
import type {
  ApprovalEntityType,
  ApprovalKindDef,
  ApprovalRow,
} from "./contracts";
import { enabledApprovalKinds } from "./registry";

export const DECIDE_PERMS = [
  "vehicles.log_approve",
  "parts.approve_reimbursement",
  "jobs.review_cancellations",
  "jobs.approve_start",
  "payroll.manage",
] as const;

/** Kinds the user may decide whose module is switched on. */
export function decidableKinds(
  user: SessionUser,
  flags: Partial<FeatureFlags>,
): ApprovalKindDef[] {
  return enabledApprovalKinds(flags).filter((k) => user.perms.has(k.perm));
}

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

export interface QueueEntry {
  row: ApprovalRow;
  kind: ApprovalKindDef;
  requestedByName: string | null;
  reviewerName: string | null;
}

/** Pending (or recently decided) approvals the viewer may decide, oldest first. */
export const listApprovals = cache(
  async (opts: { kind?: string; scope?: "pending" | "done" } = {}) => {
    const user = await requireAnyPerm([...DECIDE_PERMS]);
    const kinds = decidableKinds(user, await getFeatureFlags());
    const all = kinds.flatMap((k) => k.entityTypes);
    const types = opts.kind ? all.filter((t) => t === opts.kind) : all;
    const counts: Record<string, number> = {};
    if (types.length === 0)
      return { user, kinds, entries: [] as QueueEntry[], counts };
    const pendingRows = await db
      .select({ t: approvals.entityType })
      .from(approvals)
      .where(
        and(
          eq(approvals.status, "pending"),
          inArray(approvals.entityType, all),
        ),
      );
    for (const r of pendingRows) counts[r.t] = (counts[r.t] ?? 0) + 1;
    const done = opts.scope === "done";
    const rows = await db
      .select()
      .from(approvals)
      .where(
        and(
          inArray(approvals.entityType, types),
          done
            ? and(
                inArray(approvals.status, ["approved", "rejected"]),
                gte(
                  approvals.decidedAt,
                  new Date(Date.now() - 14 * 86_400_000),
                ),
              )
            : eq(approvals.status, "pending"),
        ),
      )
      .orderBy(done ? desc(approvals.decidedAt) : approvals.createdAt)
      .limit(done ? 50 : 100);
    const ids = [
      ...new Set(
        rows
          .flatMap((r) => [r.requestedBy, r.reviewerId])
          .filter((x): x is string => !!x),
      ),
    ];
    const names = ids.length
      ? new Map(
          (
            await db
              .select({ id: users.id, name: users.name })
              .from(users)
              .where(inArray(users.id, ids))
          ).map((u) => [u.id, u.name]),
        )
      : new Map<string, string>();
    const entries: QueueEntry[] = [];
    for (const r of rows) {
      const kind = kinds.find((k) =>
        k.entityTypes.includes(r.entityType as ApprovalEntityType),
      );
      if (!kind) continue;
      entries.push({
        row: toRow(r),
        kind,
        requestedByName: r.requestedBy
          ? (names.get(r.requestedBy) ?? null)
          : null,
        reviewerName: r.reviewerId ? (names.get(r.reviewerId) ?? null) : null,
      });
    }
    return { user, kinds, entries, counts };
  },
);
