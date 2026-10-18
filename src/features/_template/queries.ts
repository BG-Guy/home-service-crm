import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { requireUser } from "@/lib/auth/current";
import type { Perm } from "@/lib/permissions";
import type { ExampleItem } from "./contracts";

// Read DAL (SPEC §3.1, CLAUDE.md hard rules):
//  1. requireUser(perm) FIRST — it redirects signed-out users and throws ForbiddenError.
//  2. Scope rows to what the viewer may see (row scope, e.g. "own" vs "all").
//  3. One query with joins/IN batches (no N+1); every list query has an index (§6).
//  4. React cache() dedupes within a request. No 'use cache' / cache tags in v1
//     (amendment 3) — authenticated pages render dynamically.
//
// This template reads the `tasks` table as a stand-in for "your module's table"
// (src/db/schema/<key>.ts). Reads of any table are allowed; writes only to your own.

const VIEW = "example.view" as Perm; // drop the cast once registered

export const listExampleItems = cache(
  async (opts: { mine?: boolean } = {}): Promise<ExampleItem[]> => {
    const user = await requireUser(VIEW);
    const rows = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        dueAt: tasks.dueAt,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.kind, "custom"),
          eq(tasks.status, "open"),
          opts.mine ? eq(tasks.assigneeUserId, user.id) : undefined,
        ),
      )
      .orderBy(asc(tasks.dueAt))
      .limit(100); // > 100 rows: paginate with a cursor (SPEC §14 rule 8)
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      done: r.status !== "open",
      dueAt: r.dueAt?.toISOString() ?? null,
    }));
  },
);
