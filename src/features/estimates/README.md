# estimates (M07) — B3

Good / better / best estimates with e-signature approval, change orders and the
unsold-estimates board. Satellite: `pricebook` (see its README).

## Flows
- **Create** `/estimates/new` (from a job, a lead or a customer; `?jobId|leadId|customerId`) →
  `createEstimateDraft` (one recommended option, a service line prefilled from the lead's quote or
  the service type's default price, the service type's warranty; marks the lead converted).
- **Build** `/estimates/[id]`: 1–3 options (labels from `settings.estimates.option_labels`, one
  Recommended), lines from the price book (S14) or custom; add-ons (`is_optional`), upsell tags,
  the service-call fee line ("credited if you approve the repair"), discounts checked against
  `limits.max_discount_pct[role]` on the server (`assertDiscountAllowed`). Deposit preview per
  option from B4 `previewDeposit`. Problem photos via S24 (tag `problem`).
- **Warnings** ⚖️: FTC cooling-off notice auto-attaches when a home sale ≥ $25 goes beyond the
  requested repair (service type `upsell_covered` or upsell lines) — `logic.coolingOffApplies`;
  home-improvement contract notes by state (`compliance.ts`).
- **Send** (SMS / email / link) → mints an `/e/` token (`portal/links.ts`), `enqueueMessage`
  template `estimate.sent`, status `sent`, `estimate.sent`. Follow-ups are B5 automations.
- **Approve** — one function for every channel, `approveEstimateTx`:
  in person (S15 on the tech's phone), remote (`/e/[token]`, `portal/actions.ts`), or verbal
  (`estimates.approve_on_behalf`, logged with a note, channel `verbal`). In one transaction:
  `captureSignature` (snapshot = `buildEstimateSnapshot`: option, required lines + chosen add-ons,
  totals, deposit, policy version ids + hashes → `doc_sha256`; IP, UA, geo, device time, token id),
  status `approved`, add-on selections, job created if missing (B2 `createJob`) + `setJobEstimate`,
  lines copied to the job's draft invoice (service-call fee credited), B4 `ensureDepositRequest`,
  event `estimate.approved`.
- **Decline / expire / reopen**: `declineEstimateTx` (staff or customer), cron `estimates.expire`
  (hourly), `reopenEstimate` (new expiry).
- **Change orders** `/estimates/co/[id]` (S10 "Change order" once an estimate is approved):
  reason + lines → send (`/e/` link with entity `change_order`) / sign here / verbal →
  `approveChangeOrderTx` (signature, lines to the invoice, `change_order.approved`).
  `getChangeOrderStatus(jobId)`: signed total (approved option as signed + signed COs) vs the job's
  current invoice total against `change_order_threshold_pct` / `_cents`.

## Extension points
- Contracts: `api.ts` (§6.3: `createEstimateDraft`, `hasSignedAuthorization`,
  `getChangeOrderStatus`, `getEstimateBriefs`), slots S10 `JobEstimatePanel`,
  S12 `CustomerEstimatesPanel`.
- Pure rules in `logic.ts` (golden: `tests/golden/estimates.test.ts`).
- Row scope in `access.ts`: `jobs.view_all`, else the author or an assignee of the job.
- Settings: `settings.estimates.*` on `/settings/invoices`.
