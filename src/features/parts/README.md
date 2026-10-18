# parts (M15): parts on jobs, receipts, reimbursements, inventory

Owner: B6. Spec: SPEC M15, §6.9.

## The two money trees
- **Company paid** (`company_stock` | `company_po` | `company_card`): cost on the line → `company_parts`
  deducted from the commission base. Company card buys create a `part_purchases` row (receipt required,
  approved, no ledger line) so card statements reconcile and unbilled buys are flagged.
- **Tech paid** (`tech_purchased`): `part_purchases` (pending) → auto-approve rules (`rules.ts`: under
  `limits.auto_approve_under_cents`, receipt present, AI total within tolerance or no AI, date near the job)
  or an approvals row (`part_purchase.submitted`). Approved job purchase → recompute job financials
  (tech parts deducted from the base, `reimbursement_parts` to the PURCHASER); approved non-job purchase
  (fuel, vehicle, tool, supplies) → `reimbursement_expense` (never touches a commission base).

## Screens & slots
`/parts` (tabs: mine, to approve, flags, non-job; `?new=receipt`) · `/inventory` (flag `inventory`: stock by
location, par, moves, counts, restock requests, variance report) · `/settings/parts`.
Slots: S38 `JobPartsPanel`, S39 `AddPartButton` (lazy sheet: truck stock, price book via S14, "I bought it",
company card, special order → B4 deposit + PO date), S45 `UnreceiptedPartsSection`.

## Hooks
- `api.ts`: `createPartPurchase` (B7 fuel/service/tools use it), `listUnreceiptedTechParts`.
- `approval-kinds.tsx`: `part_purchase` (Row/Detail with receipt photo vs typed vs AI, clean, edit-and-approve).
- `ai.ts`: `receipt` → stores the extraction and re-runs the rules (auto-approve or update the approval).
- `events.ts`: `job.callback_created` (reason part) → `warranty_claim` task.
- `cron.ts`: `parts.stale_receipts` (06:30, ⚖️ accountable plan), `inventory.cycle_count` (monthly).
- `offline.ts`: `parts.addPart`, `parts.submitReceipt` (receipt uploads resolved by client id).
- Inventory: B6 maintains `pricebook_items.avg_cost_cents` (weighted average on receive).
