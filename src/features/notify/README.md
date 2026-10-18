# Notifications, activity & audit (M22) — owner B5

Staff notifications (bell, Web Push, email fallback), per-user preferences, the daily
digest, the activity timeline UI and the audit-log viewer.

## Flows

- **Delivery** (`deliver.ts`): one `notifications` row per user (the bell, always), then
  push and/or email per the user's preference for that type (Push default / Email / Off —
  Off keeps the bell). Critical types (new lead, dispute, cash over limit, settlement
  ready) fall back to email when the user has no working push subscription. Provider calls
  run in the `push` / `email` job_queue workers (`workers.ts`): dead subscriptions (404 /
  410 or 5 failures) are pruned; cron `push.prune` also drops silent ones.
- **Two entry points**: automations send staff messages through `enqueueMessage` (audience
  user), and `notify(tx, input)` is for direct alerts with no §7.3 automation (e.g.
  `lead.touched`, remittance requests, task assigned — handler `notify.task_assigned`).
- **Daily digest**: cron `notify.digest` emits `digest.daily` once a day at
  `settings.notify.daily_digest_time`; the `daily_digest` automation delivers it.
- **Push subscribe**: S36 `PushEnableButton` (`src/client/push.ts`; iOS only from the
  installed app) → `POST/DELETE /api/push/subscribe`. Keys: `npm run gen:vapid`.
- **Timeline** (S33 `ActivityTimeline`): `activity` rows for a customer, job or entity,
  grouped by day, filter chips All / Messages / Jobs / Money / Notes (Appendix C),
  cursor paging; row scope is checked per entity (B1/B2 access asserts, view perms).
- **Audit viewer** (`/settings/audit`, `audit.view`): filters by actor, action prefix,
  entity, dates; expandable before/after diff; read-only (append-only table).

## Extension points

- New notification type: add it to `catalog.ts` (label, group, `critical`) and seed a
  `staff.*` template; it appears in S35 `NotificationPreferences`.
- Badges: `notifications.unread`. Bell: S34 `NotificationBell` (mounted by the shell).
