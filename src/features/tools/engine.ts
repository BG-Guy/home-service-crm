import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  toolAssignments,
  toolAuditItems,
  toolAudits,
  tools,
  users,
} from "@/db/schema";
import { notify } from "@/features/notify/api";
import { writeActivity } from "@/lib/activity";
import { NotFoundError } from "@/lib/errors";
import { emit } from "@/lib/events";
import type { Actor } from "@/lib/types";

// Tools engine (SPEC M18): shared by actions, cron and the seed. Everything takes
// the caller's `tx`; nothing here opens a transaction or calls a provider.

export type ToolRow = typeof tools.$inferSelect;

export async function loadTool(exec: Tx, id: string): Promise<ToolRow> {
  const [t] = await exec
    .select()
    .from(tools)
    .where(and(eq(tools.id, id), isNull(tools.deletedAt)))
    .limit(1);
  if (!t) throw new NotFoundError("Tool");
  return t;
}

/** Tools currently in a user's custody (assigned to them), excluding lost/stolen/retired. */
export async function toolsInCustody(exec: Tx, userId: string) {
  return exec
    .select({ id: tools.id, name: tools.name })
    .from(tools)
    .where(
      and(
        eq(tools.currentUserId, userId),
        isNull(tools.deletedAt),
        inArray(tools.status, ["assigned", "available", "in_repair"]),
      ),
    );
}

/** Open (scheduled / in progress) audit of a user, if any. */
export async function openAuditFor(exec: Tx, userId: string) {
  const [a] = await exec
    .select()
    .from(toolAudits)
    .where(
      and(
        eq(toolAudits.userId, userId),
        inArray(toolAudits.status, ["scheduled", "in_progress"]),
      ),
    )
    .limit(1);
  return a ?? null;
}

/**
 * Schedule an audit with one checklist item per tool in custody, emit
 * `tool.audit_due` and notify the tech. Returns null when the tech holds no tools
 * or already has an open audit (idempotent for the cron).
 */
export async function scheduleAuditFor(
  tx: Tx,
  userId: string,
  dueOn: string,
  actor: Actor,
  opts: { emitEvent?: boolean; id?: string } = {},
): Promise<string | null> {
  if (await openAuditFor(tx, userId)) return null;
  const held = await toolsInCustody(tx, userId);
  if (held.length === 0) return null;
  const [a] = await tx
    .insert(toolAudits)
    .values({
      ...(opts.id ? { id: opts.id } : {}),
      userId,
      dueOn,
      status: "scheduled",
    })
    .returning({ id: toolAudits.id });
  if (!a) throw new Error("audit insert failed");
  await tx
    .insert(toolAuditItems)
    .values(held.map((t) => ({ auditId: a.id, toolId: t.id })));
  if (opts.emitEvent !== false) {
    const entity = { type: "user" as const, id: userId };
    await emit(
      tx,
      "tool.audit_due",
      entity,
      { audit_id: a.id, user_id: userId },
      { actor },
    );
    await writeActivity(tx, {
      entity,
      kind: "tool.audit_due",
      summary: `Tool check scheduled (${held.length} tool${held.length === 1 ? "" : "s"}), due ${dueOn}`,
      data: { audit_id: a.id },
      actorUserId: actor.userId,
    });
    await notify(tx, {
      to: { userIds: [userId] },
      type: "staff.generic",
      title: "Tool check due",
      body: `Snap a photo of each of your ${held.length} tools by ${dueOn}.`,
      url: `/tools/audits/${a.id}`,
      entity,
    });
  }
  return a.id;
}

/** Close the open assignment of a tool (check-in), if any. */
export async function closeOpenAssignment(
  tx: Tx,
  toolId: string,
  i: { condition: string | null; mediaId: string | null },
): Promise<void> {
  await tx
    .update(toolAssignments)
    .set({
      checkedInAt: new Date(),
      inCondition: i.condition,
      inMediaId: i.mediaId,
    })
    .where(
      and(
        eq(toolAssignments.toolId, toolId),
        isNull(toolAssignments.checkedInAt),
      ),
    );
}

/** Active users who use company tools (audit cron). */
export async function toolUsers(exec: Tx) {
  return exec
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.status, "active"), eq(users.usesCompanyTools, true)));
}

export function toolEntity(id: string) {
  return { type: "tool" as const, id };
}
