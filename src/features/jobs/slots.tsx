// B2 server slots (BUILD_PLAN §5.1 S4, S5, S7). Each checks its own permission and
// row scope and returns null when the viewer may not see it.
import "server-only";
import { Briefcase, Plus } from "lucide-react";
import { assertCustomerAccess } from "@/features/customers/api";
import { getCurrentUser } from "@/lib/auth/current";
import { getCompanyTimezone } from "@/lib/settings";
import type { SessionUser } from "@/lib/types";
import { Button } from "@/ui/components/Button";
import { EmptyState } from "@/ui/components/EmptyState";
import { ListSection } from "@/ui/components/List";
import { getJobForUser } from "./api";
import { JobRow } from "./components/JobRow";
import { NotesClient } from "./components/NotesClient";
import type {
  CustomerJobsPanelProps,
  NotesPanelProps,
  ReassignJobsListProps,
} from "./contracts";
import { listCustomerJobs, listNotes, listOpenJobsForUser } from "./queries";
import { AssignJobButton } from "./slots.client";

const canReadJobs = (u: SessionUser) =>
  u.perms.has("jobs.view_all") || u.perms.has("jobs.view_own");

/** S4: upcoming and past jobs for a customer (row-scoped for techs). */
export async function CustomerJobsPanel({
  customerId,
  limit = 5,
}: CustomerJobsPanelProps) {
  const user = await getCurrentUser();
  if (!user || !canReadJobs(user)) return null;
  const [{ upcoming, past }, tz] = await Promise.all([
    listCustomerJobs(customerId, user, limit),
    getCompanyTimezone(),
  ]);
  const canCreate = user.perms.has("jobs.create");
  const newJob = canCreate ? (
    <Button
      href={`/jobs/new?customerId=${customerId}`}
      variant="plain"
      size="sm"
      icon={<Plus size={16} aria-hidden />}
    >
      New job
    </Button>
  ) : null;
  if (upcoming.length === 0 && past.length === 0)
    return (
      <ListSection header="Jobs" trailing={newJob}>
        <EmptyState
          compact
          icon={<Briefcase size={32} />}
          title="No jobs yet"
          message={
            canCreate ? "Book the first visit for this customer." : undefined
          }
        />
      </ListSection>
    );
  return (
    <>
      {upcoming.length > 0 && (
        <ListSection header="Upcoming jobs" trailing={newJob}>
          {upcoming.map((j) => (
            <JobRow key={j.id} job={j} tz={tz} />
          ))}
        </ListSection>
      )}
      {past.length > 0 && (
        <ListSection
          header="Past jobs"
          trailing={upcoming.length === 0 ? newJob : undefined}
          footer={
            past.length >= limit ? (
              <a
                className="text-accent"
                href={`/jobs?q=${encodeURIComponent(past[0]?.customerName ?? "")}`}
              >
                See all jobs
              </a>
            ) : undefined
          }
        >
          {past.map((j) => (
            <JobRow key={j.id} job={j} tz={tz} />
          ))}
        </ListSection>
      )}
    </>
  );
}

async function noteAccess(
  user: SessionUser,
  entity: NotesPanelProps["entity"],
): Promise<{ canEditAll: boolean } | null> {
  if (entity.type === "job") {
    const v = await getJobForUser(entity.id, user);
    return v ? { canEditAll: user.perms.has("jobs.edit") } : null;
  }
  if (entity.type === "customer") {
    if (!user.perms.has("customers.view")) return null;
    try {
      await assertCustomerAccess(user, entity.id, "read");
    } catch {
      return null;
    }
    return { canEditAll: user.perms.has("customers.edit") };
  }
  if (entity.type === "lead") {
    if (!user.perms.has("leads.view")) return null;
    return { canEditAll: user.perms.has("leads.edit") };
  }
  return null;
}

/** S5: notes for a job, customer or lead — pinned first; add works offline. */
export async function NotesPanel({
  entity,
  allowCustomerVisible = false,
}: NotesPanelProps) {
  const user = await getCurrentUser();
  if (!user) return null;
  if (
    entity.type !== "job" &&
    entity.type !== "customer" &&
    entity.type !== "lead"
  )
    return null;
  const access = await noteAccess(user, entity);
  if (!access) return null;
  const notes = await listNotes(entity);
  return (
    <ListSection header="Notes" id="notes">
      <NotesClient
        entity={{ type: entity.type, id: entity.id }}
        notes={notes}
        viewerId={user.id}
        canEditAll={access.canEditAll}
        allowCustomerVisible={allowCustomerVisible}
        renderedAt={Date.now()}
      />
    </ListSection>
  );
}

/** S7: a user's open jobs with an inline reassign (B8 deactivate flow). */
export async function ReassignJobsList({ userId }: ReassignJobsListProps) {
  const user = await getCurrentUser();
  if (!user || !user.perms.has("jobs.assign")) return null;
  const [jobs, tz] = await Promise.all([
    listOpenJobsForUser(userId),
    getCompanyTimezone(),
  ]);
  return (
    <ListSection
      header={`Open jobs (${jobs.length})`}
      footer={
        jobs.length
          ? "Reassign each open job before deactivating. Removed techs get a heads-up text."
          : undefined
      }
    >
      {jobs.length === 0 ? (
        <p className="px-4 py-3 text-subhead text-label-2">
          No open jobs — nothing to reassign.
        </p>
      ) : (
        jobs.map((j) => (
          <div key={j.id} className="list-row flex items-center gap-2 pr-3">
            <div className="min-w-0 flex-1">
              <JobRow job={j} tz={tz} />
            </div>
            <AssignJobButton jobId={j.id} label="Reassign" variant="gray" />
          </div>
        ))
      )}
    </ListSection>
  );
}
