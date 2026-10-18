# tech — technician mobile experience (M06) · owner B2

The tech's day: `/today` (My Day) and `/today/finish` (Finish my day). The job
screen's action bar lives in `jobs/components/ActionBar.tsx`.

## Screens

- **My Day** (`components/MyDay.tsx`, server): greeting, `ClockCard` (geostamped clock in
  through the offline outbox; B7 S48 odometer first when `vehicles.require_odometer_on_clock`
  applies; breaks), B6 S41 cash pill, the **next-job hero** (current or next job with
  S1/S2 compact cards and `HeroActions`: Navigate + On my way / Arrived / Open job),
  today's route in window order with a done counter, carry-over jobs, own tasks,
  B7 S46/S47 cards, B6 S42 earnings, shortcuts (outbox S32, upload receipt, my jobs,
  Finish my day).
- **Office/admin** `/today`: "Your jobs today" (when assigned) + B8 S54 `OpsToday`.
- **Finish my day** (`/today/finish`): 1 sync status (`SyncStatusCard`, outbox state +
  "Sync now"), 2 unsent texts (S32), 3 jobs left open, 4 S44 cash, 5 S45 receipts,
  6 S49 odometer, 7 clock out.

## Offline

Status changes, notes, checklist answers and the clock go through
`src/client/outbox.ts` (`queueAction`), keyed `jobs.*` / `time.*`
(`jobs/components/offline-client.ts` registers them). Uploads use `queueUpload`.
Drafts autosave with `useDraft` (notes, new job).

## Extension points

Add a My Day card by rendering another module's slot inside `MyDay.tsx`; keep heavy
client pieces lazy (`next/dynamic`) so `/today` stays within the §14 budget.
