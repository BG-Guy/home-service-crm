import "server-only";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { notifications, users } from "@/db/schema";
import { appUrl } from "@/lib/env";
import type { Perm } from "@/lib/permissions";
import { listUsersWithPerm } from "@/lib/permissions-db";
import { enqueueJob } from "@/lib/queue";
import type { EntityRef } from "@/lib/types";
import { CRITICAL_TYPES, type NotificationPref } from "./catalog";

// Staff delivery (SPEC M22): one notifications row per user (the bell, always), then
// web push and/or email per the user's preference for the type. Provider calls run
// in the `push` / `email` job_queue workers — never inside the caller's transaction.

export interface DeliverInput {
  userIds: string[];
  /** Notification type = staff template key ('staff.new_lead' …). */
  type: string;
  title: string;
  body?: string | null;
  /** App-relative deep link. */
  url?: string | null;
  entity?: EntityRef | null;
  priority?: "low" | "normal" | "high";
  /** Explicit channels (overrides preferences); in-app is always written. */
  channels?: ("in_app" | "push" | "email")[];
}

/** Active users matching any of the selectors. */
export async function resolveUserIds(
  exec: Tx,
  to: { userIds?: string[]; perm?: Perm; role?: string; roles?: string[] },
): Promise<string[]> {
  const ids = new Set(to.userIds ?? []);
  if (to.perm) for (const id of await listUsersWithPerm(to.perm)) ids.add(id);
  const roles = [...(to.roles ?? []), ...(to.role ? [to.role] : [])];
  if (roles.length) {
    const rows = await exec
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.role, roles), eq(users.status, "active")));
    for (const r of rows) ids.add(r.id);
  }
  if (ids.size === 0) return [];
  const active = await exec
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, [...ids]), eq(users.status, "active")));
  return active.map((r) => r.id);
}

export function prefFor(
  prefs: Record<string, NotificationPref> | null | undefined,
  type: string,
): NotificationPref {
  const p = prefs?.[type];
  return p === "email" || p === "off" || p === "push" ? p : "push";
}

/** Write notification rows and queue push/email deliveries. Returns rows written. */
export async function deliverToUsers(tx: Tx, i: DeliverInput): Promise<number> {
  const ids = [...new Set(i.userIds)];
  if (ids.length === 0) return 0;
  const people = await tx
    .select({
      id: users.id,
      email: users.email,
      prefs: users.notificationPrefs,
      status: users.status,
    })
    .from(users)
    .where(inArray(users.id, ids));
  const active = people.filter((p) => p.status === "active");
  if (active.length === 0) return 0;
  const rows = await tx
    .insert(notifications)
    .values(
      active.map((u) => ({
        userId: u.id,
        type: i.type,
        title: i.title.slice(0, 200),
        body: i.body?.slice(0, 1000) ?? null,
        url: i.url ?? null,
        entityType: i.entity?.type ?? null,
        entityId: i.entity?.id ?? null,
        priority: i.priority ?? "normal",
      })),
    )
    .returning({ id: notifications.id, userId: notifications.userId });
  const critical = CRITICAL_TYPES.includes(i.type);
  for (const r of rows) {
    const u = active.find((a) => a.id === r.userId);
    if (!u) continue;
    const pref = prefFor(u.prefs, i.type);
    const wantPush = i.channels ? i.channels.includes("push") : pref === "push";
    const wantEmail = i.channels
      ? i.channels.includes("email")
      : pref === "email";
    const emailPayload = {
      to: u.email,
      subject: i.title,
      text: `${i.body ?? ""}${i.url ? `\n\nOpen: ${appUrl(i.url)}` : ""}`.trim(),
      kind: "staff",
    };
    if (wantPush)
      await enqueueJob(
        tx,
        "push",
        {
          userId: u.id,
          notificationId: r.id,
          title: i.title,
          body: i.body ?? "",
          url: i.url ?? "/notifications",
          tag: i.type,
          // SPEC M22: critical types fall back to email when push is unavailable.
          emailFallback: critical && !wantEmail ? emailPayload : null,
        },
        { dedupeKey: `push:${r.id}` },
      );
    if (wantEmail && u.email)
      await enqueueJob(tx, "email", emailPayload, {
        dedupeKey: `email:${r.id}`,
      });
  }
  return rows.length;
}

/** Unread count for the bell and the push badge. */
export async function unreadCount(userId: string): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return Number(r?.n ?? 0);
}
