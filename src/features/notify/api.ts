import "server-only";
import { eq } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import type { NotifyInput } from "./contracts";
import { deliverToUsers, resolveUserIds } from "./deliver";

// B5 notify API (BUILD_PLAN §6.5). Direct staff alerts; automations use the same
// delivery path through enqueueMessage (audience user).

export type * from "./contracts";

/**
 * Direct staff alert: a notifications row (bell) per recipient, plus push / email per
 * each user's preference for `type` (critical types fall back to email when push is
 * unavailable). Use ONLY for alerts without a §7.3 automation (e.g. lead.touched →
 * assignee, remittance request). `tx` null ⇒ own short transaction. Provider calls run
 * later in the push/email queue workers.
 */
export async function notify(
  tx: Tx | null,
  input: NotifyInput,
): Promise<{ notified: number }> {
  const run = async (t: Tx) => {
    const userIds = await resolveUserIds(t, input.to);
    const notified = await deliverToUsers(t, {
      userIds,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      url: input.url ?? null,
      entity: input.entity ?? null,
      priority: input.priority ?? "normal",
      channels: input.channels,
    });
    return { notified };
  };
  return tx ? run(tx) : db.transaction((t) => run(t));
}

/** Remove every push subscription of a user (deactivation). */
export async function deletePushSubscriptions(
  tx: Tx,
  userId: string,
): Promise<number> {
  const rows = await tx
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .returning({ id: pushSubscriptions.id });
  return rows.length;
}
