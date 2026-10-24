# invoices (M08) — B3

Invoices, immutable issued documents with revisions, credit notes, receipts, statements,
the aging report and the print pages. Satellite: `signatures`.

## Lifecycle
`draft` (editable) → `issued` (frozen) → `partially_paid` → `paid` | `void` | `uncollectible`.
The status is a cache; the balance is always derived (`invoice_balances` view:
total − paid + refunded − credited).

- **Draft** `getOrCreateDraftInvoice(jobId)`: terms by customer type, warranty from the service
  type, photo defaults, deposit linking (B4 `linkDepositsToInvoice`). Lines come from the editor,
  approved estimates / change orders, and other groups through `addJobLine` / `removeJobLine`.
- **Issue** `issueInvoiceForJob(jobId, 'job_completed'|'manual')` (B2 calls it on completion,
  honoring `settings.invoices.auto_issue_on_complete`): recompute, freeze, due date, $0 → `paid`,
  evidence-lock the embedded photos, revision v1 (canonical-JSON snapshot + sha256), `invoice.issued`.
  `invoice.issued.via`: `manual` (Issue invoice; the built-in `invoice_sent` automation texts it),
  `collect` ("Get paid" on a draft: B4 issues it in the payment's transaction) and `send` (Send on
  a draft: the person is sending it right then). Neither `collect` nor `send` triggers
  `invoice_sent`.
- **Send** `sendInvoice` (a draft is issued first): the text card goes to the sender's own outbox
  inside their contact window (else the office's, the number hidden), and the result says what
  happened (`queuedOutcome`: status, channel, where, why not, when; `screen-copy.ts` words it).
- **Viewed** (`viewed.ts`): the customer's first view of an issued invoice on `/i/` emits
  `invoice.viewed` and writes "Customer opened invoice INV-1067" (once per invoice: an earlier
  activity row; never drafts, voids or staff). `?preview=1` with a staff session is a preview:
  the token is only peeked at (no access-log row), drafts show, Pay is off, a banner says so.
- **Revise** (`invoices.revise`): same number, version + 1, full snapshot + sha256 + line diff +
  reason; flagged `afterPayment` when money was already received (anomaly report).
- **Credit notes** reduce the balance; **void** (no payments) and **write off** (`invoices.void`).
- **Payments** are B4's; B4 calls `syncInvoicePaymentState` after every money movement
  (emits `invoice.paid`).
- **Cron** `invoices.overdue` daily 06:00: `invoice.overdue` on days 1, 3, 7, 14, 30, then every 30
  (idempotent via the activity row).

## Screens
`/invoices` (status chips, aging 0–30 / 31–60 / 61–90 / 90+, tech + source filters, search),
`/invoices/[id]` (Quote to Paid: section cards on phones, Balance (`screen-data.ts`: the approved
estimate's option, signed total and signature, deposits, the sign-off), Work, Photos on the invoice
(picked photos labeled Before / During / After, `photo-labels.ts`; picking is what shows them),
Signatures, then payments, receipts (in-app receipt sheet), customer, versions, tags and a named
"More" list; the bar `InvoicePayBar` = Send + Get paid, or Send receipt once paid; Preview opens
the customer's page full screen (`InvoicePreviewHub`); desktop shows the document with the rail),
`/invoices/[id]/print` (Letter, photos 2-up S26, pay QR to a long-lived `/p/` link, "Pay only
{Company}", descriptor line, warranty), `/invoices/statement/[customerId]`,
`/settings/invoices` (terms, late fee, photos, numbering, discount limits, portal options, policies).

## Extension points
- Contracts: `api.ts` (§6.3), slots S11 `JobInvoicePanel`, S13 `CustomerInvoicesPanel`.
- One document renderer: `components/InvoiceDocument.tsx` (screen, print and `/i/`).
- Pure: `math.ts` (line math, per-line tax half-away, status transitions, aging, CO threshold),
  `snapshot.ts` (revision snapshots/diffs), `qr.ts` (hand-rolled QR, ~2 KB) — golden-tested in
  `tests/golden/invoice-math.test.ts` and `tests/golden/qr.test.ts`.
- Badge `invoices.overdue` (office/admin).
