// AI result handlers for `tools` (BUILD_PLAN §4, §8.3). Owner: B7.
// `tool_label` results are suggestions the add-tool form polls (getToolLabelResult)
// and the tech confirms; nothing is written automatically, so the handler only
// records that a read finished on the tool's timeline when the tool already exists.
import "server-only";
import { eq } from "drizzle-orm";
import type { AiHandler } from "@/adapters/ai/handlers";
import type { AiTaskKind } from "@/adapters/ai/types";
import { db } from "@/db";
import { media, tools } from "@/db/schema";

export const aiHandlers: Partial<Record<AiTaskKind, AiHandler>> = {
  async tool_label(task, output) {
    // The handler gets the task row (no ref): find the tool through its photo.
    const mid = task.mediaIds?.[0];
    if (!mid || !output) return;
    const [m] = await db
      .select({ type: media.entityType, id: media.entityId })
      .from(media)
      .where(eq(media.id, mid))
      .limit(1);
    const id = m?.type === "tool" ? m.id : null;
    if (!id) return;
    // Keep the raw read on the tool (custom._ai_label) for the confirm UI; never
    // overwrite typed values.
    const [t] = await db
      .select({ custom: tools.custom })
      .from(tools)
      .where(eq(tools.id, id))
      .limit(1);
    if (!t) return;
    await db
      .update(tools)
      .set({
        custom: {
          ...((t.custom ?? {}) as Record<string, unknown>),
          _ai_label: output,
        },
      })
      .where(eq(tools.id, id));
  },
};
