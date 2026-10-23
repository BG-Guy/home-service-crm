# jobs — jobs, scheduling & dispatch (M05) · owner B2

The job record, its status machine, the schedule board, dispatch, the job detail
screen (office tabs and the tech action bar), notes and the job settings page.

## Files

| File | What it does |
|---|---|
| `machine.ts` | **Pure, client-safe** status machine: `TRANSITIONS`, `evaluateTransition()` (every M05 guard), checklist helpers, `buildWindow`, `nextRecurrenceDate`, `contactWindow`, `cancellationFee`, distance/travel, labels. Golden-tested in `tests/jobs/machine.test.ts`. |
| `transition.ts` | The **only** place statuses change. `applyTransition(tx, args)` = guards (B2 + B4 `evaluateTransitionControls` + Critical start approval) → job row → `job_status_events` (geostamp, distance, client ts/id) → specific event + `job.status_changed` → activity → B7 `recordStatusLocation` → tracking-token revoke → B3 `issueInvoiceForJob` on complete → cancellation-fee line → `job_cancel` approval after arrival. `scheduleAndAssign()` handles assign/reassign/reschedule (`job.assigned`, `job.scheduled`, `job.rescheduled`). |
| `kinds.ts`, `service-types.ts` | Job types, two levels. `kinds.ts` (**client-safe**, no imports): the three kinds Free estimate / Service call / Project (`JOB_KINDS`, labels, hints, icons, colors, `KIND_DEFAULTS`, `splitByKind`, `primaryTypeId`). A trade job (Lockout, Rekey…) is a `service_types` row with a `kind`; `listServiceTypeOptions()` feeds `components/JobTypePicker`. ⚖️ `requiresOwnershipCheck` stays on lockout-type jobs. |
| `availability/` | Booking windows: `engine.ts` (**pure**, golden-tested in `tests/golden/availability.test.ts`: 2-hour arrival windows open only when a tech works then, has the skill, is under `daily_job_cap`, fits the route via `arrivalFit` and isn't more than `max_extra_miles` out; never age) and `index.ts` (`getAvailability` loads a range in one batch; `getTechWorkDays` for the hub). |
| `api.ts` | Cross-module contract (§6.2): `createJob`, `createBookedJob` (a booking: window, job type, priority, after-hours, no tech), `getJobForUser`, `assertJobAccess`, `getJobContext`, cache setters, `closeJobIfEligible`, `confirmJob`, `requestReschedule`, `getContactWindowJob`, `getTechDay`, `addNote`, `importHistoricalJobs`. |
| `actions.ts` | Server actions (all via `action()`): create/edit, `scheduleJob`, `setJobStatus` (offline key `jobs.setStatus`), running late, start approval, confirm, close, checklist, completion/checklist signatures (S15 `action`), call logging, notes, `/settings/jobs`. |
| `queries.ts` | Read DAL with row scope in SQL (`jobScope`: view_all or an assignment). Lists (cursor), detail, notes, My Day, left-open jobs. |
| `schedule-queries.ts`, `dispatch-reads.ts` | Schedule board data (tech roster, conflicts, travel hints, deposit flags, queues) and the S9 assign-sheet options. |
| `dispatch/` | Assign hub `/dispatch`: `queries.ts` (day per tech, routes, profile facts, the job queue; also the shared day loaders `loadDayJobs`, `loadActiveTechRows`, `loadAssignees`), `recommend.ts` (pure ranking: extra route miles + load / overlap / clock / skill penalties, and `arrivalFit` shared with booking; never age), `needs-tech.ts` (one definition for the `jobs.needs_tech` badge and the hub's "Needs a tech" queue across days), `work-fit.ts` (working hours and time off in the matches), `colors.ts`, `format.ts`, `href.ts` (`hubHrefForJob`), `components/` (client `DispatchHub` shell, server `HubViews`, `HubAssignButton` → `scheduleJob`). |
| `schedule-map/` | The schedule's Map view (`/schedule?view=map`): `queries.ts` `loadScheduleMap` (one day: techs in board colors, jobs with windows, routes, miles; `schedule.view_all`, contact-window masking), `route.ts` (pure: route order, haversine miles, job phase, labels, keyboard stepping, timeline lanes) and the shared `src/lib/declutter.ts` (pure: box vs dot placement, also the live map's pins and name tags), tested in `tests/jobs/schedule-map*.test.ts` and `tests/lib/declutter.test.ts`; `components/` (lazy `ScheduleMapView`, Leaflet `MapCanvas` in its own chunk, `DayTimeline`, panels, `JobDetails`). |
| `portal-actions.ts` | Public S8 actions (token re-validated, rate-limited). |
| `approval-kinds.tsx` | `job_cancel` (after-arrival cancel review) and `job_start` (Critical risk) kinds for `/approvals`. |
| `events.ts`, `cron.ts` | Recurring next job on `job.completed`; `jobs.stale_tracking` (revoke tracking links after 3 h en route). |
| `slots.tsx` / `slots.client.tsx` | S4 CustomerJobsPanel, S5 NotesPanel, S7 ReassignJobsList / S8 PortalJobActions, S9 AssignJobButton. |
| `seed.ts` | Demo fragment #7 (90 jobs with timestamps, assignments, geostamped status history, notes, approvals, 2 tasks, counter bump). |

## Key flows

- **Tech flow** (`/jobs/[id]` action bar): On my way (ETA chips) → Arrived (radius warning, never a block) → Start (risk recomputed; Critical needs admin approval or prepay; ownership check) → Complete (readiness, B4 control misses, checklist, completion signature; `jobs.override_requirements` bypasses with a reason) → Collect payment (S19) → Next job. Hold → Return visit bumps `visit_count`. Every tap goes through the offline outbox with a geostamp; replays are idempotent on `clientId`.
- **Office**: `/schedule` (day = tech columns with drag-and-drop on desktop, 3-day/week = day columns; queues for unscheduled / on hold / unconfirmed tomorrow), the S9 assign sheet everywhere, the "…" job menu (edit, reschedule, confirm, return visit, callback, close, reopen, cancel, print, evidence).
- **Schedule map** (`/schedule?view=map&date=&tech=&job=`): Calendar | Map switch. One day: every tech's route in their board color (start → stops in window order, a chevron on every leg), job window boxes that fold to numbered dots, a per-tech timeline strip, the day summary or the job's details. Picking a job or a tech is client state mirrored with `history.pushState` (instant, back/forward work); ← / → step through a route, Esc closes.
- **Booking** (from any lead, `leads/booking-actions.ts` `bookLead` → `createBookedJob`): the job gets its job type, a 2-hour arrival window from `availability/` and no tech, so it lands in the Assign hub's "Needs a tech" queue; the customer's confirmation goes out when a tech is assigned (`job.scheduled`). New job (`/jobs/new`) uses the same job type cards.
- **Cancel**: reason code; after arrival also a note + photo (S24) and, for non-reviewers, an approvals row; late-cancel / no-show fee lines via B3 `addJobLine` (waivable).

## Extension points

- Add a guard: extend `evaluateTransition()` (pure) and add a golden case. Risk/evidence rules belong to B4's `evaluateTransitionControls`.
- New status-driven side effect: handle the event in your module's `events.ts`; never edit `transition.ts` from another module.
- Settings: `settings.ts` (`jobs` namespace) — add keys with defaults, edit on `/settings/jobs`.
- Offline: add an action to `offline.ts` and the `OfflineKey` union in `components/offline-client.ts`.
