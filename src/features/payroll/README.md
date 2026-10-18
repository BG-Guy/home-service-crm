# payroll (M16): commission, ledger, settlements, payouts, cash custody

Owner: B6. Satellite: `approvals` (unified queue). Spec: SPEC M16, §6.10, §10.

## What it does
- **Commission engine** (`engine/`, pure, isomorphic, golden-tested): `computeJob(inputs, plan, techs)` runs the
  §10.2 pipeline (deductions → base → rate resolution → recall rule → commission → spiffs → splits with the
  LAST assignee absorbing rounding → tips → reimbursements to the purchaser → cash netting) and returns a
  `trace` for "Why this amount?". Also: settlement math (`settle.ts`: deduction cap, W-2 floor + OT, tiers,
  carry-forward), ledger posting rules (`postings.ts`: recompute-with-reversals, chargebacks, recalls),
  pay periods, custody, ABA checksum, NACHA file builder, agreement generator.
- **DAL** (`server/`): `loadJobFinancialInputs` + `recomputeJobFinancials` (idempotent; reverses changed
  unsettled lines; after lock → one `adjustment` in the open period), settlements lifecycle
  (`draft → tech_review (48 h) → approved → paid → locked`), payouts + NACHA export, cash remittances,
  chargeback hold/release/clawback, recall clawback, plan resolution (`techPlans`).
- **Ledger** (`ledger_entries`) is append-only (DB trigger). Settlement membership is stored in
  `settlements.totals.entry_ids` (frozen when approved), not on the rows. W-2 deductions are posted with
  `needs_review` and only count after an admin applies them (`reviewLedgerEntry`).
- **Cash custody** = Σ cash + checks collected − confirmed hand-ins − cash netted in frozen settlements.
  Checks are never netted. 1099 techs with `net_in_payout` have cash deducted from pay; W-2 techs always
  hand it in.

## Screens
`/pay` (tech: live period, per-job trace, cash + hand-in, pending receipts, statements, bank, agreement;
office: hand-ins to confirm) · `/pay/statements[/id]` (printable pay stub, acknowledge, flag lines) ·
`/pay/settlements[/id]` (admin: statements, approve, payouts, NACHA, CSV for Gusto/ADP, cash, reports) ·
`/pay/bank` (encrypted bank details, ABA check, change hold) · `/pay/agreement` (plan in words + two worked
examples, e-signed via S15) · `/settings/commission` (versioned plans: form + Advanced JSON + live
calculator; assignments + per-tech overrides; periods; NACHA; role rates; mileage rates).

## Key flows
- Money events (`events.ts`) → `recomputeJobFinancials`: `job.completed`, `invoice.*`, `payment.succeeded`
  (+ cash limit check), `refund.*`, `part_purchase.*`, `review.received_logged`, `job.cancelled`.
  Earned on `job_done` or `paid_in_full` per plan; reimbursements of approved purchases are always owed.
- `dispute.*` → chargeback hold / release / clawback (`server/chargebacks.ts`).
- `job.callback_created` → recall clawback (policy `clawback_pct`).
- Cron (`cron.ts`): `payroll.periods` (00:15), `payroll.close` (hourly; end + `close_delay_hours` →
  `pay_period.closed` → draft statements), `payroll.review_deadline` (hourly), `payroll.cash_alerts` (08:00).
- Plan change → new version → `comp_agreement.required` for everyone on it; assignment change → same.
- Bank change → `user.bank_changed`; NACHA excludes the tech for `bank_change_hold_hours` unless "Verified".

## Extension points
- New ledger type: add to `engine/types.ts` `Posting["type"]`, `WAGE_CLASS_OF` and `LEDGER_TYPE_LABEL`.
- Other modules post only via `api.ts#postLedgerEntry` (mileage, expenses, tool lines, adjustments).
- Plan keys: `plan-schema.ts` (zod) + `engine/plan.ts` defaults; the form covers common fields, the rest is JSON.
- Seeds run inside `runQuietly()` so B6's engine runs without emitting events.

## Tests
`tests/golden/commission*.test.ts` (§10.4 A–G incl. F-same-period / F-hold-earlier, splits, W-2 floor/OT,
deduction cap, tiers, periods), `nacha`, `aba`, `custody`; `tests/payroll/flow.test.ts` (end-to-end on PGlite),
`tests/payroll/seed.test.ts` (fragments run clean, no events).
