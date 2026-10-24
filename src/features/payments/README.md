# Payments & deposits (M09) — owner B4

Money in: a `payments` ledger (one row per collection that succeeds or holds), manual
methods with office verification, Stripe over REST (no SDK), refunds and promised
refunds, a deposit rules engine and deposit requests applied to invoices. Balances are
always derived (`invoice_balances` view); ledgers are append-only.

## Flows

- **Get paid (S19, `CollectPaymentButton`)**: lazy sheet ("Get paid"): the amount big with
  "Includes a $X tip", one-tap tip chips (never on fee lines unless `tip_on_fees`), method
  tiles ("Pay on their phone" = the pay link's QR + "Text the link" with a card processor,
  Card off with its reason without one; cash, check, Zelle, Venmo; Zelle/Venmo show
  `payments.manual_instructions` to read out), the main button in the sheet's sticky footer
  (the body portals it into the sheet's footer slot), overpayment guard (UI +
  `recordPayment`), reference # / check-photo rules, risk-band card restrictions (High: 3DS
  link only; Critical + `cash_only`: no card/Venmo), split payments ("Collect the remaining
  $X"). On a DRAFT invoice getting paid issues it first, in the same transaction
  (`issueDraft` on `recordManualPayment` / `createPayLink` / `sendPayLink`, `via: "collect"`;
  the row is locked first); picking "Pay on their phone" on a draft waits for "Show the QR
  code" or "Text the link" before issuing it. The QR's link (`createPayLink`) is reused for a
  while (`mintOrReusePublicToken`, purpose `pay.collect`); a texted link is fresh. An empty
  draft has nothing to collect. Manual methods go through the offline outbox
  (`payments.recordManual`, idempotent on `clientId`). Success: the invoice's payments, "Send
  the receipt: Text / Email" (`sendReceipt` with a channel; the result is said in place),
  "Receipt emailed to …" (`receiptStatus`), View receipt (`ReceiptSheet`, `loadReceipt`; its
  share link is reused per payment, `receiptLink`). The sheet's owner stays mounted when the
  payment settles what was due (`CollectPaymentButton hidden`, the invoice page's bar).
- **Manual payments** are `succeeded` but **Unverified** until the office verifies them in
  the bank (`/payments?tab=unverified`, `payments.verify_manual`). Cron
  `payments.manual_unverified` emits `payment.manual_unverified` once per payment.
- **Cards**: `/p/[token]` creates a hosted Checkout Session on click (itemized lines,
  service address, descriptor suffix, metadata, tip line, 3DS on High/Critical, expiry,
  idempotency key) and records a `checkout_sessions` row. The webhook
  (`/api/webhooks/stripe` → `webhook.ts`) verifies the HMAC (5-min tolerance), stores the
  event in `webhook_events` (unique → idempotent; unknown types stored), processes it in
  its own transaction and always answers 200 once verified; `payments.webhook_retry`
  replays failures. Fees: a card payment starts with an estimate (`card_fee_estimate_*`); the `stripe_fee` worker fetches the actual fee and the card details (`retrievePayment`) and emits `payment.fee_updated` (payroll recomputes).
- **Refunds**: `refundPayment` (role limit from `limits.max_refund_cents`, original
  method; provider call outside the transaction), `schedulePromisedRefund` (due date →
  cron `refunds.due` → `refund.due` + `refund_due` task), `markRefundPaid`.
- **Deposits**: `ensureDepositRequest` evaluates `deposit_rules` (priority, first match;
  `engine/deposit-rules.ts` is pure and golden-tested), snapshots the deposit policy
  (`policy_versions` + sha), falls back to `manual` without a processor, adds ⚖️ state-cap
  warnings. Lifecycle `required → requested → paid|held → applied | refunded | forfeited |
  waived | expired`. Handlers: deposit on `job.scheduled`; on `job.cancelled` open
  requests expire (links revoked), holds are released, paid deposits get a refund task or
  are forfeited per policy (special-order PO date); on `invoice.issued` a deposit larger
  than the total suggests a refund. Holds are captured at completion by cron
  `payments.capture_holds`; `deposits.hold_expiring` alerts 24 h before expiry.
- **Reconciliation** (`/payments?tab=reconciliation`): card settlements per day (gross −
  fees − refunds) and flagged items (no processor ref, fee not fetched, invoice paid but
  unmatched, stale unverified, uncaptured holds).

## Files

| File | Purpose |
|---|---|
| `api.ts` | §6.4 contract: balances, `getJobMoney`, `recordPayment`, deposits, receipts |
| `actions.ts` | Server actions (collect, verify, pay links, receipts, deposits, refunds, settings) |
| `public-actions.ts` | No-session actions: `/p/` checkout, receipt flag (S28) |
| `provider-events.ts`, `webhook.ts` | Normalized provider events → rows/events; webhook ingest |
| `background.ts`, `cron.ts`, `workers.ts` | Cron + queue bodies (provider calls outside tx) |
| `events.ts` | Domain-event handlers (idempotent) |
| `engine/` | Pure math: deposit rules, fees/surcharge caps/tips/balance |
| `queries.ts`, `pay-page.ts` | Read DAL (perm + row scope) |
| `slots.tsx`, `slots.client.tsx`, `components/` | S16–S20, S28 and screen pieces |
| `seed.ts` | Demo fragment #12 (payments, deposits, refunds, then risk + readiness engines) |

## Extension points

- New method: add it to `settings.payments.methods` (enum), `METHOD_LABEL` (`internal.ts`)
  and the tile map in `components/CollectSheet.tsx`.
- New processor: implement `PaymentProvider` in `src/adapters/payments/` (B4 steward),
  map its webhooks to `NormalizedEvent`, add a route under `/api/webhooks/<name>`.
- Fee policy is in `engine/fees.ts` (tested in `tests/payments/fees.test.ts`).
- Tests: `tests/golden/deposit-rules.test.ts`, `tests/payments/{fees,webhook}.test.ts`.
