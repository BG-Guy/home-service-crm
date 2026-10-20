# Changelog

## Unreleased

### Design refresh v2 (2026-10-19)
Spec: `docs/DESIGN.md`. CSS and markup only; no new dependencies, no new client JS in the shell.

**Tokens and primitives (F1)**
- New tokens: calm canvas `#f5f5f7`, `--hairline`, `--field` (input fill), `--danger-text`,
  `--shadow-raised`, `--radius-modal` 24; cards radius 20; gutter 16 / 24 / 32; section gap 28;
  rows 52 (44 dense). Type scale carries weights and tracking (`text-title1` is 700 / -0.02em),
  body 17/24, new `text-page-title`. Dark mode: true black, raised gray cards with hairlines.
- Status text is AA everywhere: per-tone `--ink-*` shades on soft 12% tints (`toneStyle()` sets
  `--tone-ink`), and `text-success` / `text-warning` / `text-danger` now use them too.
- Button: `primary` / `secondary` / `tinted` / `plain` / `destructive` (legacy `filled` and `gray`
  still work), a `destructive` role for red text on any variant, `block`, a loading state that
  keeps its width, and `loadingText`. IconButton shares the variants (`secondary` = neutral
  circle) and sizes 30–56.
- Lists: `ListSection variant="title" | "caption"` (no more uppercase headers), new
  `SectionHeader`, 52 px rows with tinted 32 px icon tiles, `bold` and `dense` rows.
- New `Card`, `TripTimeline` (Uber-style trip progress) and `SuccessCheck` (M10).
- `ChipRow` scrolls with snap and edge fades (`sticky` option); selected chips are ink-filled.
  SearchField is a 44 px pill; fields are filled 48 px with a focus glow and an error shake.
- StatusPill pulses its dot for live states (job on the way / in progress); Badge `pop`;
  Avatar gradient and presence ring; TechCard driver card (ETA, vehicle, call / text);
  StatCard delta chips; EmptyState tinted icon circle; Skeleton shimmer.
- Motion utilities: `.pressable` (M9), `.hover-lift` (M16), `.live-dot` (M12), `.shimmer`
  (M13), `.disclosure` (M15), `.badge-pop` (M11). First-paint entry (`enter-fade-up`, used by
  the login card and M8) starts at opacity .5, never 0, so pages report a real FCP / LCP.

**Shell, navigation, overlays and motion (F2)**
- Motion tokens 120 / 220 / 320 / 400 / 480 ms and `--ease-out`; the `linear()` springs are
  generated from the JS driver (`src/ui/motion/easing.ts`), with a consistency test.
- M1 push / pop 400 ms (was 675) with a left-edge shadow, pages clipped to their column; M2 tab
  bar / sidebar cross-fade 160 ms (`TabLink`, `NAV_TAB`); M3 `Morph` shared elements.
- Sheet: 320 ms spring, iOS card stack behind the large detent, desktop modal (≥ 768 px or a fine
  pointer) and `presentation="drawer"`; `desktop="panel"` still works.
- M5 pop-ups grow from their trigger: the "+" menu (no Sheet any more), the desktop ActionSheet,
  ContextMenu (`MenuPopover`). M6 alert: glass, pill buttons on the contrast-safe fills. M7 toast:
  phone island, desktop card, drawn success check; no icon modules in the toast host.
- Tab bar: opaque glass capsule (the view-transition name moved to the capsule; on the `<nav>` it
  made the blur see nothing, which is why page text read through), sliding accent pill, icon
  bounce. Nav bars turn to glass once scrolled; long titles no longer slide under the trailing
  buttons. Sidebar: soft-card selection, 36 px items, quiet labels.
- New `BottomBar` / `BarSummary`, `DetailLayout`; content max width 1200; new-look
  `ListLoading` / `DetailLoading` (`rail`); `.enter-stagger` (M8); install hint is a floating nudge.
- Shell JS 149.6 → 139.2 KB gz (framework + layouts): outbox, upload client, sync capsule, install
  prompt and location pill load after idle; skeleton header without NavBar; lucide runtime once in
  the root chunk. 104 of 142 routes have a lighter first load.

**Screens: jobs, schedule, map, tasks (B)**
- Job detail: a hero card (live status, title that morphs from the list row, customer and
  address with a round Directions button, window, technicians), in-page tabs with a sliding
  underline, and `DetailLayout`. Desktop (≥ 1200): a sticky right rail with the action card, a
  trip-style progress timeline, the money summary and tech cards; the centered floating dock
  is gone. Phone: the dock is a sticky booking bar (tool tiles, a summary such as "3 to do" or
  the balance on the left, the one primary on the right). Office users without the field dock
  get the bar for their next step (Collect a balance, Schedule an unassigned job).
- Jobs list: sticky search pill and status chips, sticky day headers with counts, rich rows
  (bold title, time column, status, avatars). `JobRow` carries the `job-<id>-title` /
  `-status` morph names (`morph={false}` to turn them off).
- Schedule: soft blocks with the lead tech's color on the edge, a red now-line with a time
  pill, sentence-case queues; phone tech lanes with the same edge; day switching slides.
- Map: phone is a full-bleed map with a bottom sheet of techs and jobs that slides up over
  it as you scroll (no drag code); desktop keeps the side panel. Leaflet stays lazy.
- Tasks and new job: title sections, the task sheet loads on first tap, the new-job submit
  is a sticky booking bar.
- Speed: /jobs/[id] route JS 89.6 → 56.6 KB gz from these changes (17.2 with the other
  modules' slot splits that landed alongside). The camera / photo sheet, signature
  sheet, More menu, office menu, checklist, notes, photo gallery and other modules' slot
  buttons load on first use or where they render; the media slots and the portal job
  actions are split into their own chunks; the dock warms the next step's sheet when idle.
  /tasks 26.6 → 12.5, /schedule 24.3 → 8.7, /jobs 18.9 → 11.9, /map 29.0 → 18.8.

**Screens: customers and sales (C)**
- Customer detail: profile header (88 px avatar and name that morph from the list row, type,
  phone, flags and tags), a row of round quick actions (Call, Text, Email, New job as the one
  filled circle), neutral pills for Estimate / Statement / Record payment / Ask for a review,
  three stat tiles (lifetime, balance, jobs) and bold section titles. Merge lives in the "…" menu.
- Leads: inbox cards lead with an SLA ring (fills toward the 15-minute mark, green / amber /
  red, the wait inside), the quote on the right, Call / Text / Book and Claim; the name morphs
  into the lead hero (`lead-<id>-title`). Lead detail: a hero card with the ring, status and
  round Call / Text / Book / More (Call filled while new, Book once contacted); "Text them" is a
  pill that loads the composer on first tap.
- Estimates and invoices: `DetailLayout` with the one primary (Send / Issue invoice / Collect)
  in the booking bar on phones and the first rail card on desktop; hero shows the number
  (`estimate-<id>-title` / `invoice-<id>-title` morph from the lists), status and the amount.
  Line editor: title header with an item count, tabular amounts, a larger total. Lists use
  bold section titles and semibold tabular amounts. Payments, disputes, reviews: title
  sections, no uppercase labels left in C's files.
- Speed (route JS, gz): /customers/[id] 78.5 → 24.3, /leads/[id] 56.5 → 27.8, /invoices/[id]
  53.1 → 25.7, /estimates/[id] 52.9 → 23.0, /leads 29.7 → 16.3, /payments 26.7 → 18.8. Every
  sheet (edit customer, address, call outcome, lost, convert, lead edit, line, price book,
  invoice send / revise / void / credit, estimate builder sheets, payment collect / record /
  receipt flag, dispute "why" and evidence picker) loads on hover, focus or first tap; the
  customer-page slots moved to `*/customer-slots.tsx`, and the job-page slots render
  `next/dynamic` islands (`*/components/islands.tsx`).

**Screens: customer pages, auth and documents (D)**
- Auth: desktop split layout (accent-gradient brand panel, CSS only) beside the form; phone stays
  one column. Login paints on the first frame (FCP / LCP 380 ms cold, was none recorded).
- Public header: monogram, name and a round call button. `/t`: Uber-style ETA hero ("Luis is on
  the way", minutes tile), the driver card and a `TripTimeline`; StaticMap gets a live tech dot,
  a destination pin and a fade into its card (`flush`). Done states use `SuccessCheck`.
- `/e`: good / better / best option cards (the chosen one expands its lines, M15), an edge
  booking bar "Total · Approve", "Not right now? Decline" as a plain link. The signature and
  decline sheets are lazy chunks loaded on intent (route JS 22.0 → 11.4 KB gz).
- `/p`: checkout summary with a large amount and an ink-filled tip picker; the paid screen uses
  `SuccessCheck` (no more opacity-0 `enter-pop`). `/i`: amount-due card over the paper invoice;
  the receipt's flag button loads after hydration (route JS 36.6 → 9.8 KB gz). `/j`: status hero
  with a live pill, tinted document rows (route JS 34.9 → 10.9 KB gz with B's lazy sheet).
- `/r`: 44 px stars that pop in sequence (M11), `SuccessCheck` on thanks. `/f`: a three-step
  form (service chips, details, contact) driven by CSS `:has()` with no page JS; every field,
  the honeypot, the signed `_ts`, consent text and attribution inputs are unchanged, Enter can't
  submit an earlier step, and with Turnstile (or without `:has()`) it stays one page.
- InvoiceDocument / EstimateDocument: no uppercase labels, field-filled totals and notices,
  ringed option blocks; fixes "Co.." when the company name ends with a period.
- Removed the unused `src/app/_components/OutboxAutoFlush.tsx`.

**Screens: Today, tech app and dashboards (A)**
- Tech Today: greeting title; a slim clock line (live dot, "On the clock · 2 h 14 m", Break) or
  one "Clock in" hero when off the clock (the job button steps down to tinted then); an
  Uber-style job hero (`NextJobHero`: live pill, title with the `job-<id>-title` morph, window,
  customer and address, ONE primary next step, call / text / navigate as round icon buttons;
  Navigate is no longer a second filled button); a summary strip (jobs done, earned today via
  the new `getDayEarnings` in payroll/api, cash held → hand in); today's route as a
  `TripTimeline` (no morph names); no uppercase labels.
- Office / admin Today: greeting; KPI row (jobs ring, new leads with the oldest wait, overdue AR,
  approvals); a "Techs today" strip (avatar with clocked-in ring, a segment per job, now/next;
  `getTechDay` in insights/ops); a "Needs attention" feed with a verb per row; two columns at
  ≥ 1280 px. The setup checklist is a small progress card (`9/13`, Continue, steps in an M15
  disclosure; `SetupChecklistCard compact`).
- /pay, /time, /more, /today/finish, insights blocks: title sections, tinted icon tiles, period
  hero card; Clock out is a primary (red fill stays for confirms).
- Speed: client islands load as their own chunks (`tech/components/islands.tsx`,
  `insights/components/islands.tsx`, `payroll/components/islands.tsx`), so techs don't ship the
  ops board and the office doesn't ship the tech app; the time-entry sheet loads on first open;
  Today reads the outbox count through messaging/api instead of the slot module. Route JS gz:
  /today 44.4 → 5.6 KB, /today/finish 32.2 → 7.7, /insights 26.2 → 9.0, /pay 5.1. Tech
  /today cold JS on the wire 364 → 303 KB, same FCP / LCP.

**Screens: settings, team, messages, fleet and tools (E)**
- Settings: the index shows a company card above the search; tiles are tinted with AA ink (they
  were white glyphs on 12% tints). The desktop settings column marks the current page with a
  card instead of an accent fill. Settings forms end in a sticky save bar (`SaveBar`, on
  `BottomBar`) that says "Unsaved changes" or "All saved"; `StickySave` uses it, and the
  messaging, vehicle, tool and parts settings forms now have it too.
- Messages: thread rows read like iMessage (48 px avatar, bold name, time on the name line, a
  wide preview, an accent badge for waiting texts). The thread composer is a pill with a round
  send button inside it, a channel switch button and Cmd/Ctrl+Enter to send, pinned to the
  bottom of the screen; upcoming sends are dashed "scheduled" cards.
- Team member: round labeled Call / Text / Email actions. Vehicle quick tiles use tinted icons
  (the solid green and orange circles had white glyphs under 3:1); the inspection "problem"
  toggle uses `bg-danger-fill` (it was white on #ff7c75 in dark mode).
- No uppercase labels left in E's files (caption headers are 15/600 sentence case).
- Route JS (gz, route part): /settings/reminders 49.5 → 6.2 KB, /team/[id] 46.8 → 13.8,
  /vehicles/[id] 41.8 → 18.3, /messages 31.0 → 7.0, /team 32.4 → 18.6, /parts 32.3 → 14.6,
  /tools 29.6 → 21.3, /approvals 23.4 → 15.7. How:
  - Sheets load on first open (their code is fetched on hover or press): reminder editor, member
    edit, reset link, role picker, invite, trip, reminder rule, resolve issue, new message,
    bulk text, new receipt, vehicle "More" menu.
  - `RECURRENCE_LABELS` moved out of the zod module (it pulled zod into the reminders page).
  - notify `ActivityFeed` / `PrefsForm`, and the client islands of the messaging, parts and
    vehicles slots, are `next/dynamic` (SSR on). Turbopack ships every client module a page can
    reach, so the notification bell had put the activity feed and the preferences catalog on
    every route.

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
