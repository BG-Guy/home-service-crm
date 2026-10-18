"use server";

import type { ActionResult } from "@/lib/types";
import { listJobs } from "../queries";
import type { JobListFilters, JobListItem } from "../types";

/** Next page for the client "Load more" button (same scope rules as the page). */
export async function fetchJobsPage(
  f: JobListFilters,
): Promise<ActionResult<{ items: JobListItem[]; nextCursor: string | null }>> {
  try {
    const r = await listJobs(f);
    return { ok: true, data: { items: r.items, nextCursor: r.nextCursor } };
  } catch {
    return { ok: false, error: "Couldn't load more jobs." };
  }
}
