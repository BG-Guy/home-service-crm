import "server-only";
import { and, desc, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { toolAudits } from "@/db/schema";
import { getCompanyTimezone } from "@/lib/settings";
import { dateKey } from "@/lib/time";
import type { ToolAuditStatus } from "./contracts";

// B7 tools API (BUILD_PLAN §6.7). No permission checks (callers already did).

export type * from "./contracts";

/** Next open tool check + last submission per user (B8 team list). */
export async function getToolAuditStatuses(
  userIds: string[],
): Promise<Record<string, ToolAuditStatus>> {
  const out: Record<string, ToolAuditStatus> = {};
  for (const id of userIds)
    out[id] = { nextDueOn: null, overdue: false, lastSubmittedAt: null };
  if (userIds.length === 0) return out;
  const [open, submitted, tz] = await Promise.all([
    db
      .select({ userId: toolAudits.userId, dueOn: toolAudits.dueOn })
      .from(toolAudits)
      .where(
        and(
          inArray(toolAudits.userId, userIds),
          inArray(toolAudits.status, ["scheduled", "in_progress"]),
        ),
      ),
    db
      .select({ userId: toolAudits.userId, at: toolAudits.submittedAt })
      .from(toolAudits)
      .where(
        and(
          inArray(toolAudits.userId, userIds),
          isNotNull(toolAudits.submittedAt),
        ),
      )
      .orderBy(desc(toolAudits.submittedAt)),
    getCompanyTimezone(),
  ]);
  const today = dateKey(new Date(), tz);
  for (const r of open) {
    const s = out[r.userId];
    if (s && (!s.nextDueOn || r.dueOn < s.nextDueOn)) s.nextDueOn = r.dueOn;
  }
  for (const r of submitted) {
    const s = out[r.userId];
    if (s && r.at && !s.lastSubmittedAt) s.lastSubmittedAt = r.at;
  }
  for (const s of Object.values(out))
    s.overdue = !!s.nextDueOn && s.nextDueOn < today;
  return out;
}
