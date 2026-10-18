// AI result handlers for `parts` (BUILD_PLAN §4, §8.3). Owner: B6.
// Called by the F AI worker with the validated output (or null when skipped/failed).
// receipt: store the extraction on the purchase, then re-run the auto-approve rules
// (a matching total auto-approves; a mismatch stays in /approvals with both values).
import "server-only";
import { eq } from "drizzle-orm";
import type { AiHandler } from "@/adapters/ai/handlers";
import type { AiTaskKind } from "@/adapters/ai/types";
import { withTx } from "@/db";
import { partPurchases } from "@/db/schema";
import { SYSTEM_ACTOR } from "@/lib/types";
import { routePurchase } from "./server/purchases";

const receipt: AiHandler = async (task, output) => {
  const o = (output ?? null) as {
    vendor?: string | null;
    date?: string | null;
    subtotal_cents?: number | null;
    tax_cents?: number | null;
    total_cents?: number | null;
    lines?: unknown[];
    confidence?: number;
  } | null;
  // Every purchase that used this receipt image (the AI cache is shared).
  await withTx(async (tx) => {
    const mediaId = task.mediaIds[0];
    if (!mediaId) return;
    const rows = await tx
      .select({ id: partPurchases.id, status: partPurchases.status })
      .from(partPurchases)
      .where(eq(partPurchases.receiptMediaId, mediaId));
    for (const p of rows) {
      await tx
        .update(partPurchases)
        .set({
          aiExtract: o
            ? {
                vendor: o.vendor ?? null,
                date: o.date ?? null,
                subtotal_cents: o.subtotal_cents ?? null,
                tax_cents: o.tax_cents ?? null,
                total_cents: o.total_cents ?? null,
                lines: o.lines ?? [],
                confidence: o.confidence ?? null,
              }
            : null,
          aiStatus: o ? "done" : "failed",
          updatedAt: new Date(),
        })
        .where(eq(partPurchases.id, p.id));
      if (p.status === "pending") await routePurchase(tx, p.id, SYSTEM_ACTOR);
    }
  });
};

export const aiHandlers: Partial<Record<AiTaskKind, AiHandler>> = { receipt };
