# time — time clock (M02 time clock, M06 start/end of day) · owner B2 (satellite of `jobs`)

- `actions.ts`: `clockIn` / `clockOut` (geostamp, device time for offline replays
  within 12 h, odometer reading id from B7 S48 when required), `logBreak`,
  `editTimeEntry` / `addTimeEntry` (`time.manage`, reason required, audited).
  Emits `time.clocked_in` / `time.clocked_out` (B7 drafts trips from these).
- `offline.ts`: `time.clockIn`, `time.clockOut`, `time.break`.
- `api.ts`: `getClockStatuses(userIds)` (B7 location sharing, B8 team),
  `getHoursWorked(userId, from, to)` (B6 W-2 floor).
- `queries.ts`: own entries with `time.clock_self`; anyone's with `time.manage`.
- `slots.tsx`: S6 `TimeEntriesSection` (B8 `/team/[id]`).
- `components/TimeEntryList.tsx`: entries grouped by day with totals and the edit sheet.
- `seed.ts`: 60 days of Mon–Sat entries for the three demo techs; today's left open.

`/time` shows the clock card, period totals and entries (managers pick a person).
