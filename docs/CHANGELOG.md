# Changelog

## Unreleased

### UX round (2026-10-18)
- **Calendar window.** Date fields open the app's own calendar instead of the browser's.
  On touch screens it's a bottom sheet that slides up. With a mouse it's a popover that
  springs out of the field.
  - Months slide left and right: arrows, a swipe that carries the finger's speed,
    PageUp/PageDown, and Shift for a whole year.
  - The month title opens a month/year grid, and quick picks cover Today, Tomorrow and
    In a week.
  - The day grid has full keyboard support and screen-reader labels.
  - `DateField` keeps the native contract ('YYYY-MM-DD', `name`, `required`, a real
    `onChange`).
  - The schedule's date line opens the same window to jump to any day. Paging the board
    (‹ ›, Today, the jump) slides it toward the new day.
- **Time picking without typing on touch.** On touch screens, time fields open iOS
  Clock-style wheels: hour, minute by the field's step, and AM/PM. The wheels snap, loop
  and roll on a cylinder, and Done commits. With a mouse, they are typed hour/minute
  segments: digits auto-advance, ↑/↓ step by the field's step, A/P switches, and there
  are AM/PM toggle buttons. Every remaining native date and time input uses the new
  pickers. The public lead form keeps the browser's, to stay light.
- **Estimates.** Tags are gone. You write 1, 2 or 3 options and star the one you
  recommend, in one tap. There are no per-item add-on/upsell tags, and the default
  labels are Option 1/2/3 (stored labels win).
- **Desktop action rail.** On desktop, page actions stand in a column beside the sidebar
  instead of behind "…". This covers jobs, customers, leads, estimates, change orders,
  invoices and vehicles. Phones keep the "…" sheet.
- **History breadcrumbs.** Back buttons and desktop breadcrumbs follow the pages this tab
  actually visited, not the app's folders, so they lead back to where you came from.
  Long-press the back button on a phone for the whole trail. The trail is kept per tab
  and per user.
- **Worker profile.** The profile row in the sidebar and More opens your worker profile,
  with your work (schedule, jobs, pay, time) one tap away.
- **Schedule on a map (free).** `/schedule?layout=map` shows routes on a map, with a
  Calendar | Map toggle beside Day / 3 days / Week. Paging, Today, the tech filter and the
  per-tech deep link `&tech=<id>` all keep working in both layouts.
  - Each tech's stops get numbered pins in visit order, in the tech's calendar color,
    joined by a dashed straight line. Unassigned jobs get grey "?" pins.
  - A side list matches the pins: the tech legend (tap to show only that tech), the stops
    by tech, and "Not on the map yet" for addresses that couldn't be located.
  - Selecting a stop and selecting a pin highlight each other. The selected stop's card
    has Open job and Assign. 3-day and week views get day chips.
  - Techs get a compact "Today's route" map on `/today`. A stop gets a pin only inside its
    contact window, like the house number.
  - It's free: Leaflet (lazy; the calendar layout never loads it), the properties' Census
    geocodes and the configured tiles, with no routing service. Without a tile URL in
    production, pins and lines show on a plain background.
  - Pins work with the keyboard: Enter and Space select them, and the live map's pins
    now do too.
- **Address autocomplete.** Staff typing a street get up to five US address suggestions.
  Picking one fills the street, city, state and ZIP (or the one-line address). It's on
  the customer form, the property sheet, company settings, the team home base, new leads
  and the job form's customer picker.
  - Lookups run through a new `places` adapter: Photon (free, OpenStreetMap data, no
    key; `PHOTON_URL` for a self-hosted server) or Geoapify (`GEOAPIFY_API_KEY`).
  - Lookups are cached and rate-limited per user, and never log the typed text.
  - Settings → Integrations has a test button. DEPLOY §9 has the free options.
- Bundle: pages now import `DateField`/`TimeField` from their own modules. Forms without
  dates don't ship the pickers, and the breadcrumb UI stays out of the app shell.
- Fixed: the assign sheet re-queried conflicts every ~250 ms while open once edited.

### Trade demo profiles (2026-10-18)
- `npm run seed:demo -- --profile=<handyman|locksmith|chimney>` (with `--reset` as usual)
  seeds one realistic single-trade business at the same scale as the mixed demo (40
  customers, 90 jobs, 66 invoices, 60 payments, deposits, a refund, a dispute, leads,
  messages, reviews, parts and receipts, payroll, vehicles, tools, time and the map):
  Brightside Handyman Co. (Austin, `brightside.test`), Ironclad Lock & Key (Denver,
  `ironclad.test`, lots of after-hours lockouts) and Ember & Flue Chimney Co. (Columbus,
  `emberflue.test`, fall sweep season). Password `TestDrive2026!`; each has its own brand
  accent, tax rate, time zone, price book, service type, checklists and fictional
  555-01xx phone numbers. The script validates the profile and prints the seeded logins.
- Everything trade- or locale-specific moved into `src/db/seed/profiles/` (types, the
  `default` profile and the three trades). `buildPlan(profile)` is pure; fragments read
  their copy from `ctx.profile`. Without `--profile` the mixed Acme demo is byte-identical
  (plan hash pinned in `tests/db/seed-profiles.test.ts`, which also checks totals, price
  book coverage and cross-trade leaks for each profile).

### QA round 2 (2026-10-17)
Six testers (tech day, office chain, admin, design, security, engines) filed about 150
findings; nine fixers and an integrator closed them. Highlights by area:

**Access and security**
- A page you can't open now shows a clean "You don't have access" screen inside the app
  (no crash card, nothing in the server log); exports and NACHA files answer 403.
- Techs only reach what they work on: payments, collect, part lines, tasks, timelines,
  templates, call logging and statements are checked against the tech's own jobs and
  customers (no pairing your job with someone else's invoice, deposit or customer).
- Outside a job's contact window (from 2 h before the visit until a day after), techs see
  a masked street ("••• Oak St"), phone ("•••• 0100") and email on customers, jobs,
  schedule, documents and search. Calls outside the window are blocked (there is no
  routed-call bridge yet).
- Uploads are bound to the job and entity they were requested for and re-checked when
  they complete; public signature uploads are capped per link; signatures must use a
  photo from the document's own job.
- Client IPs for rate limits and audit come from a trusted-proxy setting (`TRUST_PROXY`,
  `cf-connecting-ip` / `x-real-ip`), never the spoofable leftmost `X-Forwarded-For`.
- Payroll CSV cells can't start a spreadsheet formula; push subscriptions only accept
  known push services and never move to another user; the review link must be https.
- Production refuses to start without `SESSION_SECRET`; `/api/health` lists missing settings.
- Receipts (verification pass): a receipt must be your own upload (staff who approve
  reimbursements may attach anyone's), a receipt or document, and not already on another
  purchase, fuel log, service record or tool maintenance entry. A file that belongs to
  another record is never re-filed. The same file uploaded again (matching hash) goes to
  review ("Same receipt as another claim") instead of auto-approving.
- Upload targets: every entity type has an explicit rule and anything else is refused,
  including tool checks (the auditing tech or a reviewer), vehicle logs, purchases,
  disputes and payments. Tool and vehicle actions only use photos the person uploaded.
- Upload integrity: `/complete` refuses a file whose stored size or SHA-256 differs from
  what was presigned and deletes it. S3/R2 PUTs carry a signed `x-amz-checksum-sha256`
  (`S3_CHECKSUM=off` for a store that rejects it). `media.sha256_stored` is the server-side
  hash, or empty when storage can't verify it.
- Message threads, job messages and inbox previews hide house numbers, phone numbers,
  emails, gate codes and links from a tech outside the customer's contact window.
- `docs/DEPLOY.md` and `.env.example`: an app exposed directly, with no reverse proxy,
  must set `TRUST_PROXY=0`.

**Money**
- A partial refund on a paid invoice no longer "un-pays" it: the refunded amount is posted
  as a credit note, the invoice stays paid, the tech keeps the tip and commission is scaled
  to what was kept. A full refund still re-opens the invoice.
- Refunding a tipped payment never re-opens more than the invoice amount
  (`invoice_balances` caps each payment's refunds at its amount: migration
  `drizzle/0003_invoice_balances_tip_cap.sql`).
- Stripe: a checkout that reports before its payment intent books the tip as a tip, never
  overpays the invoice, and the card details fill in later.
- Completing a job with no line items leaves the invoice as a draft (the complete sheet
  warns "No items on the invoice yet") instead of issuing a paid $0 invoice.
- Deposit rules ("total ≥ $X") are re-checked whenever a not-yet-started job's draft
  invoice lines change (new event `invoice.lines_changed`), when its invoice is issued or
  revised, and on confirm or reschedule.
- Payroll: W-2 minimum-wage and overtime top-ups land on the statement being approved;
  recomputing a locked job no longer posts the adjustment again; the NACHA date defaults
  to the next business day; pay stubs show YTD and adjustments.
- Money fields start empty instead of "0.00", select on focus and refuse a third decimal;
  a $0 discount line can't be saved.
- The printed invoice's pay QR is one stable link per invoice that lasts until 30 days
  after the due date, instead of a new link on every print.
- Stripe card payments store a card fee estimate (Payments settings
  `card_fee_estimate_bps` / `card_fee_estimate_fixed_cents`, 2.9 % + 30¢ by default),
  so commission is net of the fee from the start. The `stripe_fee` worker then fetches
  the actual fee and emits the new event `payment.fee_updated`, and payroll recomputes
  once (a locked job gets one adjustment).
- The same worker fills in the card details (brand, last 4, fingerprint, AVS/CVC, 3DS,
  wallet, auth code). Real webhooks only carry the charge id; a string `latest_charge`
  is handled throughout.
- Invoice and portal money lines always add up to the balance. A refund line shows
  only the invoice part. A new "Tips (not part of the invoice)" block under the balance
  lists tips paid and any tip refunded.
- A payment counts as Refunded only once the tip is back too. Until then it is
  Partially refunded.
- A deposit request created by a rule is canceled (shown as Expired, with its queued
  request texts canceled and an audit entry) when the job no longer matches any
  deposit rule, e.g. after the line that triggered it is removed. A deposit asked for
  by hand stays.
- The tech daily agenda is keyed by the day it is sent, so a late-evening run and the
  00:05 run no longer schedule two agendas.
- Payroll period close, the settlement review deadline and reminder sends use the
  cron tick's clock.
- The collect sheet says "Record $61.29 by Zelle" instead of the raw method name.
- "Refund now" on a card payment is disabled when the payment processor isn't
  connected; you can still promise the refund by a date. The server answers in plain
  words and never shows a key name.
- Approving an estimate on a job booked from a lead replaces the "Price quoted on the
  lead" placeholder line on the draft invoice, so the customer isn't billed the quote
  plus the estimate. A quote line someone edited stays, and issued invoices are never
  changed.
- Invoices are overdue only from the day after the due date, counted in the company
  time zone. A "Due on receipt" invoice shows "Due today" the day it's issued instead
  of "Past due". One shared rule (`invoices/math` `isOverdue` / `daysPastDue`) drives
  the invoice page, portal, list, badge, statement, insights, the daily digest and the
  overdue reminders.
- "Request deposit" is offered while a job hasn't started (or is on hold) and has no
  issued invoice; a draft invoice no longer hides it. The server refuses once the
  invoice is issued.
- One office deposit request sends one deposit text. The built-in "Deposit request"
  automation now only texts deposits the rules ask for (`deposit.required` carries
  `office_request` for office requests).
- The job's Balance card shows Paid (payments net of refunds) and Credits on separate
  rows.
- Payroll settings: the NACHA export switch has a visible label, and the hour fields
  show an error on bad input instead of silently saving 0.
- Discount lines no longer read "Discount · Discount".

**Leads and customers**
- Creating a customer no longer fails on the duplicate check.
- A form posted without the embed's timestamp (blocked script, plain HTML) goes to
  "Check", not Spam; a tampered or too-fast one is still spam. API callers always get the
  same `200 {"status":"received"}`.
- ⚖️ Merging customers keeps SMS consent and opt-out history; the stored consent text
  includes the company name and the page the form was on.
- Forms keep what you typed when validation fails; State defaults to the company's state.
- A lead's quoted price becomes the first line of the job's draft invoice; starting a draft
  estimate no longer marks the lead Booked (sending or approving it does).

**Messages and automations**
- "We tried to reach you" texts stop once the lead responds or a call connects; the
  after-hours auto-reply is cancelled when the lead is booked.
- Booking, reschedule and 24-hour reminders check that the appointment is still ahead and
  not finished before they go out.
- Review requests skip disputed jobs, old completions and jobs that are closed but unpaid.
- Staff reminders are no longer dropped because the person who triggered them is the
  recipient (that skip now applies only to instant notifications).
- The composer only offers templates that fit the conversation; links in queued texts use
  the current `APP_URL`; templates are checked for unknown variables when saved.
- Built-in automations and templates that nobody has edited now follow the shipped
  definitions on every start (see "Upgrading" below).

**Tech app**
- The job dock is compact: one "Photos" chip opens the camera sheet, and the page pads
  for the dock. The camera works after an offline reload; checklist photos keep their tags.
- Completing shows a recommended before/after photos row; the signature summary lists the
  line items and total; the cash Done screen stays up for the receipt choice.
- The tracking link (`/t`) keeps working after arrival ("Your technician has arrived") and
  shows times in the company's time zone.
- With AI off, odometer readings with a photo are approved automatically (anomalies still
  go to review), for any tech allowed to log them. The copy says so.
- Verification pass: after a paid-in-full collection, Done shows the next action (Next job or
  Back to Today) without a reload, and all dock tiles are the same width. The Complete sheet
  ticks "Before and after photos" as soon as they upload, its camera offers only the tags
  that count, and the sign-off button sits under its label, so nothing truncates at 390 px.
- Checking in your own tool goes back to your tools list ("Checked in") instead of "Page not
  found". The location-sharing dot sits on the tab bar's corner (the account row on
  desktop), so it no longer covers a row's right edge.

**Look and feel**
- Large titles stay pinned; pushes and pops animate at once (router cache
  `staleTimes.dynamic = 30`, CLAUDE.md amendment 7); loading skeletons show the real title.
- ⌘K / Ctrl+K opens global search from anywhere.
- Phone numbers display as "(512) 555-0100" everywhere people see them.
- Tap targets of at least 44 pt, sentence-case buttons, no truncated money in stat tiles,
  segmented controls with more than five options become chip rows, print pages hide app
  controls, friendlier validation messages.
- Verification pass: the Outbox, live map and clock card hydrate without React error #418
  (relative times start from the server's clock). `/pay/*` screens entered from elsewhere
  show their own loading title ("Payroll", "Statements"). Alerts are `role="alertdialog"`;
  customer money tiles share one format; printing at desktop width uses the whole page; a
  pop covers the strip under the tab bar. Phone fields read a leading 1 as a country code
  only at 11 digits ("123" stays "123"). The `/insights` tab title matches its large title
  ("Home" for admins). Branding's hex and Compliance's quiet hours show their inline errors.

**Final polish (re-check)**
- Settings forms keep what you typed when a save fails (Compliance, Company, Profile, Taxes,
  team sheets…: `useActionForm` submits through `onSubmit`, so React no longer resets the
  form); the vehicle form too. Quiet-hour fields and Branding's color well stay in line
  while an error shows.
- "New vehicle" with "Assigned to: Unassigned" saves (empty selects mean none in vehicles,
  tools, payments and messaging actions).
- The pay page `/p` shows the invoice's own totals (subtotal, discount, tax, total, each
  payment, credit and refund) down to the balance due, the same rows as the invoice.
- A deposit request is closed (status waived, "covered by $X paid on INV-…") once payments
  on the job's invoice cover it; its pay link is revoked and its queued texts are canceled
  (`deposit_covered_by_payments`). Paid deposits are never touched.
- Job risk is recomputed whenever a draft invoice line changes, so removing a line brings
  the band back down. Completion controls never drop below the band the work started under.
- A lead with no phone or email (an empty JSON body) is kept as spam and never notifies;
  the API still answers 200 `{"status":"received"}`.
- Sentence-case tab titles ("New customer", "Price book", "Time clock"…) and upload labels
  ("Upload logo", "Upload photo").
- Dev data safety: PGlite is closed on SIGINT/SIGTERM (Next's own shutdown waits for it)
  and on `beforeExit`, so a stopped `next start` leaves a cleanly closed data dir.

**Demo seed**
- Jobs spread across 39 of 40 customers; nothing that "already happened" (payments,
  status changes, logs) is dated after the seed's clock (`ctx.atPast` / `ctx.past`).

**Upgrading an existing database**
- Run the app once (or `npm run db:migrate`) to apply `0003_invoice_balances_tip_cap.sql`.
- Built-in automations and templates: on every start the base seed brings rows that no
  person has edited (`updated_by` is empty) to the shipped definition (trigger, conditions,
  steps, cancel rules, text, expiry, on/off). Rows an admin edited, toggled or reset keep
  their settings; a template's "Reset" text (`default_body`) and `purpose` always follow
  the shipped catalog. Send-time checks (consent, eligibility, expiry) protect old rows either way.

**Owner decisions to confirm**
- Techs can't call a customer outside the contact window; the SPEC's routed call doesn't exist yet.
- A lead form left open more than a day lands in "Check", not Spam.
- Odometer readings auto-approve with a photo when AI is off, for any tech who may log them
  (not only `vehicles.log_trusted`).
- Cash or check receipts name the collector (" to Mike") only when a field tech took the money.

**Not fixed this round:** T4-35 (desktop split view for `/jobs`).

**Contracts and internals**
- `invoices/api#createCreditNote(tx, { invoiceId, amountCents, reason }, actor)` replaces B4's
  temporary credit-note writer; `invoices/api#emitLinesChanged`.
- `src/lib/mask.ts` (`maskPhone`, `maskEmail`, `maskStreet`) is shared by customers, jobs and
  documents; `vehicles/api#odometerApprovalHint` feeds the clock-in odometer sheet.
- `src/lib/mask#redactMessageText`; `parts/server/purchases#assertReceiptMedia`;
  `src/lib/uploads#verifyStoredUpload` (also used by public signature uploads). Storage
  adapters take `presignPut(…, { sha256 })` and gain an optional `sha256(key)`; upload tokens
  are `v3` (binding `sha256Stored`), and v2 tokens still complete.
- `src/lib/tokens#mintOrReusePublicToken`, `src/lib/client-ip`, `src/lib/phone-display`,
  `src/lib/zod-messages`; `ForbiddenError` carries Next's `forbidden()` digest
  (`experimental.authInterrupts`).
- `invoices/money-lines#invoiceTotalRows` (invoice document, job invoice panel, `/p`);
  `payments/api#settleCoveredDeposits`.
- Checks: typecheck and lint clean; 86 test files / 1,236 tests pass. Build passes; shell
  149.9 KB gz (see `docs/budget.md`).

### Integration: all modules live (2026-10-15)
- Eight builder groups (B1–B8) landed every MVP module; no stubs, `SlotPlaceholder`s or
  `SHIM(...)` blocks remain in `src/` (the dev gallery keeps its placeholder demo).
- Migration `drizzle/0002_integration.sql` (one migration for every builder schema request):
  - `leads.custom` (lead custom-field values; older rows' `extra.custom` still reads)
  - `scheduled_messages.vars` and `.meta` (caller variables rendered at send time; manual override flag)
  - `estimates.service_type_id` and `.photo_media_ids`
  - `service_records.odometer_reading_id`
  - `users.bank_holder_name_enc` (NACHA receiver name)
  - 31 indexes requested by B1, B4, B6, B7 and B8
- Contract changes:
  - `customers/api#incrementWaivedFeeCount` (used by the job cancel flow)
  - `createInvite(…, { emit: false })` for seeds
  - QR encoder moved to `src/lib/qr.ts`; the collect sheet now shows a pay-link QR
  - `/jobs?depositDue=1` filter, linked from the Ops board
  - B7 media attach goes through `media/api#attachMedia`
  - approvals `ApprovalKindDef.editFields?`/`href?` (B6, additive)
- Offline: `src/client/offline-registry.ts` statically includes every module's
  `offlineActions`, so queued actions replay from any page.
- Fixes found at integration:
  - `npm run seed:demo` crashed under `tsx --conditions=react-server` (`payroll/api.ts` imported `@/lib/auth/current` → `next/navigation`); it now uses `can` from `@/lib/permissions`
  - `/time` 500: a server page called a helper exported from a `"use client"` file; it moved to `src/features/time/format.ts`
  - the demo seed no longer emits `customer.updated` or `user.invited`
- Demo seed: about 4 s on PGlite, refuses a second run, `--reset` works; `/approvals` shows 6 kinds.
- Build: production build passes. Shell 147.8 KB gz; 12 routes are over the 30 KB route budget (see `docs/budget.md`).
- Tests: 936 passing (55 files). Lint clean (`public/embed.js` is generated and is now ignored by Biome).

### F5: foundation review (2026-10-15)
- Security: `formDataToObject` drops `__proto__`/`constructor`/`prototype` field names
  (prototype pollution from the unauthenticated auth forms); `?next=` goes through
  `safeNextPath()` (`src/lib/auth/safe-next.ts`, blocks `/\t/evil.com`-style open
  redirects); sign-out now clears the `__Host-sid` cookie (the bare delete lacked `Secure`);
  password-reset lookup and email run in `after()` (no account enumeration by timing);
  S3 presigned PUTs sign `Content-Type`, signed GETs pin `response-content-type`, and
  `/api/uploads/complete` rejects oversized objects; push endpoints must be https;
  baseline headers (`nosniff`, `Referrer-Policy`, `X-Frame-Options`/`frame-ancestors`
  except `/f/*` and `/_next/*`).
- Fix: `src/client/upload.ts` sent snake_case bodies and a duplicate `Content-Type`
  header, so every upload failed (400). It now sends `PresignRequest`/`CompleteUploadRequest`
  from `src/features/media/contracts.ts`. Presign accepts optional `originalMime` (HEIC
  original next to a WebP main file). `/api/push/subscribe` accepts `{ subscription }`.
- Fix: `processEvents()` pages with a keyset cursor, so 100+ events in backoff no longer
  starve newer events.
- Bundle: Motion is no longer mounted globally (`MotionProvider` is opt-in per component),
  and the "+" menu icons render on the server. `/today` drops from ~208 to ~167 KB gz.

### F4: integration (2026-10-15)
- Root layout: Appearance cookie → `<html data-theme>`, server-rendered brand accent
  (contrast-safe `--accent-text`, `src/lib/branding.ts`), company-name metadata, toast and
  motion providers, service-worker registration (production only). Everything renders at
  request time (`dynamic = "force-dynamic"`), so the build never touches the database.
- Auth pages: `/signup` (first run creates the company and admin: company name, trade,
  time zone, state; afterwards invite-only, or "request an account" with open signup),
  `/login` (remember me, `?next=`), `/invite/[token]` (monitoring notice for techs, e-records
  consent), `/reset` and `/reset/[token]`. Signing in lands on the role home: `/insights`
  for admins, `/today` for office and techs.
- Signed-in shell: role tab bars and desktop sidebar from the module manifests (permission
  and flag filtered), badge counts, offline banner, install prompt, outbox auto-flush,
  cron piggy-back, global "+" create menu (context-aware) and notification bell, `/more`
  (grouped list, Appearance, Install app, Sign out), `/settings` index, error boundary and
  not-found page.
- Placeholder pages for every authenticated route (90, list and detail routes with loading skeletons) and every
  public route; `/privacy` and `/sms-terms` render the published policy texts.
- Stubs for all 56 cross-module UI slots (S1–S56) at their contract paths.
- `src/features/_template/`: a complete reference module (queries, actions, components).
- PWA: `manifest.ts`, generated icons, hand-written `public/sw.js`, `/offline`.
- `next.config.ts`: headers for `/sw.js` (no-cache, CSP) and `/embed.js` (1 h cache).
- npm scripts `build:embed`, `export`, `import:csv`, `restore` (owner stubs) and `gen:vapid`.
- Docs: `CLAUDE.md`, `README.md`, `.env.example`, `docs/DEPLOY.md`, `docs/MODULES.md`,
  `docs/budget.md`.

### F3: design system
- iOS component kit (`src/ui/components`), motion layer, client utilities, `/dev/ui` gallery.

### F2: backend core
- Auth, permissions, `action()`, events outbox, settings/flags/nav, adapters, cron, uploads,
  module manifests and contract stubs, demo seed.

### F1: scaffold and database
- Next 16.4 / React 19.3 scaffold, 107 tables in Drizzle, migrations, PGlite/Postgres connection.
