import type { Metadata } from "next";
import { HeaderActions } from "@/app/(app)/_components/HeaderActions";
import { ParamSegmented } from "@/features/jobs/components/ParamControls";
import { TaskList } from "@/features/tasks/components/TaskList";
import { assignableUsers, listTasks } from "@/features/tasks/queries";
import { requireUser } from "@/lib/auth/current";
import { getCompanyTimezone } from "@/lib/settings";
import { Page } from "@/ui/components/AppShell";
import { Chip, ChipRow } from "@/ui/components/Chip";
import { ListSection } from "@/ui/components/List";
import { LargeTitleHeader } from "@/ui/components/NavBar";
import { PageTransition } from "@/ui/motion/PageTransition";

export const metadata: Metadata = { title: "Tasks" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) ?? "";

const KINDS: { key: string; label: string }[] = [
  { key: "", label: "All" },
  { key: "callback_customer", label: "Call customer" },
  { key: "follow_up", label: "Follow up" },
  { key: "lead_retry", label: "Leads" },
  { key: "warranty_claim", label: "Warranty" },
  { key: "refund_due", label: "Refunds" },
  { key: "restock", label: "Restock" },
  { key: "custom", label: "Other" },
];

function href(sp: SP, patch: Record<string, string | null>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (one(v)) p.set(k, one(v));
  for (const [k, v] of Object.entries(patch)) {
    if (v) p.set(k, v);
    else p.delete(k);
  }
  const qs = p.toString();
  return qs ? `/tasks?${qs}` : "/tasks";
}

/** /tasks?scope=mine|all&kind= (SPEC M22 tasks; Appendix A). */
export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const viewAll = user.perms.has("tasks.view_all");
  const scope = viewAll && one(sp.scope) === "all" ? "all" : "mine";
  const kind = KINDS.some((k) => k.key === one(sp.kind)) ? one(sp.kind) : "";
  const [open, closed, users, tz] = await Promise.all([
    listTasks({ scope, kind: kind || null, status: "open" }),
    listTasks({ scope, kind: kind || null, status: "closed", limit: 20 }),
    viewAll ? assignableUsers() : Promise.resolve([]),
    getCompanyTimezone(),
  ]);
  const queue = scope === "all" ? open.filter((t) => !t.assigneeUserId) : [];
  const assigned =
    scope === "all" ? open.filter((t) => t.assigneeUserId) : open;

  return (
    <PageTransition>
      <LargeTitleHeader title="Tasks" trailing={<HeaderActions />}>
        <div className="flex flex-col gap-2">
          {viewAll && (
            <ParamSegmented
              param="scope"
              label="Whose tasks"
              value={scope}
              segments={[
                { value: "mine", label: "Mine" },
                { value: "all", label: "Everyone" },
              ]}
            />
          )}
          <ChipRow label="Task type">
            {KINDS.map((k) => (
              <Chip
                key={k.key || "all"}
                replace
                selected={kind === k.key}
                href={href(sp, { kind: k.key || null })}
              >
                {k.label}
              </Chip>
            ))}
          </ChipRow>
        </div>
      </LargeTitleHeader>
      <Page>
        <div className="enter-stagger flex flex-col gap-[var(--section-gap)]">
          {queue.length > 0 && (
            <ListSection
              variant="title"
              header="Office queue"
              footer="Unassigned — tap a task to assign it."
            >
              <TaskList
                tasks={queue}
                tz={tz}
                viewerId={user.id}
                users={users}
                canAssign={viewAll}
              />
            </ListSection>
          )}
          <ListSection
            variant="title"
            header={scope === "all" ? "Assigned" : "Open"}
            trailing={
              <span className="num text-footnote text-label-2">
                {assigned.length}
              </span>
            }
          >
            <TaskList
              tasks={assigned}
              tz={tz}
              viewerId={user.id}
              users={users}
              canAssign={viewAll}
              allowCreate
              emptyText={
                kind ? "No open tasks of this type." : "You're all caught up."
              }
            />
          </ListSection>
          {closed.length > 0 && (
            <ListSection
              variant="title"
              header="Recently done"
              footer="Swipe a task to reopen it."
            >
              <TaskList
                tasks={closed}
                tz={tz}
                viewerId={user.id}
                users={users}
                canAssign={viewAll}
                compact
              />
            </ListSection>
          )}
        </div>
      </Page>
    </PageTransition>
  );
}
