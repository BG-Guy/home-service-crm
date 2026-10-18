"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { notifications, users } from "@/db/schema";
import { action } from "@/lib/action";
import { ForbiddenError } from "@/lib/errors";
import { NOTIFICATION_TYPES } from "./catalog";
import { deliverToUsers } from "./deliver";
import { canViewTimeline, fetchActivity, listNotifications } from "./queries";

// Notifications, preferences and timeline paging (SPEC M22).

const Filter = z.enum(["all", "messages", "jobs", "money", "notes"]);
const ENTITY_TYPES = [
  "customer",
  "job",
  "lead",
  "estimate",
  "invoice",
  "vehicle",
  "tool",
  "user",
] as const;

/** Next page / filter change of an S33 timeline (scope re-checked every call). */
export const loadActivity = action({
  name: "activity.load",
  input: z.object({
    customerId: z.string().uuid().optional(),
    jobId: z.string().uuid().optional(),
    entityType: z.enum(ENTITY_TYPES).optional(),
    entityId: z.string().uuid().optional(),
    filter: Filter.default("all"),
    before: z.number().int().positive().nullable().optional(),
    limit: z.number().int().min(5).max(100).optional(),
  }),
  async run({ input, user }) {
    const scope = {
      customerId: input.customerId,
      jobId: input.jobId,
      entity:
        input.entityType && input.entityId
          ? { type: input.entityType, id: input.entityId }
          : undefined,
    };
    if (!(await canViewTimeline(user, scope))) throw new ForbiddenError();
    return fetchActivity(user, scope, input.filter, {
      before: input.before ?? null,
      limit: input.limit,
    });
  },
});

export const markNotificationRead = action({
  name: "notifications.read",
  input: z.object({ id: z.string().uuid() }),
  async run({ input, tx, user }) {
    await tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.id, input.id),
          eq(notifications.userId, user.id),
          isNull(notifications.readAt),
        ),
      );
    return { ok: true };
  },
  revalidate: () => ["/notifications"],
});

export const markAllNotificationsRead = action({
  name: "notifications.read_all",
  input: z.object({}),
  async run({ tx, user }) {
    const rows = await tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(eq(notifications.userId, user.id), isNull(notifications.readAt)),
      )
      .returning({ id: notifications.id });
    return { count: rows.length };
  },
  revalidate: () => ["/notifications"],
});

export const loadMoreNotifications = action({
  name: "notifications.more",
  input: z.object({ before: z.string().datetime() }),
  async run({ input }) {
    return listNotifications({ before: input.before });
  },
});

const PrefValue = z.enum(["push", "email", "off"]);
const KNOWN = NOTIFICATION_TYPES.map((t) => t.key);

/** S35: push / email / off per notification type (users.notification_prefs, B5 column). */
export const saveNotificationPrefs = action({
  name: "notifications.prefs",
  input: z.object({
    userId: z.string().uuid(),
    prefs: z.record(z.string().max(80), PrefValue),
  }),
  audit: "user.notification_prefs",
  async run({ input, tx, user }) {
    if (input.userId !== user.id && !user.perms.has("users.manage"))
      throw new ForbiddenError(undefined, "users.manage");
    const clean = Object.fromEntries(
      Object.entries(input.prefs).filter(([k]) => KNOWN.includes(k)),
    );
    await tx
      .update(users)
      .set({ notificationPrefs: clean, updatedAt: new Date() })
      .where(eq(users.id, input.userId));
    return { saved: Object.keys(clean).length };
  },
  auditEntity: ({ input }) => ({ type: "user", id: input.userId }),
  revalidate: () => ["/settings/profile"],
});

/** "Send a test notification" (profile, push enable button). */
export const sendTestNotification = action({
  name: "notifications.test",
  input: z.object({}),
  async run({ tx, user }) {
    const n = await deliverToUsers(tx, {
      userIds: [user.id],
      type: "staff.generic",
      title: "Test notification",
      body: "Notifications are working on this device.",
      url: "/notifications",
      channels: ["in_app", "push"],
    });
    return { notified: n };
  },
  revalidate: () => ["/notifications"],
});

/** Mark the bell rows for one entity read (opening a deep link). */
export const markEntityNotificationsRead = action({
  name: "notifications.read_entity",
  input: z.object({ ids: z.array(z.string().uuid()).max(100) }),
  async run({ input, tx, user }) {
    if (input.ids.length === 0) return { ok: true };
    await tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, user.id),
          inArray(notifications.id, input.ids),
          isNull(notifications.readAt),
        ),
      );
    return { ok: true };
  },
});

/** Public VAPID key for the push subscribe button (null when push isn't set up). */
export const getPushConfig = action({
  name: "push.config",
  input: z.object({}),
  async run({ user }) {
    const { vapidPublicKey } = await import("@/adapters/push");
    return {
      vapidPublicKey: vapidPublicKey(),
      // Setup hints (keys, Settings → Integrations) are for whoever can act on them.
      canSetUp: user.perms.has("settings.manage"),
    };
  },
});
