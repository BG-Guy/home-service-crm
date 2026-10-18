# tasks — follow-ups and to-dos (M22 tasks) · owner B2 (satellite of `jobs`)

Tasks for people (assigned) and the office queue (unassigned, visible with
`tasks.view_all`). Other modules create them through `api.ts`.

- `api.ts`: `createTask(tx, …, actor)` (emits `task.created`), `closeTasksFor(tx, q, status, actor)`.
- `actions.ts`: create / edit / done / dismiss / reopen (assigning others needs `tasks.view_all`).
- `queries.ts`: `listTasks({ scope, kind, status })` — scope enforced in SQL.
- `cron.ts`: `tasks.due` (every minute) emits `task.due` for tasks due in the last window.
- `badges.ts`: `tasks.due` = my open tasks due by end of today.
- `components/TaskList.tsx`: rows (tap the circle to finish, swipe to dismiss/reopen,
  tap to edit) + the create/edit sheet. Used by `/tasks` and My Day.

Kinds: `lead_retry`, `warranty_claim`, `restock`, `callback_customer`, `refund_due`,
`follow_up`, `custom`. Add a kind by extending `TaskKind` in `contracts.ts` and the
label map in `TaskList.tsx`.
