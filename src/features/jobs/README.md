# jobs — jobs, scheduling & dispatch (M05) · owner B2

The job record, its status machine, the schedule board, dispatch, the job detail
screen (office tabs and the tech action bar), notes and the job settings page.

## Files

| File | What it does |
|---|---|
| `machine.ts` | **Pure, client-safe** status machine: `TRANSITIONS`, `evaluateTransition()` (every M05 guard), checklist helpers, `buildWindow`, `nextRecurrenceDate`, `contactWindow`, `cancellationFee`, distance/travel, labels. Golden-tested in `tests/jobs/machine.test.ts`. |
| `transition.ts` | The **only** place statuses change. `applyTransition(tx, args)` = guards (B2 + B4 `evaluateTransitionControls` + Critical start approval) → job row → `job_status_events` (geostamp, distance, client ts/id) → specific event + `job.status_changed` → activity → B7 `recordStatusLocation` → tracking-token revoke → B3 `issueInvoiceForJob` on complete → cancellation-fee line → `job_cancel` approval after arrival. `scheduleAndAssign()` handles assign/reassign/reschedule (`job.assigned`, `job.scheduled`, `job.rescheduled`). |
| `api.ts` | Cross-module contract (§6.2): `createJob`, `getJobForUser`, `assertJobAccess`, `getJobContext`, cache setters, `closeJobIfEligible`, `confirmJob`, `requestReschedule`, `getContactWindowJob`, `getTechDay`, `addNote`, `importHistoricalJobs`. |
| `actions.ts` | Server actions (all via `action()`): create/edit, `scheduleJob`, `setJobStatus` (offline key `jobs.setStatus`), running late, start approval, confirm, close, checklist, completion/checklist signatures (S15 `action`), call logging, notes, `/settings/jobs`. |
| `queries.ts` | Read DAL with row scope in SQL (`jobScope`: view_all or an assignment). Lists (cursor), detail, notes, My Day, left-open jobs. |
| `schedule-queries.ts`, `dispatch-reads.ts` | Schedule board data (tech roster, conflicts, travel hints, deposit flags, queues, property `lat`/`lng` for the map) and the S9 assign-sheet options. |
| `route-plan.ts` | **Pure, client-safe** route maps: `planRoutes` numbers each tech's stops in visit order, `routeLayers` turns a plan into numbered pins + straight dashed lines, `unlocatedStops`, `techColor` (the board's color rule). Tested in `tests/jobs/route-plan.test.ts`. |
| `components/schedule/RouteMap.tsx` | Leaflet canvas for routes (lazy chunk; `compact` for the tech's Today card). `ScheduleMap.tsx` is the `/schedule?layout=map` UI (loaded by `LazyScheduleMap`), `RouteMapCard.tsx` the Today card (loads when scrolled near), `StopBadge.tsx` the pin-matching number. |
| `portal-actions.ts` | Public S8 actions (token re-validated, rate-limited). |
| `approval-kinds.tsx` | `job_cancel` (after-arrival cancel review) and `job_start` (Critical risk) kinds for `/approvals`. |
| `events.ts`, `cron.ts` | Recurring next job on `job.completed`; `jobs.stale_tracking` (revoke tracking links after 3 h en route). |
| `slots.tsx` / `slots.client.tsx` | S4 CustomerJobsPanel, S5 NotesPanel, S7 ReassignJobsList / S8 PortalJobActions, S9 AssignJobButton. |
| `seed.ts` | Demo fragment #7 (90 jobs with timestamps, assignments, geostamped status history, notes, approvals, 2 tasks, counter bump). |

## Key flows

- **Tech flow** (`/jobs/[id]` action bar): On my way (ETA chips) → Arrived (radius warning, never a block) → Start (risk recomputed; Critical needs admin approval or prepay; ownership check) → Complete (readiness, B4 control misses, checklist, completion signature; `jobs.override_requirements` bypasses with a reason) → Collect payment (S19) → Next job. Hold → Return visit bumps `visit_count`. Every tap goes through the offline outbox with a geostamp; replays are idempotent on `clientId`.
- **Office**: `/schedule` (day = tech columns with drag-and-drop on desktop, 3-day/week = day columns; queues for unscheduled / on hold / unconfirmed tomorrow), the S9 assign sheet everywhere, the "…" job menu (edit, reschedule, confirm, return visit, callback, close, reopen, cancel, print, evidence).
- **Map layout** (`/schedule?layout=map`, deep link per tech: `&tech=<userId>`): one day's routes (day chips in 3-day/week) with numbered pins per tech in visit order, a dashed straight line between them, grey "?" pins for unassigned jobs; legend (tap = only that tech), stops grouped by tech, a "Not on the map yet" group for addresses without a geocode, and a selected-stop card with Open job / Assign. Free: Leaflet, `getMapConfig()` tiles and the property geocodes; no routing service. Techs see their own route on `/today`; a stop gets a pin only inside its contact window, like the house number.
- **Cancel**: reason code; after arrival also a note + photo (S24) and, for non-reviewers, an approvals row; late-cancel / no-show fee lines via B3 `addJobLine` (waivable).

## Extension points

- Add a guard: extend `evaluateTransition()` (pure) and add a golden case. Risk/evidence rules belong to B4's `evaluateTransitionControls`.
- New status-driven side effect: handle the event in your module's `events.ts`; never edit `transition.ts` from another module.
- Settings: `settings.ts` (`jobs` namespace) — add keys with defaults, edit on `/settings/jobs`.
- Offline: add an action to `offline.ts` and the `OfflineKey` union in `components/offline-client.ts`.
