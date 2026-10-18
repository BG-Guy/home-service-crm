import "server-only";
import { and, count, eq } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { tasks } from "@/db/schema";

// Server API other modules may call (BUILD_PLAN §6.0):
//  - `import "server-only"` and NEVER 'use server' (these skip permission checks).
//  - Take `tx` first (so callers compose them into their own transaction) and the
//    Actor last when the function writes.
//  - Signatures are frozen once another module depends on them.

/** Open example items assigned to a user. */
export async function countOpenExampleItems(
  tx: Tx,
  userId: string,
): Promise<number> {
  const exec = tx ?? db;
  const [row] = await exec
    .select({ n: count() })
    .from(tasks)
    .where(
      and(
        eq(tasks.kind, "custom"),
        eq(tasks.status, "open"),
        eq(tasks.assigneeUserId, userId),
      ),
    );
  return Number(row?.n ?? 0);
}
