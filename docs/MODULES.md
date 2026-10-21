# Modules

One line per module (SPEC §5, §15.1). Owners are the build groups from
`docs/BUILD_PLAN.md` §1. Every module is **live** (integrated 2026-10-15). Each module
folder has a `README.md` with its flows and extension points.

| Module (key) | Spec | Owner | Flag (default) | Status |
|---|---|---|---|---|
| Auth & onboarding (`auth`) | M01 | F | — | live: signup (first run), login, invites, password reset, sessions, install prompt |
| Team & roles (`team`) | M02 | B8 (time clock: B2) | — | live |
| Customers & properties (`customers`) | M03 | B1 | — | live |
| Leads & intake API (`leads`) | M04 | B1 | `leads` (on) | live |
| Jobs, scheduling & dispatch (`jobs`) | M05 | B2 | — | live |
| Technician experience (`tech`) | M06 | B2 | — | live |
| Estimates (`estimates`) | M07 | B3 | `estimates` (on) | live |
| Invoices & receipts (`invoices`) | M08 | B3 | — | live |
| Deposits & payments (`payments`) | M09 | B4 | `deposits` (on) | live |
| Chargeback protection (`disputes`) | M10 | B4 | `chargeback_protection` (on) | live |
| Photos & evidence (`media`) | M11 | B4 | `photos`, `before_after` (on) | live |
| Messaging (`messaging`) | M12 | B5 | — | live |
| Automations & reminders (`automations`) | M13 | B5 | — | live |
| Review requests (`reviews`) | M14 | B5 | `reviews` (on) | live |
| Parts & inventory (`parts`) | M15 | B6 | `parts` (on), `inventory` (off) | live |
| Commission, payroll & payouts (`payroll`) | M16 | B6 | `payroll` (on) | live |
| Vehicles (`vehicles`) | M17 | B7 | `vehicles` (on) | live |
| Tools (`tools`) | M18 | B7 | `tools` (off) | live |
| Live tech map (`map`) | M19 | B7 | `map` (on) | live |
| Insights dashboards (`insights`) | M20 | B8 | — | live |
| Settings (`settings`) | M21 | B8 | — | live |
| Notifications, activity & audit (`notify`) | M22 | B5 | — | live |
| Customer portal (`portal`) | M23 | B3 | — | live |
| Data import/export & backups (`data`) | M24 | B1 | — | live |

Satellite folders (no manifest; perms and nav live in the parent): `tasks`, `time` (B2),
`pricebook`, `signatures` (B3), `approvals` (B6).

Flag defaults come from each module's `permissions.ts`; check `/settings/features` for the
live values.

## What each group built

**Customers, leads, data (B1).** Customers keeps people and service addresses: gate codes
are encrypted and masked for techs; merge, anonymize and global search (⌘K) are built in.
Leads arrive through one pipeline (`leads/intake/process.ts`) from a plain HTML form, a
~2 KB `embed.js`, the hosted `/f/<key>` form, the JSON API or marketplace webhooks. The
pipeline runs honeypot, signed timestamps, rate limits, dedupe and a soft spam score. A
missing or expired timestamp sends the lead to "Check"; only a tampered or too-fast one is
spam. Outside a job's contact window techs see masked phone, email and street
(`src/lib/mask.ts`), and calls are blocked.
Leads land in an inbox sorted by response-time urgency with a live SLA timer.
`/settings/lead-sources` generates paste-ready snippets with the real key and has a test
console. Lead custom-field values live in `leads.custom`. Data exports everything as a
zip, imports CSV customers, price book and past jobs with a dry run, backs up nightly, and
restores with `npm run restore`.

**Jobs, tech app, tasks, time (B2).** The job record and its status machine. Pure guards
live in `jobs/machine.ts`. Every status change goes through `jobs/transition.ts`, which
writes a geostamped status history and emits the specific event plus
`job.status_changed`. The modules also cover:
- the schedule board (tech columns with desktop drag-and-drop; 3-day and week views; queues; conflict and travel hints) and the S9 assign sheet
- the Assign hub `/dispatch` (`jobs/dispatch/`): every tech's day on a route map, the tech's profile and day, and a ranked "who should take it" for `?job=` from the pure `recommend.ts` (extra route miles + load, clock and skill penalties; never age). Assigning reuses `scheduleJob`
- `/jobs/[id]`: tabs for the office; a single scroll with a sticky action bar for techs, which enforces photos, signature, checklist and risk controls (admin override with a reason)
- the tech's My Day and Finish my day
- tasks and the time clock
- an offline queue (status, notes, checklist, clock) that is safe to replay on `clientId`

To extend: add guards in `evaluateTransition` (with a golden test case), side effects in your own `events.ts`, and settings in the `jobs` namespace.

**Documents & portal (B3).** The price book (markup matrix, CSV) feeds good/better/best
estimates. Each estimate has options, add-ons, discounts within role limits, per-line
tax, a deposit preview, the FTC cooling-off notice and state compliance notes.
- **Approval:** customers sign in person, on `/e/`, or verbally. Approval stores a sha256 snapshot plus the policy versions, creates or links the job, copies the lines to the invoice and requests the deposit.
- **Change orders:** follow the same pattern.
- **Invoices:** issued invoices are immutable. Revisions carry a snapshot, hash, diff and reason. Credit notes (`invoices/api#createCreditNote`, also used by B4 for partial refunds), void and write-off are supported; balances are derived from payments (`invoice_balances`: refunds count up to each payment's amount, never its tip). Completing a job with no lines leaves the invoice a draft. Draft line changes emit `invoice.lines_changed`.
- **Reporting and print:** an aging report, statements, and print pages with a pay QR code (`src/lib/qr.ts`); the print QR reuses one link per invoice (`mintOrReusePublicToken`) that lasts until 30 days after the due date.
- **Magic-link pages:** `/j`, `/e` and `/i` log every visit and are rate-limited.

**Payments, chargeback protection, media (B4).** A payments ledger with:
- manual methods (cash, check, Zelle, Venmo), which show as Unverified until the office confirms them
- Stripe over REST: hosted checkout on `/p/[token]`, HMAC-verified idempotent webhooks, refunds and promised refunds. Card fees start as an estimate (`payments.card_fee_estimate_*`). The `stripe_fee` worker then fetches the actual fee and the card details (`retrievePayment`) and emits `payment.fee_updated`, which payroll handles with `payroll.recompute_on_fee`

The other parts:
- **Deposits:** a rules engine creates deposit requests with a policy snapshot and applies deposits to the invoice. Rules re-run for jobs that haven't started when draft lines change, the invoice is issued or revised, or the job is confirmed or rescheduled. When no rule matches anymore, an unpaid request a rule created is canceled (`cancelUnneededDeposit`); one asked for by hand stays.
- **Refunds:** a partial refund on a paid invoice posts a credit note so the invoice stays paid (the tip is kept, commission scales to the net); a full refund re-opens it.
- **Risk and Readiness:** pure, golden-tested engines that drive the job transition controls and the job-header chip and ring.
- **Disputes:** a template narrative (never AI), Stripe field mapping, analytics against the 0.75 % line, and a printable Evidence Pack at `/jobs/[id]/evidence`.
- **Photos:** hashed and geostamped, with before/after compare, starring, and an embedding order for invoices, receipts and the portal.

**Communications (B5: messaging, automations, reviews, notify).** `enqueueMessage` is the
only send path. Every `scheduled_messages` row is re-checked at send time for:
- automation/flag state, conditions and entity state
- consent and quiet hours
- caps and expiry

Caller variables are stored in `scheduled_messages.vars` and the manual override in `meta`.

The free `link` SMS driver puts texts in an Outbox (`sms:`/`wa.me` prefilled, then "Sent?").

The `'*'` automation engine applies cancel-on rules and triggers using DST-safe anchors; dedupe keys stop double sends. All §7.3 built-ins, templates, reminders and editors are under Settings. The base seed upserts built-in automations and templates nobody has edited (`updated_by` empty) to the shipped catalog on every start; edited rows are kept, and a template's `default_body` (its "Reset" text) always follows the catalog.

Reviews are sentiment-neutral (`/r/` link, at most two asks). Notifications, push, the activity timeline and the audit viewer live in `notify`.

To extend:
- **SMS provider:** add a driver in `src/adapters/messaging`.
- **Automation or template:** add it in `automations/builtin`.
- **Notification type:** add it in `notify/catalog.ts`.

**Parts, payroll, approvals (B6).** Company-paid parts cut the commission base. Tech-paid receipts go through auto-approve rules or `/approvals`, then reimburse the purchaser. The pure commission engine (`payroll/engine`) computes each job's earnings with a "Why this amount?" trace and posts an append-only ledger (reversals before lock, adjustments after). Weekly periods close into statements:

`tech_review` (48 h) → approved → payout (Zelle, check, ACH/NACHA) → locked, which closes the jobs.

Cash custody nets 1099 cash or tracks W-2 hand-ins. `/approvals` collects every approval kind in one queue.

**Fleet & field (B7).** Covers vehicles, tools and the live map.
- **Vehicles:** logs, configurable approvals feeding `/approvals`, reminders, documents, trips, VIN and recalls, optional Gemini assist. With AI off, an odometer reading with a photo auto-approves unless it looks off (`odometer.ai_optional` defaults on); `vehicles/api#odometerApprovalHint` gives other screens the matching copy.
- **Tools** (flag `tools`, default off): register, kits, custody with QR labels, audits, incidents with gated deductions, maintenance, theft report.
- **Map:** consent-gated location pings, a live Leaflet map (lazy, `/map` only), and customer tracking at `/t/[token]`.

**Team, settings, insights (B8).**
- **Team:** invites through `enqueueMessage`, role changes, deactivation (last-admin protected; revokes sessions and push devices).
- **Settings:** the shell derived from module nav entries, the permission grid and per-user overrides (audited), and integrations with write-only secrets.
- **Insights:** SQL KPIs for admins, office (Ops board, also on `/today`) and techs, with server-rendered SVG charts, a weekly anomaly report and CSV export.

## Shared infrastructure (F, live)

- **Shell:** `src/app/(app)/layout.tsx`: role tab bar (§13.1), desktop sidebar (§13.2), badges, offline banner, install prompt, outbox flush, cron piggy-back. `/more` (grouped list, Appearance, Install, Sign out), `/settings` index, the global "+" menu and the notification bell (`HeaderActions`).
- **Offline:** `src/client/offline-registry.ts` statically spreads every module's `offlineActions` (jobs, time, payments, parts, payroll, vehicles, tools), so queued actions replay after a reload on any page.
- **Shared helpers added at integration:** `src/lib/qr.ts` (QR SVG encoder, used by invoices, tool labels and the collect sheet).
- **Added in QA round 2:** `forbidden()`-backed access denial (`(app)/forbidden.tsx`, 403 from route handlers), `src/lib/client-ip.ts` (`TRUST_PROXY`), `src/lib/phone-display.ts`, `src/lib/mask.ts`, `src/lib/zod-messages.ts`, `mintOrReusePublicToken` in `src/lib/tokens.ts`, the ⌘K search palette, `useConfirm` that works inside transitions, nav-derived loading titles, and `ctx.atPast` / `ctx.past` for demo seeds.
- **PWA:** `manifest.ts`, generated icons (`/icon`, `/apple-icon`, `/icons/*.png`), `public/sw.js`, `/offline`.
- **Template:** `src/features/_template/` is a reference module (not registered).
