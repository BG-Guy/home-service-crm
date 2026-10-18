# team (M02 Team & roles, minus the time clock) — owner B8

Who works here, what role they have, and getting people in and out.

## Screens
- `/team` — Active / Invited / Deactivated (`?status=`). Rows show avatar + presence
  (clocked in, from B2 `getClockStatuses`), role, worker type, last sign-in, cash and
  checks held (B6 `getCustodyBalances`, only for viewers with payroll/users access),
  unsigned comp agreement (B6) and overdue tool audit (B7). "Invite" opens a sheet.
- `/team/[id]` (`users.manage`) — profile (licenses, skills, service ZIPs, home base,
  hire date, equipment flags, monitoring notice), Edit sheet (also the photo), Role &
  access (role picker, link to per-user overrides, password reset link), S43
  `TechCompSection`, S50 `AssignedVehicleRow`, S51 `ToolCustodyRow`, S6
  `TimeEntriesSection`, S33 `ActivityTimeline` (entity user), Deactivate / Reactivate.
  After deactivation: S7 `ReassignJobsList` and a "still holding cash" banner.

## Flows (all `action()` → perm + zod + one transaction + audit/activity/events)
- **Invite** (`users.invite`): F `createInvite` (emits `user.invited`), then the link goes
  out only through B5 `enqueueMessage` template `user.invite` (email, and/or an SMS card
  in the inviter's outbox). The sheet also shows the link with Copy and `sms:` buttons.
  Resend = revoke + new 7-day link. Only `users.manage` holders may invite admins.
- **Deactivate** (`users.manage`): status → `deactivated`, F `revokeAllSessions` and B5
  `deletePushSubscriptions` in the same transaction, emits `user.deactivated`. You can't
  deactivate yourself or the last active admin (`rules.ts#lastAdminBlock`).
- **Role change**: last-admin lock; making someone an admin needs `settings.permissions`;
  emits `permission.changed` (perm `*`).
- **Worker type** switch shows the ⚖️ notes in `rules.ts#WORKER_TYPE_NOTES` (never remove).
- **Password reset**: F `createPasswordResetLink` (30 min), optionally emailed with the
  `user.password_reset` template.

## Extension points
- `api.ts` — `getUserBriefs(ids)` and `listUsers({ roles?, statuses?, perm? })` for
  everyone (TechCard, assign pickers, audiences). Keep them cheap: one query + batch avatars.
- Add profile fields: column in `users` (schema request) → `queries.ts#getTeamMember`
  → `components/EditMemberSheet.tsx` + `actions.ts#updateMemberAction`.
- `seed.ts` — demo profiles, the tech1 override and Jordan's pending invite.
