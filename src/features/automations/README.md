# Automations & reminders (M13) — owner B5

The automation engine, the built-in catalog (SPEC §7.3 + BUILD_PLAN Appendix B), the
template / automation / reminder editors and the template variable context (§7.4).

## Engine (`engine.ts`, handler `automations.engine` on `'*'`)

For **every** domain event, in the handler's own transaction:
1. **cancel_on** — any automation (enabled or not) listing the event cancels its open
   sends. Entries are `"event"` or `{ event, when?, scope? }`; scope `entity` (default:
   the event's entity, its ids and its job), `customer` (default for `message.*`),
   `subject_user`, `actor_user`. `job.cancelled` also drops every pending job send except
   the cancellation follow-ups.
2. **triggers** — enabled automations whose `trigger_event` (`a|b` allowed) matches, whose
   feature flag is on and whose `conditions` pass schedule one row per step × recipient ×
   channel through `enqueueCore`. Steps: `delay` (negative allowed), `anchor`
   (`event_time`, `job.window_start`, … `|` fallbacks, `fixed_time_local HH:MM`), `at`,
   `channel` / `audience` (`+` joins), `template_key`, `dedupe` (`entity` | `event` |
   `batch`), `only_on`, `when`, `delay_months_field`. Field-anchored steps key the dedupe
   on the anchor, so a reschedule cancels the old send and creates the new one; re-emitted
   events never double-send. Past sends go out now unless the anchor passed more than the
   template's `expires_after_minutes` (then `expired`).
- `lead_ack` switches to `lead.ack_after_hours` outside business hours.
- Review asks that waited for payment are scheduled by `reviews` on `invoice.paid`.
- Audiences: `customer`, `assigned_tech(s)`, `added_techs`, `removed_techs`,
  `event_techs`, `subject_user`, `creator`, `vehicle_assignee`, `office`, `admins`,
  `perm:<key>`, `role:<key>`, `user:<id>`. People are never pushed about their own action.

## Pieces

- `conditions.ts` — safe evaluator (`all`/`any`/`not`, ops `eq…not_exists`); anything
  malformed anywhere makes the whole condition false (fails closed).
- `schedule.ts` — anchor + delay math (DST-safe calendar days), already-past rules,
  dedupe keys, business hours. Pure; golden-tested.
- `context.ts` — `loadFacts` + `buildTemplateContext` (every §7.4 variable, GSM-safe,
  per-send magic links: job, estimate, invoice, pay, review, tracking).
- `reminders.ts` + `recurrence.ts` — custom reminders (once, daily, weekly, monthly,
  every N days / months, every N miles via B7 `getVehicleOdometer`); cron `reminders.due`
  emits `reminder.due` and advances `next_at`; the handler delivers via `enqueueMessage`
  (customer reminders default to the marketing purpose ⚖️). Cron `automations.fixed_time`
  (00:05) schedules `schedule.daily` automations (tech daily agenda at 07:00).
- Editors: `/settings/automations` (+ `/[key]`: form, conditions, steps, cancel-on, raw
  JSON for admins, *Preview with a real job*, *Send test to me*), `/settings/templates`
  (+ `/[key]`: per channel, variable picker, live preview, GSM-7 / link / review linters,
  reset to default), `/settings/reminders`.

## Extension points

- New built-in: add it to `builtin/automations.ts` and its templates to
  `builtin/templates.ts`; F's base seed inserts missing rows on boot (admin edits survive).
- New event: add it to `EventMap`; the engine sees it automatically.
- Tests: `tests/golden/conditions.test.ts`, `tests/automations/*` (schedule, recurrence,
  builtin coverage, engine integration on PGlite).
