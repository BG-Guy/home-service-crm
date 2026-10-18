# estimates (M07) — B3

Estimates with 1, 2 or 3 options (one recommended), e-signature approval, change
orders and the unsold-estimates board. Satellite: `pricebook` (see its README).

## Flows
- **Create** `/estimates/new` (from a job, a lead or a customer; `?jobId|leadId|customerId`) →
  `createEstimateDraft` (one option, recommended; a service line prefilled from the lead's quote
  or the service type's default price, the service type's warranty; marks the lead converted).
- **Build** `/estimates/[id]` — the workflow is: write 1, 2 or 3 options, star the one you
  recommend. Nothing is recommended or tagged per item.
  - **Options**: up to `MAX_ESTIMATE_OPTIONS` (3). `+` adds one, as a copy of the current
    option's items or blank; its label is `logic.nextOptionLabel` (the label for its position
    in `settings.estimates.option_labels`, default "Option 1 / 2 / 3"; stored labels such as
    Good / Better / Best are kept). The option sheet (sliders) edits the label and notes or
    deletes the option.
  - **Recommended**: the ★ next to the option switcher toggles the active option
    (`updateEstimateOption({ optionId, recommended })`, which clears the others; optimistic).
    One option per estimate at most; with a single option there is no star (it is implied).
    Customers see the recommended option highlighted and preselected; the headline total is
    the recommended option's (else the highest).
  - **Lines** from the price book (S14) or custom, with no tags on the rows: the service-call fee
    line ("credited if you approve the repair"), discounts checked against
    `limits.max_discount_pct[role]` on the server (`assertDiscountAllowed`). The line sheet keeps
    "Beyond the requested repair" (`is_upsell`, ⚖️ input to the cooling-off notice; never shown
    on the row).
  - **Legacy optional add-ons** (`is_optional`, from estimates written before this flow): new
    lines are never optional. An existing optional line reads "Optional" in its row subtitle
    and keeps the "Optional" switch in its sheet so it can be turned into a regular item; the
    customer still ticks it on `/e/` and in "Sign here", and the snapshot records it as an
    add-on. The server actions still accept `isOptional` / `addonIds`.
  - Deposit preview per option from B4 `previewDeposit`. Problem photos via S24 (tag `problem`).
  - No tags on estimates (the Tags section is gone; stored `entity_tags` rows are untouched).
- **Warnings** ⚖️: FTC cooling-off notice auto-attaches when a home sale ≥ $25 goes beyond the
  requested repair (service type `upsell_covered` or lines marked "Beyond the requested
  repair") — `logic.coolingOffApplies`; home-improvement contract notes by state
  (`compliance.ts`).
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
