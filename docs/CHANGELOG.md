# Changelog

## Unreleased

### Miles between a tech's stops (2026-10-23)
- **Route maps** (Assign hub, schedule map): each leg long enough on screen carries its
  straight-line miles in a small pill on the line, turned along it (never upside down), with the
  direction chevron moved a third of the way in. Faded routes and the busy overview (more than 3
  routes in focus) get arrows only (`drawArrows` in `src/features/map/route-draw.ts`; the CSS
  ships in the map chunk's `ROUTE_CSS`).
- **Route timelines:** `TripStep.miles` (`TripTimeline`) shows the leg's miles against the line,
  halfway to the next stop, on the Assign hub's day route and the tech's Today's route. The
  schedule map's timeline strip shows them on a dashed connector in the gap between two bars.
- `src/lib/geo.ts`: `milesBetween` (moved from `dispatch/recommend.ts`, which re-exports it),
  `formatMiles`, `legMiles`. `JobListItem` gains `lat` / `lng`, filled only when the viewer may
  see the address, so a masked stop has no miles. Tests: `tests/lib/geo.test.ts`.

### Demo quick sign-in (2026-10-23)
- The three demo businesses (`npm run demo:businesses`) show one-tap **Admin / Office / Tech**
  buttons on the login page, so nobody types the demo password. They sign in as the first active
  user of each role through the normal `login()` (password check, throttle and audit intact):
  `demoLoginAction` (`features/auth/actions.ts`), `src/lib/auth/demo-logins.ts`,
  `(auth)/login/DemoLogins.tsx`. On only when `DEMO_LOGIN_PASSWORD` is set, which only the demo
  script does; never set it on a real deployment (docs/DEPLOY.md).

### Leads flow redesign (2026-10-22)
Design review "Making the leads flow feel like Life360": ten proposals and twelve smaller fixes,
each marked Build it, Later or Skip by the owner. This is everything marked Build it, with the
options the owner chose; the skipped items are listed at the end.

**Job types: three cards with the trade's jobs under them**
- Two levels wherever a job type is picked (the caller form, booking, New job): **Free
  estimate** (45 min, no deposit, ends with an estimate), **Service call** (90 min, repair
  rules) and **Project** (240 min, deposit rules, `contractKind: "improvement"`). The old generic
  types are retired; existing jobs keep their history. The trade's own jobs (Lockout, Rekey,
  Car key…) are `service_types` rows with a `kind`, shown as "What's the job?" chips under their
  card, and keep their rules (price, length, photos, checklist, warranty).
- `src/features/jobs/kinds.ts` (client-safe, no imports): `JOB_KINDS`, `KIND_LABEL`, `KIND_HINT`,
  `KIND_ICON`, `KIND_COLOR`, `KIND_DEFAULTS`, `splitByKind`, `primaryTypeId`. Each kind has its
  own row (the "primary": the row named like the kind), which a booking uses when no trade job
  is picked. `zJobKind` in `@/db/enums`; `listServiceTypeOptions()` (`jobs/service-types.ts`) →
  `ServiceTypeOption` (`jobs/contracts.ts`).
- ⚖️ The lockout proof-of-ownership check is kept: `requiresOwnershipCheck` and the "Ownership
  check" checklist stay on Lockout, After-hours lockout, Car key and Safe opening (locksmith and
  the mixed demo), and booking one says "<Job> keeps the ID and ownership check".
- The maintenance reminder is dropped: the field is gone from Settings, nothing writes
  `maintenance_interval_months` (0006 cleared it), so the built-in `maintenance` automation
  never fires.
- Settings → **Job types** (`/settings/services`, renamed from Service types): the three cards
  with their defaults row and the jobs under each, the per-job rules, the ⚖️ ownership switch
  and the contract type, a kind switch that moves a job to another card, archive and restore.
- Migrations: `0005_job_kinds_scheduling` (`service_types.kind`, `users.work_hours`, the
  `time_off` table) and `0006_job_kinds_data` (data only, for databases seeded before it):
  "Estimate visit" → Free estimate, "Service call / …" → Service call, "Installation" → Project
  (improvement contract), Repair and Maintenance archived (techs with those skills get the
  Service call skill), every other row a service call unless it is clearly an install or a
  project. Nothing is deleted.
- Seeds: the base seed writes Free estimate, Service call and Project only; each demo profile
  seeds its trade jobs (`settings.tradeJobs`). The mixed demo's plan hash changed on purpose.

**Working hours, time off and booking settings**
- Team member page (`/team/[id]`, techs, `users.manage`): **Working hours** (the business hours,
  or each weekday on or off with a start and end; `users.work_hours`, null = business hours) and
  **Time off** (whole days or part of a day, in the company time zone; removing asks first).
  Actions in `team/schedule-actions.ts` (audited `user.work_hours_updated`,
  `user.time_off_added`, `user.time_off_removed`), reads in `team/schedule-queries.ts`, pure
  helpers in `src/lib/work-hours.ts`.
- Settings → Jobs & scheduling → **Booking**: Jobs per tech a day (`jobs.daily_job_cap`, 6), Far
  jobs (`jobs.max_extra_miles`, 25) and Book after hours (`jobs.after_hours_booking`, off).
- Demo techs work Mon–Fri 8–5 (set explicitly); office and admin follow the business hours.

**The real availability engine**
- `jobs/availability/engine.ts` (pure, golden-tested in `tests/golden/availability.test.ts`)
  replaces the mock. `index.ts` loads the whole range in one batch of queries (about 6 ms for
  28 days on the locksmith demo).
- A 2-hour arrival window is open when at least one tech fits:
  - works then (their hours minus time off)
  - has the skill (a tech with no skill list takes any job)
  - is under the daily cap
  - fits the route: the Assign hub's `recommendTechs` places the job with no overlap, and the
    new `arrivalFit` (`dispatch/recommend.ts`) checks the drive from the previous stop
    (straight line, 30 mph), an arrival before the window ends, the whole job inside their
    hours and clear of time off, and no later job pushed past its own window.
- The owner's choices: one cap for everyone (6 jobs); far jobs are hidden (more than 25 extra
  miles for every tech who fits, or a ZIP outside the service ZIPs); weekends and evenings stay
  closed unless a tech is set to work them; after-hours booking is off by default (the office
  books emergencies by hand on New job).
- Booked jobs with no tech yet still take room (each is placed with the tech the hub would
  rank first). Today, windows that already started are closed and the earliest arrival is 30
  minutes away. The job's length is the trade job's, else the job type's default (45, 90 or 240).
- Day status: Open (2+ windows), Limited (1), Full (0, with a reason: closed, far, full or
  outside the service area). Best = the top 3 open days nearest the asked-for day, then the
  least extra driving.
- ⚖️ Like the Assign hub ranking, the engine never takes age or date of birth (`EngineTech` has
  no such field; a golden test checks it).
- The Assign hub's matches now respect working hours and time off too (`dispatch/work-fit.ts`
  on the availability loader's `getTechWorkDays`): a tech who is off that day, off then or on
  time off is listed last with that reason and can still be picked. `colorFor` moved to client-safe
  `dispatch/colors.ts`.

**One booking flow: Who → What → When**
- Book on any lead (phone, website, Google, Thumbtack) opens `/leads/new/schedule?leadId=<id>`.
  A phone caller starts at `/leads/new` ("New lead", was "New call"), whose main button is now
  Save & book.
- Who: the caller form fits the first phone screen (phone and name, source and quoted price,
  the verbal text consent, the address, the job type tiles; urgency, after-hours and notes
  below), and the field you're typing in stays clear of the sticky bars and the keyboard.
- What: the three job type cards (`JobTypePicker`) with the trade's jobs as "What's the job?"
  chips, then urgency, after-hours and the customer's notes (prefilled from the lead).
- When: a week strip from today (28 days, up to 60 when they asked for a later day), the
  asked-for day picked and tagged "Asked", with the best / open / limited / full dots. The day's
  2-hour windows read "Arrives 8–10 AM"; the one with the least extra driving says "Best · adds
  2 mi". A day with nothing open says why in plain words, with the soonest open day and "Book by
  hand on New job".
- No tech step: `bookLead` (`leads/booking-actions.ts`, `leads.convert` + `jobs.create`, audited
  `lead.booked`) → `createBookedJob` (jobs api) puts the window, type, priority, after-hours,
  customer notes and the asked-for day on the job and assigns nobody, so the job waits in the
  Assign hub. The lead's quoted price becomes the draft invoice's first line; a "Check" lead
  gets its customer when it is booked.
- Done shows at once: "Booked: arrives Fri, Oct 23 · 8–10 AM", "Confirmation goes out when a
  tech is assigned", then **Assign a tech** (the hub with this job picked), **Next lead** and
  Open job.
- New job (`/jobs/new`): the job type cards and chips replace the Service type select; a job
  from a lead hides Technicians and keeps the lead's job type, urgency and after-hours.
- Removed: `ScheduleFlow`, `WindowPicker` and `WindowSheet` (the month calendar and tech
  picker), the availability mock, and the kit `Calendar` with its `.cal-weekdays` rule (no
  screen used it once booking moved to the week strip).

**Leads inbox: a grid of lead boxes**
- `/leads`: phones start with 2 columns and a 1 / 2 switch remembered on the device (the
  `leads-cols` cookie, read by the server, so the grid never flashes); tablets and desktop fit
  as many columns as there's room for.
- A count line ("11 open leads · Longest wait first"), status chips with counts (New,
  Contacted, Qualified, Check while there are any, Booked, Lost, Spam; tap again for all open)
  and a Filter chip whose sheet holds Mine, Overdue and the sources. An empty inbox shows a big
  New lead button.

**The lead box in every state**
- Initials in the SLA timer ring (2-column boxes show a new lead's wait under it), the name, the
  job and status, and the street (not just the ZIP). Tapping anywhere on the box opens the lead card.
- Open: Call, Text, Directions, Open card. Check: Looks legit and Spam (booking stays allowed).
  Lost: Reopen. Spam: Not spam. Booked: Open job, and Reopen once its job is cancelled.
- Swipe left on an open lead: Lost or Spam, each with Undo.

**The lead card**
- `LeadCardProvider` / `useLeadCard()` with the lazy `LeadCardSheet`: a bottom sheet on phones
  (drag down or ✕; the page steps back behind it) and a centered sheet on tablet and desktop.
  `?lead=<id>` mirrors it, so Back closes it and a link or a reload opens it again.
- A TL;DR (name, status, job type, street, arrival window or asked-for day), then boxes: Phone
  (call, text, copy), Address (mini map, directions, copy), Wants or Arrives, Quote & source,
  Last contact, Notes and Photos; the action groups; and a booking bar with Book as the one
  primary.
- The box's data shows at once; the rest comes from the light `loadLeadCard` (`getLeadCard`),
  cached per lead and reloaded after each change.
- `/leads/[id]` stays for links and printing: the same layout, plus source and attribution,
  notes, the intake log and the activity. The list pane beside it is gone.

**Actions with their way back, and Undo**
- No "…" menu on a lead. Four groups: Reach (Call, Text, Email) · Move forward (Contacted ↔ Not
  contacted, Qualify ↔ Unqualify, Looks legit on Check leads, Book; Open job once booked) ·
  Manage (Claim ↔ Release, Take over, Edit, Tags) · Close (Lost ↔ Reopen, Spam ↔ Not spam). A
  step already taken shows its way back drawn "on". Rules in `leads/rules.ts` (golden-tested).
- Reopen and Not spam return the lead to the open status it had before (from its status
  history), not always Contacted. A booked lead reopens once its job is cancelled.
- Every change shows Undo for 5 seconds (`undoLeadChange`): each status change writes a
  `lead_events` row with what it overwrote, and Undo puts that back while it is still the lead's
  latest change. In the card the Undo bar sits above the booking bar, because toasts can't show
  over a modal sheet; one still showing when the card closes moves to a toast.
- Take over asks first and tells the previous owner; its Undo gives the lead back.

**Named create buttons**
- The header's "+" menu is gone. **New lead, New job, New customer** are named buttons, the
  page's own first: small labeled icons on phones, pills on tablet and desktop with the page's
  main one in the accent (only on its own list page). In a narrow list pane (`[data-pane]`,
  SplitView) they fall back to the icons.
- Pages with a create action of their own put it first (`HeaderActions own="…"`): New estimate
  on /estimates, Upload receipt on /parts and /pay, New tool on /tools, New vehicle on
  /vehicles. One name everywhere: "New lead", the screen too.
- The header's client island is now plain links (`CreateButtons`) instead of `AddMenu` →
  `MenuPopover`.

**Needs a tech: the hand-off to Assign**
- A booked job needs a tech when its arrival window is today or later, it isn't cancelled,
  closed or completed, and nobody is assigned (`dispatch/needs-tech.ts`). One definition for
  the new `jobs.needs_tech` badge (Assign in the sidebar and the More list; on phones the More
  tab carries it) and the Assign hub's queue.
- The hub lists "Needs a tech · N" first: every such job across all days, soonest first, with
  its day and window ("Fri 23 · 8–10 AM"). A row opens the hub on that day with the job picked
  (`hubHrefForJob`). Undated jobs are listed apart ("No date yet") and not counted. The day
  switcher moved under the queue.
- The customer's confirmation still goes out when a tech is assigned (`job.scheduled`). No
  auto-assign: the office picks the tech.

**The lead map**
- A Grid / Map switch in the inbox on phones and tablets; desktop (≥ 1024 px) shows the grid
  and the map side by side. `getLeadsMapData` (`leads/map-queries.ts`) → `LeadsMapSlot` →
  `LazyLeadsMap` (its own chunk; Leaflet is a second one).
- Pins: open inbox leads (not Check) with their initials in the SLA ring, colored like the box
  avatar. The two newest unanswered leads still inside the 15-minute ring pulse; overlapping
  pins fold to dots (`src/lib/declutter.ts`); pins at one address fan out; the selected pin grows
  with a halo and a name tag. Today's jobs are small dark squares under the pins.
- Phones in Map mode: the map fills the screen, and the count line, chips and boxes ride in a
  drawer (peek, half, full; transform only) with the Grid / Map pill on its edge. Full screen
  is the kit `FullscreenHub` (`?fs=leads-map`): the corner button, or dragging the drawer all
  the way down; "Show N leads" brings the drawer back and Back exits. Tapping a pin opens the
  lead card, also over the full-screen map.
- Every lead with an address gets a position: the `leads.map_backfill` cron hook (every 10
  minutes, batches of 25; `map-backfill.ts`) gives open leads with a street and ZIP a customer
  and a property the way intake does (which queues the geocode), and re-queues a stuck geocode
  once a day (`map-geocode.ts`). Intake re-queues a matched property that never got a
  position. The demo seed places its walk-in leads (locksmith: 11 of 11 open leads on the map,
  was 1). A note says "4 of 6 leads on the map" and why, in plain words.

**Approved fixes**
- Phone leads count as answered: typing in a caller stamps the first response (the office
  user, by call), moves the lead to Contacted and claims it. The missed-lead texts and alerts
  (`lead_ack`, `lead_escalate_5`, `lead_escalate_15`, `lead_not_reached`) now need
  `lead.status = new`.
- Ask before merging a repeat caller: when the phone has an open lead, the form asks "Update
  their open lead or start a new one?". `lookupCaller` returns `openLeads`;
  `createLeadAndCustomer` saves nothing and answers `needsChoice` until the office picks
  (`mergeIntoLeadId`, or `forceNew`, which runs the intake with `merge: false`).
- Don't lose call outcomes: a started call is kept on the device until its outcome is saved,
  and the app asks again after a reload or a Skip (up to 3 times, within 2 hours). "Wrong
  number" cancels the lead's queued follow-up texts and open call-back tasks.
- Booking keeps what was typed: urgency, after-hours, the asked-for day and the customer's
  notes carry into the job.
- Fix a lead's contact details: Edit lead changes the phone, email and address (the address
  becomes a customer property; a customer that still has the old phone or email is fixed too,
  `updateContactFromLead`).
- The Done screen shows at once (the confirmation status fills in after it).
- The caller form fits the first screen.
- One count everywhere: the Leads badge (tab and sidebar) is the New chip's number, new leads
  outside "Check" (`newLeadsWhere`, `countsAsNew`). The old "unclaimed or mine" filter is gone.

**Skipped by the owner**
- "Techs who save a lead see a confirmation" (instead of "You don't have access").
- "Flagged leads need a look first": Book stays available on Check leads.
- "Fix two wrong messages" ("Saved, but needs a review" when nothing was saved, and "Inbox
  zero" on the Booked and Lost views).
- "Red only when it matters": the SLA ring's timing is unchanged.
- Auto-assign when exactly one tech can take the job: the owner chose "Still wait for the
  office".

**Contracts and internals**
- Leads: `LeadBoxData`, `LeadCardData`, `LeadMapPoint`, `LeadMapJob`, `CallerLookup` /
  `CallerOpenLead` and `LeadChangeResult` in `leads/contracts.ts`; `LeadBox` and
  `useLeadCard()` (`components/lead-env.ts`) for other screens; `ensureLeadCustomer` moved to
  `leads/ensure-customer.ts`. `getLeadPrefill` adds `kind`, `priority` and `afterHours` (typed
  on the call, kept in `leads.extra._booking`). `markLeadConverted` now writes a status
  `lead_events` row. New actions `releaseLead` (replaces `assignLead`), `reopenLead`,
  `markLeadNotSpam`, `setLeadStatus`, `undoLeadChange`; `claimLead({ force })` is Take over.
- Jobs: `createBookedJob(tx, input, actor)`; `getTechWorkDays(date)` (availability) and
  `arrivalFit` (recommend.ts) shared by booking and the hub; `NEEDS_TECH_BADGE`.
- Kit: `.box-hit` (globals.css), the lead box's whole-box tap target with its focus ring. One-off
  values a component computes (kind tints, a muted avatar, the map pin's shadow) are inline
  styles, so the global stylesheet stays under its 25 KB budget (docs/budget.md).
- Removed: `LeadsPane`, `LeadCard`, `LeadActions`, `LeadActionsSheets`, `LeadLoadMore`,
  `LeadEditForm` (merged into `LeadEditSheet`), `ScheduleFlow`, `WindowPicker`, `WindowSheet`,
  `availability/mock.ts` and its test, and the kit `Calendar` (`src/ui/components/Calendar.tsx`).

**Upgrading an existing database**
- Run the app once (or `npm run db:migrate`) to apply 0005 and 0006: job types are renamed in
  place and Repair and Maintenance archived. The trade jobs (Lockout, Rekey…) and the techs'
  own working hours arrive only with a reseed (`npm run demo:businesses -- reseed` for the
  demos); until then every tech follows the business hours. The new lead-automation
  conditions reach unedited rows on the next start.
- Checks: typecheck, lint, the full suite (113 test files, 1,556 tests) and a production build pass.

### Maps and boards on the full-screen hub (2026-10-22, R1)
Owner goal: "the user can see the hub on his full screen on smaller devices", reusing the kit.
- **Live map wall mode** (`/map`): "Wall mode" in the header (tablet and up, kit
  `FullscreenButton`) and the map's corner Expand (every size) open one `FullscreenHub`
  (`historyKey="wall"`, dark, browser full screen). Inside: the map, a legend of techs
  (`WallMode.tsx`: color, avatar with the status ring, status, last ping, the current job; a
  column on wide screens, a card strip under the map on tall ones), a live clock and Show
  stale in the top bar. The 60 s refresh keeps running; Esc, back and Close leave it. The
  job sheet sits in the hub's subtree (dark over the wall).
- **Live map markers** (`TechMap`): zero-size anchors drawn by CSS; tech avatars always above
  job pins; job pins declutter like the schedule map's boxes (number box only where it
  covers nothing, else a dot that expands on zoom; a pin under its tech's avatar hides). In
  wall mode each tech's first name sits on a tag on the first free side, and from 1200 px
  markers are larger. QA: 0 overlaps on phone, tablet and desktop. The map follows its box
  (ResizeObserver → `invalidateSize`).
- **Assign hub map** (`/dispatch`): full screen below 1200 px (`historyKey="routes"`): the day
  (kit `PeriodStepper`) and the tech chips in the top bar; a chip or a tech's pin picks the
  tech in place; with `?job=` the footer (`HubFsFooter`) shows the job, the fit and the one
  "Assign <name>" (the panel's `HubAssignButton`, same `scheduleJob`). The map no longer
  remounts when the phone picks another tech.
- **Schedule board** (`/schedule` day, 3 days, week): `ScheduleBoard` (replaces
  `DesktopBoard`) full screen on touch (`historyKey="board"`, rotate tip on phones): the
  corner Expand on the in-page board (1024–1199 px), or a header button where the page shows
  the list. Inside, arrows (`ParamPeriodStepper`) and the Day / 3 days / Week switch; the
  board scrolls both ways under sticky tech and day headers; week columns sized from the
  width (all 7 days on a landscape tablet, ~4 upright, ~4 on a landscape phone; empty days
  at half width); compact cards (two-line title, the tech as an avatar chip inside the
  card). The header row now wraps from 1024 px (it overflowed beside the sidebar).
- **Shared pieces**: `src/lib/declutter.ts` (from the schedule map: box vs dot, plus rect
  obstacles and `placeLabels`; tests/lib/declutter.test.ts), `src/features/map/route-draw.ts`
  (cased route lines, direction chevrons, focus / fade; the schedule map and the Assign hub's
  RouteMap draw routes the same way), `jobs/components/TechChips` (the schedule map and the
  Assign hub), kit `PeriodStepper` and `FullscreenButton`, `ParamPeriodStepper`.
  `ParamControls` drop `?fs=` (a new view or day inside full screen).
- **FullscreenHub** (kit): `theme="dark"` applies only while open and darkens Leaflet tiles;
  toasts stay above an open hub (the toast host is a `data-fs-top` popover raised after it);
  Back / Esc / Close keep a pick made inside (the `?job=` / `?tech=` written while open is
  carried over to the page's entry); closing never leaves the page on a stale `?fs=`;
  nested hubs (a photo or the signature pad inside present mode): a hub stack (Esc and the
  end of browser full screen go to the top hub), page-wide state kept until the last hub
  closes, child-combinator CSS, `[data-chrome]` inside a hub stays visible, the rotate tip
  sits above the footer, `.fs-slot` in `@layer components`; `openFullscreen(key)`.
- Route JS (gz): `/map` 18.7 → 23.8 KB, `/dispatch` 10.7 → 15.7 KB, `/schedule` 8.8 →
  15.0 KB (FullscreenHub 4.4 KB of each); Leaflet stays lazy; global CSS +33 B.

### Photos, signatures and present mode on the full-screen hub (2026-10-22, R2)
Owner spec: "just display the photos, and make it possible to view them full screen" (no
before/after slider), full-screen landscape signing, and presenting an estimate on a tablet
by reusing the customer's own page.
- **`PhotoViewer`** (kit, new): `FullscreenHub` (no trigger, minimal chrome, dark) around a
  CSS scroll-snap carousel, so swiping and momentum are the browser's. It grows from the
  tapped thumbnail and shrinks back into the thumbnail of the photo on screen (scrolled into
  view first). Counter "3 / 12", caption (tag, time, who took it, caption text), prev/next
  and ← / → from 768 px, Esc / back / close. Only the photo on screen and its neighbours load
  (the cached thumbnail shows until the full photo is in); double-tap zooms 2× and pans with
  native scrolling. `actions` adds buttons for the photo on screen. Lazy chunk.
- **`PhotoGrid`** (kit): tapping a thumbnail opens the viewer at that photo; one viewer swipes
  through the whole grid. New `groups` (sections by tag, `JOB_PHOTO_GROUPS`), `layout="strip"`,
  `actions`, `historyKey`; `Photo` gains `by` and `flagged`. The old `<dialog>` lightbox is
  gone (its `.lightbox` CSS too). Pure helpers in `src/ui/components/photos.ts` (`groupPhotos`,
  `photoAlt`, `containSize`; tests/ui/photos.test.ts).
- **Job photos panel** (S23): photos grouped Before / During / After / Problem / Other (empty
  groups hidden); the before/after compare slider and the filter are gone from the panel
  (`PhotoCompare` itself and the print/evidence pages are untouched). Tap → viewer; its Info
  button opens the details sheet over it (star for the invoice, re-tag, caption, GPS, flags,
  evidence lock, remove), without the duplicate photo.
- **Portal and estimate photos**: `/i` (portal and receipt photos), `/j` (S27), `/e` "What we
  found" (a strip) and the staff estimate's problem photos open the viewer. The viewer is a
  lazy chunk, so these pages only carry the grid.
- **`SignatureCapture`** (kit, new): `FullscreenHub` (no trigger, title + signer line, Clear /
  Done footer, `lockScroll="strict"`, `orientationHint="landscape"`) around a `SignaturePad`
  that fills the screen. The rotate tip shows only until the first stroke. Done trims the PNG to
  the ink, shows "Signature added" (SuccessCheck) in the hub, then shrinks back into the field. Inside a sheet, Esc cancels signing instead of
  closing the sheet. No browser full screen (it would lift the page over the sheet).
- **`SignatureField`** (kit, new): the "Tap to sign" box that shows the signature once there is
  one; it loads `SignatureCapture` on demand. `SignaturePad` gains `height="fill"`,
  `clearButton`, `toBlob/toDataURL({ trim })` and `resize()`; strokes survive a resize (drawn
  scaled to fit, re-based when the signer draws again; `signature-math.ts`, tested).
- **Every signature** goes through S15 `SignatureSheet`, which now uses `SignatureField`: the
  tech's job sign-off, checklist signatures, estimate "Sign here", change orders, the public
  `/e` approval, the tool agreement and the pay agreement. Upload (outbox or public presign),
  hashing, the consumer's action and the evidence lock are unchanged.
- **Present mode**: "Present to customer" on the staff estimate page (`estimates.send`) mints or
  reuses a short-lived link (`mintEstimatePresentLink` → `mintOrReusePublicToken`, purpose
  `estimate.present`, audited `estimate.presented`) and opens `/e/<token>?present=1`. With a
  staff session that may present it, the customer's own page (unchanged, nothing hidden; costs
  and internal notes never reach `/e`) is wrapped in a full-screen hub: a "Tap to start" screen
  with one primary (the page and its Approve bar stay hidden until then; the tap asks for browser
  full screen on Android and iPad), a slim top row with a discreet "Exit presentation" (back to
  the staff page) and a "Full screen" button when the browser left it; the page scrolls below
  the row, so nothing renders under it. Back pauses it (Resume / Exit); Esc doesn't end it, but
  closes a photo opened inside it. The customer picks an option, signs full screen and
  approves through the same public action, which records the signature `in_person` and puts
  `present_mode` + `presented_by` in the approval's audit row.

### Schedule map view (2026-10-22)
Owner spec: a Map view on the Schedule page, one day of routes, with street tiles that are
free to turn on.
- **Calendar | Map** switch beside Day / 3 days / Week (`ParamSegmented push`, so back
  returns to the other view). `/schedule?view=map&date=YYYY-MM-DD&tech=<id>&job=<id>`: the
  map always shows one day with the day stepper (soft navigation; the map stays mounted).
  Picking a job or isolating a tech is client state mirrored with `history.pushState` (no
  server round trip; back / forward restore it through `useSearchParams`).
- **Layout by the view's own width** (container queries): desktop ≥ 1060 px = techs (day
  stepper, tech rows with color swatch, avatar in the tech color, "3 jobs · 8a–4p · 36.3 mi",
  Unassigned and No location groups) | map with the timeline strip under the map and the tech
  column | day summary or job details. Tablet: collapsible tech panel, details in a right
  drawer (opening a job folds the panel away and brings it back on close). Phone: map on top
  (45 dvh), tech chips as the filter, the timeline, the day's stops grouped by tech; details
  in the kit's bottom sheet with Open job under the window.
- **Map** (`MapCanvas`, Leaflet in a lazy chunk): one polyline per tech in the board's tech
  color (`techColor`), home base → stops in window order, a chevron at every leg's midpoint,
  the focused route thicker, the rest at 25% while a tech is isolated. Job markers are window
  boxes ("1 · 8–10" / "Dana W."); done = muted with a check, live (on the way, arrived, in
  progress) = pulsing ring (at most two), late (window passed, nobody arrived) = red outline
  and a "Late" tag, unassigned = gray dashed box with no number. Below zoom 10, or where a
  box would overlap another box, cover a dot or home pin, or be cut by the map edge, it folds
  to a numbered dot (`declutter.ts`, measured box sizes); hover or the timeline expands one.
  Selecting pans gently so the stop sits in the visible part of the map (beside the tablet
  drawer, above the phone sheet); clicking the empty map clears it; bounds fit the day, or
  the isolated tech.
- **Timeline strip** (`DayTimeline`): one row per tech (avatar and color), an Unassigned row,
  bars over the arrival windows with the same status styles, a red now-line. The axis runs
  from the earliest to the latest window ± 1 h. A bar shows "1 · 10–12" only when it fits (a
  container query per bar), else the stop number; hover or focus shows the full label and
  the customer. Hover and click sync with the map both ways.
- **Details**: status, service and title, the arrival window large, the customer with call
  (customers `CallButton`) and text (`/messages/<customer>`), the address with directions,
  notes, the tech and "Stop 2 of 4", then **Open job** (the one primary), Reassign (the Assign
  hub for the job) and Reschedule (the S9 assign sheet). ← / → step through the route; Esc
  closes the details, then the isolation.
- **Data**: `loadScheduleMap` (`jobs/schedule-map/queries.ts`) reuses the Assign hub's day
  loaders, now shared from `jobs/dispatch/queries.ts` (`loadDayJobs`, `loadActiveTechRows`,
  `loadAssignees`, `dayRangeUtc`). One query for the day: techs (plus any other assignee),
  jobs except cancelled with window, status, assignees (primary first), coordinates, customer
  name and phone, service type, trimmed notes, home bases and route miles (haversine). Same
  permission as the board (`schedule.view_all`); the contact window masks house numbers,
  coordinates, directions and the phone for viewers without `customers.contact_view`.
- **Street map, free**: Settings → Map (now "Map", shown with or without the live-map flag)
  has a one-click **OpenStreetMap (free)** switch (`saveMapTiles`, `map.tile_url` /
  `map.tile_attribution`). `getMapConfig(settings.map)` feeds every map (schedule map, Assign
  hub, live map, tracking page): `NEXT_PUBLIC_TILE_URL` wins, then the saved preset, then OSM
  in development only. **New installs stay off in production** (OSM's tile policy doesn't
  allow defaulting a distributed app onto its servers), with "Set it up" now pointing to
  `/settings/map`. The demo seeds turn it on for every profile; `scripts/enable-osm-tiles.ts`
  turns it on in an existing database (`PGLITE_DIR=… npx tsx --conditions=react-server
  scripts/enable-osm-tiles.ts`, `--off` to undo; stop the app first on PGlite). Integrations
  shows the source. No CSP change needed: only `frame-ancestors` is set, and the service
  worker ignores cross-origin requests.
- Kit: `Avatar color` (a CSS color instead of the seed's tone).
- Tests: `tests/jobs/schedule-map.test.ts` (route order, miles, no-location stops, unassigned,
  stop index, phase, labels, axis, lanes, declutter) and `tests/jobs/schedule-map-db.test.ts`
  (the day query, the permission, masking for a tech who can open the schedule).
- **Full screen (M19)** on phones and tablets: the map and the techs timeline each have an
  Expand button. New kit component `FullscreenHub` (`src/ui/components/FullscreenHub.tsx`):
  the region moves to the top layer without remounting (Leaflet keeps its map), grows from its
  rect (FLIP, 320 ms spring), pushes `?fs=<key>` so back, Esc or Close leave it with no history
  left behind, makes the app inert, focuses Close, and on touch devices also asks for browser
  full screen. The map in full screen: day arrows and tech chips in the top bar, a collapsible
  timeline strip at the bottom, the job in the kit Sheet (bottom sheet on phones, drawer on
  tablets) with the stop panned into the visible part. The timeline in full screen: a Fit
  day / Zoom switch, two-line cards whose labels stay pinned beside the name column, rows that
  hug their cards, now at 30% from the left, and a one-time "Rotate for a wider view" tip in
  portrait. The API covers the next uses (wall mode, Assign hub, signature, present mode,
  photos, week board): DESIGN.md "Fullscreen hub (M19)". The timeline hover label now stays
  inside the strip (shifted in from either edge, flipped under the bar near the top).
- An empty day says "Nothing booked this day" over the map, which fits the techs' home bases.
- Size: `/schedule` route JS 8.6 → 8.7 KB gz (the map view is its own chunk); map view only:
  view 10.2 KB + details 4.0 KB (preloaded when idle) + canvas 5.5 KB with Leaflet (41.5 KB,
  CSS 2.6 KB). Global CSS +18 B (one width utility; the rest is route-local); shell
  unchanged (139.4 KB).

### Call-to-booking flow (2026-10-21)
Owner spec: Leads → "+" turns a phone call into a booked job in three steps, "1 Caller · 2
Schedule · 3 Done" (`BookingSteps`), each a pushed route (M1 slide, CSS only).
- **Step 1, Caller** (`/leads/new`, `features/leads/components/booking/CallerForm.tsx`): phone
  first, with a returning-caller lookup while typing (`lookupCaller` → the customers
  `findDuplicates` exact phone match, plus job count and primary address). Tapping "Use" fills
  name and address; the lead links to that customer through the intake's phone match. Then the
  service address (street, unit, city, state, ZIP; the state comes from the company, the city and
  ZIP placeholders too), service type chips, notes, the source (default "Phone call"), an
  optional quoted price, and the verbal SMS consent box. Email and custom fields sit under "More
  details" (a lazy chunk; it opens on its own when a custom field is required). Sticky bar:
  **Save & schedule** (primary) and **Save lead only**.
- **`createLeadAndCustomer`** (`leads/actions.ts`): one `action()`, one transaction. It runs the
  same manual intake as `createLead` (consent recording, spam score, dedupe, round robin),
  then the convert path's `ensureLeadCustomer` (customer + property). "Check" or spam leads get
  no customer. Save & schedule also needs `leads.convert` and a street + ZIP. With `leadId`
  (Back from step 2) it edits that lead in place (name, service, price, notes, source, address
  → `ensureProperty`) instead of creating a second one. Back, via the nav bar or the browser,
  returns to `/leads/new?leadId=…` with the saved values.
- **Step 2, Schedule** (`/leads/new/schedule?leadId=`, `ScheduleFlow.tsx`): the new
  `Calendar` (60 days; phone: vertical months under a sticky weekday header; ≥ 768 px: two
  months with prev/next). Days show `best` (accent dot + "Best", the top 3), `open` (green
  dot), `limited` (amber ring), `full` (struck through, not selectable); past days are
  disabled and today is ringed. A day's 2-hour arrival windows (business hours split in two-hour
  steps, `availability/windows.ts`) load on tap (`fetchDayWindows`, prefetched on hover). They
  show in a lazy sheet on phone and tablet and in a sticky side panel at ≥ 1200 px. Each window
  is a large button with its state and the suggested tech ("Ben · adds 3 mi"). The best tech is
  preselected; "Change tech" lists the rest with their reasons in the Assign hub's look.
  **Book job** calls the existing `createJobAction` (date, window start, window length,
  primary assignee, lead id). That marks the lead booked (`markLeadConverted`), carries the
  quoted price to the draft invoice and emits `job.scheduled`.
- **Step 3, Done** (`/leads/new/done?jobId=`): `SuccessCheck`, "Booked for Thu, Oct 22 ·
  10–12 with Ben", and **Open job** / New call / View customer. The confirmation is the
  built-in `booking_confirm` automation (`job.scheduled` → template `job.booked`) through
  `enqueueMessage`, so consent, quiet hours and caps apply. The page shows the real
  `scheduled_messages` row: queued (outbox or quiet hours), sent, "Not sent: no SMS consent",
  opted out, failed (`leads/booking-labels.ts`). It waits up to 3 s for the row to exist,
  then polls a few times.
- **Availability contract** (`src/features/jobs/availability/`): `types.ts`
  (`DayAvailability`, `WindowSlot`, `TechSuggestion`), `index.ts` `getAvailability` /
  `getDayAvailability` (server). It is MOCK for now (`mock.ts`): deterministic per date and
  address, weekends mostly limited or full, real tech names and colors. `// TODO(algo)` marks the
  swap point. Tests: `tests/jobs/availability-mock.test.ts`.
- Intake fix: a manually logged call is no longer merged by the dedupe hash into a lead that
  is already booked, lost or spam (a returning customer calling again within the dedupe window
  can now be booked).
- Route JS: `/leads/new` 10.2 KB gz (was 11.0), `/leads/new/schedule` 12.0 KB, `/leads/new/done`
  0.6 KB; shell unchanged (139.4 KB).

### Assign hub (2026-10-21)
Owner request: "a new assign to tech hub … tech list, a date, … a map, their jobs, their route,
the tech details … recommend which tech to assign to, based on their route … responsive."
- New `/dispatch` ("Assign", sidebar Work + phone More, `jobs.assign`: admin and office). Query
  `?date=YYYY-MM-DD` (default today, company zone), `?tech=<userId>`, `?job=<jobId>`. A job that
  already has a window pins the hub to its day (a banner says so).
- Layout by the hub's own width (container queries, because the sidebar takes 256 px): one column
  on phones (list → pushed tech view with a 40 % map, M1 push and an M3 avatar morph), list | map
  over panel from 640 px, list | map | panel from 1040 px. Picking a tech is client state mirrored
  into `?tech=` with `history.pushState`: instant, back works, no server round trip.
- Map (`src/features/map/components/RouteMap.tsx`, lazy Leaflet chunk like `/map`): each tech's
  day as a straight-line polyline in their color with numbered stops, the job as an accent pin
  and the recommended insertion as a dashed detour; auto-fits; works with "Street map is off".
- Tech panel: status, load, the recommendation's reasons, the day as a `TripTimeline` with the
  new stop dropped into its slot, and details (experience, time at the company, age for team
  managers only, phone, vehicle, skills, where the day starts). One primary "Assign <Name>"
  (BottomBar on phone, rail card on desktop) calls the existing `scheduleJob` action; an untimed
  job also gets the suggested arrival on that day.
- Recommendation engine `src/features/jobs/dispatch/recommend.ts` (pure, golden-tested): extra
  haversine miles at the cheapest feasible slot plus penalties for overlaps, the daily cap (6),
  not being clocked in today, a missing skill and tight drives, plus 1.5 per booked job. Jobs
  without coordinates rank by load. ⚖️ Age is never an input (test + comment).
- Team profile: `experience_years` and `birth_date` on `users` (migration
  `0004_team_profile_dispatch`; the existing `hire_date` is reused). Edit profile validates hire
  date not in the future, 0–60 years, birth date in the past and age 16–100. ⚖️ Date of birth and
  age are shown only with `users.manage` (or on your own record), never in audit payloads (only
  `birth_date_changed`), never on public pages, and the AI PII guard now refuses DOB text.
- Entry points: "See routes" in the assign sheet and an "Open assign hub" button in the job's
  bottom bar while it has no tech.
- Demo: every seeded person has experience and a birth date in all four profiles; J89 / J90 are
  booked today 4 PM / tomorrow 11 AM without a tech (default plan sha pin updated for that).

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
