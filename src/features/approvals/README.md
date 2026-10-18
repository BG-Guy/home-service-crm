# approvals (satellite of payroll): the unified `/approvals` queue

Owner: B6. Contract: BUILD_PLAN §6.10.

- `api.ts`: `createApproval` (one pending row per entity), `decideApproval` (checks the kind's perm for user
  actors, updates the row, runs `kind.onDecide` in the same transaction, audits), `getApprovalFor`,
  `countPendingApprovals` (nav badge `approvals.pending`).
- `registry.ts` aggregates the kinds from `vehicles`, `jobs`, `parts` and `payroll` `approval-kinds.tsx`.
- A kind (`ApprovalKindDef`) provides `perm`, `Row`, `Detail` (server components), optional `clean()`
  (for "Approve all clean"), optional `editFields()` (edit-and-approve) and `href()`, and `onDecide`.
- `/approvals`: chips per decidable kind (`?kind=`), waiting / decided (14 days), approve, reject with a reason,
  edit-and-approve, approve all clean.

Add a kind: export it from your module's `approval-kinds.tsx`, add the entity type to
`APPROVAL_ENTITY_TYPES` (`src/db/enums.ts`), and create rows with `createApproval` in your action.
