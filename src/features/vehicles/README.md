# vehicles (M17) — owner B7

Fleet records, odometer / fuel / service / document / inspection / trip logs, Fleetio-style
reminders, NHTSA VIN decode + recalls, the configurable approval workflow, and Gemini assist
that degrades to typing when `AI_PROVIDER=none`.

## Screens
- `/vehicles` — fleet list (status filter, due/issue/review chips, 30-day fleet KPIs). Techs
  with one assigned vehicle are redirected to it ("My vehicle").
- `/vehicles/[id]` — `?tab=overview|logs|service|docs|issues|trips`, `?log=odometer|fuel|service|inspection|issue`
  opens the form. Quick-action tiles open lazy sheets (offline-capable through the outbox).
  When policy says techs can't log a type, the form is hidden with "Ask your admin…".
- `/vehicles/approvals` — review queue: full-size evidence, typed vs AI values with a
  confidence chip, previous approved reading, flags; Approve / Reject (reason) / Edit and
  approve; bulk "Approve all clean"; optional AI "Explain flags".
- `/settings/vehicles` — per-type policies, inspection frequency, odometer on clock,
  anomaly thresholds, issue response target, reminder seeds.

## Key flows
1. A log action inserts the row as `pending`, runs the rules-first anomaly checks
   (`rules.ts#detectAnomalies`), evaluates evidence (photo, AI cross-check, receipt total),
   then `resolveVehicleLogPolicy` (pure, golden-tested) decides: approved now, or
   `createApproval` (B6 queue). `engine.ts#finalizeLog` emits `vehicle.log_submitted`
   (+ `vehicle.anomaly`) and writes the vehicle timeline. Default: odometer
   `ai_optional: true`, so with AI off a normal reading with a photo auto-approves;
   anomalies (and an AI mismatch when AI is on) still go to review. Sheet copy comes
   from `rules.ts#approvalHint` so it always matches the policy.
   Trips are one per tech/vehicle/day: a same-day save edits that trip through the lock
   guards (approved/reimbursed or in-review trips can't be overwritten).
2. Approval effects (`engine.ts#applyApproved`, used by `approval-kinds.tsx#onDecide` and
   auto-approval): odometer cache + trailing 30-day average, reminders recomputed, service
   resets matching reminders, approved reimbursable trips post `reimbursement_mileage`
   via B6 `postLedgerEntry`. Pending entries never reset reminders or pay anything.
3. Tech-paid fuel/service → B6 `createPartPurchase` (category `fuel` / `vehicle`).
4. `time.clocked_in` → inspection-due push; `time.clocked_out` → drafts the day's IRS trip
   from the clock odometers and the B2 `getTechDay` stops (`events.ts`).
5. Cron: `vehicles.reminders` 05:00, `vehicles.documents` 05:10 (30/14/3-day windows,
   once per window per document — `rules.ts#documentWarningDue`, state read from the
   activity rows it writes, so a missed day or a document added mid-window still warns),
   `vehicles.recalls` monthly. Workers: `vin`, `recalls` (NHTSA vPIC via `adapters/vin`;
   recalls treats HTTP 400 as "no match" and retries with the base model name).

## Extension points
- Reminder seeds: Settings → Vehicles (or `settings.ts` defaults).
- New log type: add to `rules.ts#VEHICLE_LOG_TYPES`, a policy default in `settings.ts`, a
  table, an action that calls `finalizeLog`, and a kind in `approval-kinds.tsx`.
- AI: `ai.ts` handlers (odometer, receipt, shop_invoice, maintenance_suggest, explain_flags);
  free tier never sends registration/insurance documents (`adapters/ai/policy.ts`).
- Slots: S46 `TodayVehicleCard`, S48 `OdometerCaptureButton`, S49 `EndOdometerSection`,
  S50 `AssignedVehicleRow`, S52 `FleetSummaryCard`. API: `getAssignedVehicle`,
  `getVehicleOdometer`, `getFleetSummary`.
