"use server";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { approvals } from "@/db/schema";
import { action } from "@/lib/action";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import type { FeatureFlags } from "@/lib/flags";
import { decideApproval } from "./api";
import type { ApprovalEntityType, ApprovalRow } from "./contracts";

// Unified approvals queue (BUILD_PLAN §6.10). decideApproval checks the kind's perm,
// updates the row, runs kind.onDecide in the same transaction and audits.

const DECIDE_PERMS = [
  "vehicles.log_approve",
  "parts.approve_reimbursement",
  "jobs.review_cancellations",
  "jobs.approve_start",
  "payroll.manage",
] as const;

const PATHS = [
  "/approvals",
  "/vehicles/approvals",
  "/parts",
  "/pay/settlements",
  "/jobs",
];

export const decide = action({
  anyPerm: DECIDE_PERMS,
  input: z.object({
    approvalId: z.string().uuid(),
    decision: z.enum(["approved", "rejected"]),
    reason: z.string().trim().max(500).nullish(),
    edits: z.record(z.string(), z.unknown()).optional(),
  }),
  async run({ input, tx, actor }) {
    if (input.decision === "rejected" && !input.reason?.trim())
      throw new ValidationError({
        reason: ["Say why, so the person knows what to fix."],
      });
    await decideApproval(
      tx,
      input.approvalId,
      {
        decision: input.decision,
        reason: input.reason ?? null,
        edits: input.edits,
      },
      actor,
    );
    return { ok: true };
  },
  revalidate: () => PATHS,
});

/** "Approve all clean": every pending item of `kind` whose kind.clean() is true. */
export const approveAllClean = action({
  anyPerm: DECIDE_PERMS,
  input: z.object({
    entityType: z.string().optional(),
    ids: z.array(z.string().uuid()).max(200).optional(),
  }),
  async run({ input, user, tx, actor }) {
    const { enabledApprovalKinds } = await import("./registry");
    // Read through tx: PGlite has one connection while the action's tx is open.
    const { settingsOf } = await import("@/features/payroll/server/util");
    const flags = (await settingsOf(tx)).features as Partial<FeatureFlags>;
    const kinds = enabledApprovalKinds(flags).filter(
      (k) =>
        user.perms.has(k.perm) &&
        k.clean &&
        (!input.entityType ||
          k.entityTypes.includes(input.entityType as ApprovalEntityType)),
    );
    if (kinds.length === 0) throw new ForbiddenError();
    const types = kinds.flatMap((k) => k.entityTypes);
    const rows = await tx
      .select()
      .from(approvals)
      .where(
        and(
          eq(approvals.status, "pending"),
          inArray(approvals.entityType, types),
          input.ids?.length ? inArray(approvals.id, input.ids) : undefined,
        ),
      )
      .limit(200);
    let n = 0;
    for (const r of rows) {
      const kind = kinds.find((k) =>
        k.entityTypes.includes(r.entityType as ApprovalEntityType),
      );
      const row: ApprovalRow = {
        id: r.id,
        entityType: r.entityType as ApprovalEntityType,
        entityId: r.entityId,
        policy: r.policy as ApprovalRow["policy"],
        status: "pending",
        requestedBy: r.requestedBy,
        reviewerId: r.reviewerId,
        decidedAt: r.decidedAt,
        reason: r.reason,
        evidence: (r.evidence as Record<string, unknown> | null) ?? null,
        createdAt: r.createdAt,
      };
      if (!kind?.clean?.(row)) continue;
      await decideApproval(
        tx,
        r.id,
        { decision: "approved", reason: "Approved with all clean items" },
        actor,
      );
      n++;
    }
    return { approved: n };
  },
  revalidate: () => PATHS,
});
