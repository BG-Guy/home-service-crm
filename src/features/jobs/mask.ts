// Contact-window masking for job views (SPEC §4.2, QA T5-11). Pure; client-safe.
// Outside the viewer's window a tech sees the street name, city and ZIP (enough to
// plan the day) but not the house number, unit, pin or a navigation link. Same
// helper as the customers module ("123 Oak St Apt 4" → "••• Oak St").
import { contactWindow } from "./machine";

/** Alias of `maskStreet` (`@/lib/mask`), kept for the jobs module's call sites. */
export { maskStreet as maskStreetLine } from "@/lib/mask";

/**
 * May this viewer see the job's exact address right now? `customers.contact_view`,
 * or an assignee inside the job's contact window (scheduled start − 2 h, or on the
 * way, until 24 h after completion).
 */
export function revealsJobAddress(
  viewer: { id: string; perms: ReadonlySet<string> } | null | undefined,
  job: {
    status: string;
    scheduledStart: Date | null;
    windowStart: Date | null;
    enRouteAt: Date | null;
    completedAt: Date | null;
  },
  assigneeIds: readonly string[],
  now: Date = new Date(),
): boolean {
  if (!viewer || viewer.perms.has("customers.contact_view")) return true;
  if (!assigneeIds.includes(viewer.id)) return false;
  const w = contactWindow(job);
  return !!w && now >= w.from && now <= w.until;
}
