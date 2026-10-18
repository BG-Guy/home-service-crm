// Module manifest: `jobs` (SPEC §15.1). Owner: B2.
// Never rename permission or flag keys (BUILD_PLAN §11.3).
import { defineModule } from "@/features/define";
import { nav } from "./nav";
import { flags, grants } from "./permissions";
import { settingsShape } from "./settings";

export const manifest = defineModule({
  key: "jobs",
  name: "Jobs, scheduling & dispatch",
  description:
    "Job status machine and guards, schedule board, dispatch, job detail, notes, tasks and the time clock.",
  owner: "B2",
  grants,
  flags,
  settingsShape,
  settingsPage: "/settings/jobs",
  nav,
  emits: [
    "job.created",
    "job.scheduled",
    "job.rescheduled",
    "job.assigned",
    "job.confirmed",
    "job.reschedule_requested",
    "job.en_route",
    "job.running_late",
    "job.arrived",
    "job.status_changed",
    "job.started",
    "job.on_hold",
    "job.return_visit_scheduled",
    "job.completed",
    "job.closed",
    "job.cancelled",
    "job.callback_created",
    "job.start_approval_requested",
    "job.start_approved",
    "job.start_denied",
    "job.cancel_review_requested",
    "task.created",
    "task.due",
    "time.clocked_in",
    "time.clocked_out",
  ],
  satellites: ["tasks", "time"],
  customFieldEntities: ["job"],
});
