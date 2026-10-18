# CLAUDE.md

Rules and orientation for Claude sessions working in this repo. Read this first, then the
relevant parts of `docs/SPEC.md` (product behavior) and `docs/BUILD_PLAN.md` (ownership,
cross-module contracts, events, seeds).

## 1. What this is

A **single-tenant**, iOS-styled CRM boilerplate for home-service businesses (locksmith,
garage door, HVAC, plumbing, handyman…). One business per deployment: clone, brand,
deploy. It covers leads, scheduling and dispatch, a technician app, estimates, invoices,
payments, chargeback protection, photos, messaging, automations, commission/payroll,
vehicles, tools and a live map. Product principles: `docs/SPEC.md` §1. Lightweight is a
top requirement (§14).

## 2. Commands (npm only — pnpm is not used)

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server (Turbopack). Zero config: PGlite in `./.data/pglite`, auto-migrated and base-seeded. Open http://localhost:3000/signup on first run. |
| `npm run build` / `npm start` | Production build / server (`STANDALONE=1 npm run build` for Docker) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` / `npm run format` | Biome check / format |
| `npm test` | Vitest (`tests/**/*.test.ts`, golden tests in `tests/golden/`) |
| `npm run db:generate` | SQL migration from `src/db/schema/*` into `drizzle/` |
| `npm run db:migrate` | Apply migrations (`DATABASE_URL`, else PGlite at `PGLITE_DIR`) |
| `npm run db:studio` | Drizzle Studio (never against PGlite while `next dev` runs) |
| `npm run seed:demo` | Demo data (refuses a second run; `npm run seed:demo -- --reset`). `-- --profile=<handyman\|locksmith\|chimney>` seeds a single-trade business instead of the mixed Acme demo (logins `admin@` / `office@` / `tech1@` at its domain, password `TestDrive2026!`) |
| `npm run demo:businesses` | Seeds (if missing) and starts all three trade demos side by side with `next start`: http://handyman.localhost:3101, http://locksmith.localhost:3102, http://chimney.localhost:3103 (data in `.data/demo/<trade>/`). `-- reseed` refreshes the dates to now, `-- stop`, `-- status` |
| `npm run gen:vapid` | Print a VAPID key pair for Web Push |
| `npm run analyze` | Bundle analyzer (check the §14 budgets) |
| `npm run build:embed` | Rebuild `public/embed.js` (lead embed, ≤ 3 KB gz; fails over budget) |
| `npm run export` / `import:csv` / `restore` | Full zip export, CSV import (dry run first), restore from a backup |

Scripts that touch the DB run with `tsx --conditions=react-server` (so `server-only` resolves).

## 3. Architecture map

**Request flow** (SPEC §3.1)
- `src/proxy.ts`: optimistic redirect only. No session cookie on an app route → `/login?next=…`. Never touches the DB.
- Pages call `requireUser(perm)` / `requireAnyPerm([...])` from `@/lib/auth/current` (React `cache()`; redirects to `/login`, throws `ForbiddenError`).
  `ForbiddenError` carries Next's `forbidden()` digest (`experimental.authInterrupts`): an uncaught one renders
  `(app)/forbidden.tsx` ("You don't have access", nothing logged) and a route handler answers 403. `action()` still
  maps it to `{ ok: false }`. Don't catch it in a page just to show your own error card.
- Reads: `src/features/<m>/queries.ts`. Writes: server actions built with `action()` from `@/lib/action`
  (auth → feature flag → zod → `clientId` idempotency → one transaction with domain write + `emit()` + audit + activity → `revalidatePath` + `refresh()` → `after(processEvents)`).
- Domain events: transactional outbox (`events` table) → `processEvents()` in `after()` and the cron tick → handlers in each module's `events.ts`.
- Scheduler: `/api/cron/tick` (Bearer `CRON_SECRET`, advisory lock 42) plus a throttled piggy-back (`maybeTickSoon()` in the `(app)` layout, ≤ once a minute).

**Folders**
```
src/app/(auth)/         login, signup (first run creates company + admin), invite/[token], reset, reset/[token]
src/app/(app)/          signed-in shell (layout.tsx) + every authenticated route; _components/ = shell helpers
src/app/(public)/       customer-facing pages: j e i p r t /[token], f/[publicKey], privacy, sms-terms
src/app/api/            cron/tick, uploads/*, push/subscribe, auth/logout, health
src/app/offline         offline fallback (precached by public/sw.js)
src/app/manifest.ts, icon.tsx, apple-icon.tsx, icons/[file]   PWA manifest + generated icons
src/features/<module>/  one folder per module (§15.1) — see the registry
src/features/registry.ts  module list; nav, perms, settings schema and flags derive from it
src/features/_template/ reference module (not registered) — copy it to start a module
src/lib/                core libs (auth, action, events, settings, permissions, nav, money, time, tokens…)
src/db/                 Drizzle schema (12 files), enums, connection (PGlite or pg), seeds
src/adapters/           provider drivers behind interfaces (messaging, email, payments, storage, ai, geocode, places, maps, push, pdf, vin)
src/ui/                 the iOS component kit (components/), motion/, icons.ts, status.ts, tone.ts
src/client/             browser utilities (outbox, drafts, upload, image, exif, geo, push, install prompt)
tests/                  vitest; golden/ for money, rules and permissions
docs/                   SPEC, BUILD_PLAN, RESEARCH, DEPLOY, MODULES, CHANGELOG, budget
```

**Module manifest** (§15.1): `src/features/<key>/manifest.ts` built with `defineModule()` from
`permissions.ts` (grants as `"AOT"` letters), `settings.ts` (zod namespaces with defaults),
`nav.ts` (tab priority per role, sidebar section, More group, settings group). Runtime hooks
live in fixed files aggregated by core: `events.ts` → `src/lib/event-handlers.ts`,
`cron.ts` → `src/lib/cron-hooks.ts`, `workers.ts` → `src/lib/workers.ts`,
`badges.ts` → `src/lib/badges.ts`, `seed.ts` → `src/db/seed/demo.ts`, `offline.ts` →
`src/client/offline-registry.ts`. Cross-module contracts: `api.ts` (server functions, take
`tx` first), `contracts.ts` (types only), `slots.tsx` / `slots.client.tsx` (UI slots,
BUILD_PLAN §5).

## 4. Hard rules

- Every page and query calls `requireUser()` / `requireAnyPerm()` first. **No DB reads at build time**: the root layout is `dynamic = "force-dynamic"`; don't add static pages that query.
- Every mutation goes through `action()`; never call `revalidatePath` by hand inside `run()` (use the `revalidate` option or ctx `revalidate()`).
- **No `cacheComponents`, `'use cache'`, `cacheTag`/`updateTag`, PPR or `partialPrefetching` in v1** (lead-engineer amendment 3). Use React `cache()` for per-request dedupe; `revalidatePath()` + `refresh()` after mutations. SPEC mentions of tags are a future optimization.
- Money is integer cents; rates are basis points; round with `roundHalfAway` (`@/lib/money`). Balances are derived; ledgers are append-only with reversals.
- Issued invoices, signatures, consent events and the audit log are immutable (DB triggers on 8 append-only tables).
- PG16-compatible SQL only. No `uuidv7()`, no extensions. Enums are `text` + zod (`@/db/enums`). `updated_at` is never automatic — set it on update.
- `db.query.*` is unavailable (no relations). Use the core query builder; `execRows(sql)` for raw SQL; cast 64-bit ints with `::int` or `Number()`.
- PGlite has one connection: never hold a transaction open across provider calls.
- Providers only via `src/adapters/*`. No vendor SDKs (Stripe/Twilio/AWS) anywhere.
- Messages always go through the messaging module's `enqueueMessage` (consent, quiet hours, caps). Never call a driver from a feature.
- Photos upload direct to storage via `/api/uploads/presign` → PUT → `/api/uploads/complete` (`src/client/upload.ts`). Never through server actions.
- Client bundle: no dependency over 5 KB gz without an entry in `docs/budget.md`. Banned: UI kits, chart/date libraries, moment, lodash, AWS SDK, Stripe/Twilio SDKs, `@react-pdf`, full `motion`, Vaul, MapLibre, `browser-image-compression`, libphonenumber on the client, next-auth.
- Animations: CSS spring tokens first (`--ease-spring*` in `globals.css`), `motion/react-m` second — wrap only the component that uses `m.*` in `<MotionProvider>` (`src/ui/motion/MotionProvider.tsx`; it is **not** mounted globally, to keep ~30 KB out of the shell), preferably inside a lazily loaded chunk; never the full `motion` bundle. `<ViewTransition>` (stable in React 19.3) via `PageTransition`/`PushLink`/`BackLink`.
- ⚖️ features default OFF or conservative. Never remove compliance warnings.
- No AI on the money path. No PII to free-tier AI (`src/adapters/ai/policy.ts`).
- Don't run `drizzle-kit push/studio` against PGlite while `next dev` is running.
- Never edit an applied migration (`drizzle/0000_*` … `0003_*`); generate a new one. Views/triggers: `npx drizzle-kit generate --custom --name <x>` (e.g. `0003_invoice_balances_tip_cap.sql` replaces the `invoice_balances` view).
- Schema files use relative imports only and never import `server-only` (drizzle-kit loads them).
- A `"use client"` file exports components only. Helpers that server pages also call live in a plain module (e.g. `src/features/time/format.ts`); calling a client export from the server throws at render time.
- `api.ts`, `events.ts`, `cron.ts`, `seed.ts` and anything they import must not import `@/lib/auth/current` (it pulls `next/navigation`, which breaks `npm run seed:demo` under tsx). Use `can`/`canAny` from `@/lib/permissions` with an explicit viewer.
- Shared pure helpers that more than one group needs go in `src/lib/` (e.g. `src/lib/qr.ts`, `src/lib/mask.ts` for contact masking), not in another module's folder.
- Client IPs come from `clientIp(req)` / `clientIpFromHeaders(headers)` (`@/lib/http`, `@/lib/client-ip`), which honor
  `TRUST_PROXY`. Never read the leftmost `x-forwarded-for` yourself (spoofable).
- A link re-rendered on every view (print QR, PDF) uses `mintOrReusePublicToken` (`@/lib/tokens`), not `mintPublicToken`.
- Redirect targets taken from user input (`?next=`, form fields) go through `safeNextPath()` (`@/lib/auth/safe-next`). Upload request/response shapes are `PresignRequest`/`CompleteUploadRequest` in `src/features/media/contracts.ts`; use `queueUpload` (`src/client/outbox.ts`), never hand-rolled fetches.
- Ownership: during the parallel build each path has one owner (BUILD_PLAN §3). Frozen core files are listed in §3.6.

## 5. How to add things

- **Module:** copy `src/features/_template/` and follow its README (SPEC §15.2): schema → `npm run db:generate` → permissions/flags → settings → manifest + one registry line → aggregators → routes → tests → docs.
- **Route:** `src/app/(app)/<path>/page.tsx` with `requireUser(perm)` at the top, `<PageTransition>`, `LargeTitleHeader` (top level, `trailing={<HeaderActions />}` for the + menu and bell) or `NavBar` with `back` (pushed screens), content in `<Page>`. Add `loading.tsx` with `ListLoading`/`DetailLoading` from `src/app/(app)/_components/ListLoading`.
- **Nav item / settings page:** add to the module's `nav.ts`; the tab bar, sidebar, More list and `/settings` index pick it up (filtered by perm + flag).
- **Adapter/driver:** implement the frozen interface in `src/adapters/<kind>/`, select it by env var (SPEC §9.7).
- **Automation / template:** `src/features/automations/builtin/index.ts` (`builtinAutomations`, `builtinTemplates`), seeded by the base seed. On every start the base seed also brings built-in rows nobody has edited (`updated_by` null) to the catalog, so any action that edits or toggles an automation or template must set `updatedBy`. Template syntax: `{{path}}`, `{{path|fallback}}`, `{{path:money}}`.
- **Event:** add the type to `EventMap` (`src/lib/event-types.ts`), `emit()` it inside the action's transaction, handle it in a module's `events.ts` (idempotent; each handler runs in its own transaction).
- **Custom field:** a row in `custom_field_defs` (Settings → Custom fields); render with the `CustomFieldsFields` slot.
- **Preset (trade):** data only (`generic` ships; the signup trade picker lists presets in `src/app/(auth)/signup/options.ts`).
- **Feature flag:** declare in the module's `permissions.ts` `flags`; check with `isEnabled()` (server) or `action({ feature })`; it appears on `/settings/features`.
- **Demo trade profile:** copy `src/db/seed/profiles/handyman.ts` (company, metro + ZIP areas, staff, price book, job
  recipes, fleet, tools and every bit of fragment copy; types in `profiles/types.ts`), register it in
  `profiles/index.ts`, then run `npx vitest run tests/db/seed-profiles.test.ts` (add the key to its `TRADES`/`DOMAINS`).
  Recipe order matters: `partScenarios[0]` and `[3]` land on the past deposit jobs, `[9]` on J79's sent estimate,
  `laborScenarios[0]` on the J30 deposit and `[1]` on J41's change order. `buildPlan(profile)` is pure; DEMO is chosen
  by `DEMO_PROFILE` at module load, so fragments read copy from `ctx.profile`, never literals. Never edit
  `profiles/default.ts` casually: the mixed demo is pinned by a hash in that test.

## 6. Testing

- `npm test` runs everything under `tests/`. Golden tests (`tests/golden/`) pin money, rules and permissions — add a case for every rule change.
- DB integration tests create a throwaway PGlite under `TEST_PGLITE_ROOT` (default: OS temp dir); see `tests/db/core.test.ts` for fixtures.
- Vitest maps `server-only` to an empty module and `@/` to `src/`.
- For manual runs against a scratch DB: `PGLITE_DIR=/tmp/somewhere npm run dev`. A second dev server in the same
  checkout needs its own build folder: `NEXT_DIST_DIR=.next-qa npx next dev -p 3301` (inside the repo; `next dev`
  then adds that folder to `tsconfig.json` and `next-env.d.ts`, so restore those two files afterwards).
- Demo seeds: `ctx.at(day, "HH:MM")` for appointments, `ctx.atPast(day, "HH:MM")` / `ctx.past(date)` for things that
  already happened (never after the seed's `now`).

## 7. Next.js 16 notes

- Read `node_modules/next/dist/docs/` for this exact version before using an API (see AGENTS.md).
- Request APIs are async: `await cookies()`, `await headers()`, `params`/`searchParams` are Promises.
- `proxy.ts` replaces middleware (no DB, no `server-only` imports).
- Cache Components are **off**: no `'use cache'`, no `updateTag`. Mutations: `revalidatePath()` + `refresh()` (from `next/cache`), both handled by `action()`.
- `after()` (from `next/server`) for non-critical work: events, emails, geocoding, AI, the cron piggy-back.
- Security headers live in `next.config.ts` `headers()`. Keep `/_next/*` out of catch-all header rules (headers on the dev HMR socket cause an endless reload loop); `/f/*` stays frameable for the hosted lead form.
- `serverActions.bodySizeLimit` is set under `experimental` (build prints "Experiments: serverActions").

## 8. Design system

Tokens live in `src/app/globals.css` (colors, type scale, radii, spring easings, dark mode via
`prefers-color-scheme` and the `data-theme` override from the Appearance cookie). Tailwind v4
utilities map to them (`bg-card`, `text-label-2`, `text-large-title`, `rounded-card`,
`shadow-card`, `bg-accent`, `text-accent-text`). The brand accent from Settings → Branding is
server-rendered by the root layout (`getBrandingStyle()` → `src/lib/branding.ts`, contrast-safe).

Components (`src/ui/components/`, import each file directly): Button, IconButton, List
(ListGroup/ListSection/ListRow), KeyValueList, StatusPill, Badge, Chip, Avatar, TechCard,
MoneyText, Score (ReadinessRing/RiskChip), Toggle, SegmentedControl, Stepper, Field
(TextField/TextArea/Select), DatePicker (DateField/Calendar/CalendarWindow/DatePickerButton),
TimePicker (TimeField), AddressAutocomplete, MoneyField, PhoneField, SearchField,
SubmitButton, TextLink, Sheet, ActionSheet, Alert (useConfirm), ConfirmTyped, ContextMenu, AnchoredPopover,
SwipeActions, AddMenu, NavBar (LargeTitleHeader/BackButton), NavHistory (history breadcrumbs),
PageActions (ActionRailFrame/usePageActions), TabBar, Sidebar, AppShell
(Page/SplitView), Toast, Banner, EmptyState, Skeleton, Spinner, OfflineBanner,
SlotPlaceholder, FeatureGate, charts (Sparkline/BarChart/LineChart/DonutChart/ProgressRing),
StatCard, Timeline, MessageBubble, PhotoGrid, PhotoCompare, SignaturePad, CameraButton,
MapView, InstallPrompt, lazy (Lazy* wrappers). Gallery: `/dev/ui` and `/dev/ui/shell` (dev only).

**Use existing components before creating new ones.** Status labels and tones: `src/ui/status.ts`. Icons by name: `src/ui/icons.ts`.

Conventions from QA round 2: `useConfirm()` may be awaited inside `startTransition` (prefer confirming before
`start()` so the button doesn't spin under the alert). Loading screens use `ListLoading` / `DetailLoading` (title and
back come from the nav manifests; pass `title`, `search`, `segments`, `back` when they differ). Wrap custom
skeletons in `PageTransition`. Small tap targets get `hit-44` (or `hit-44-kids` on a wrapper). Button and menu
labels are sentence case ("Sign in", "New job"). `StatCard size="sm"` for 3-up rows on phones; money never truncates.
Phone numbers shown to people go through `formatPhoneDisplay()` (`@/lib/phone-display`).

Conventions from the UX round (2026-10-18):
- Dates and times: always `DateField` (`DatePicker.tsx`) / `TimeField` (`TimePicker.tsx`), never
  `<input type="date|time">`. They keep the native contract ('YYYY-MM-DD' / 'HH:MM', `name`, `required`, a real
  `onChange` event) but open the calendar window (sheet on touch, popover with a mouse) and iOS wheels / typed
  segments. Import them from their own files, not `Field`, so forms without dates don't ship the pickers
  (~10 KB gz). Pure math: `picker-math.ts`.
- Page actions on desktop: wrap a page that has actions in `<ActionRailFrame>` (`compact` beside a list or side
  column) and publish them from the component that owns them with `usePageActions({ title, subtitle, groups })`;
  it returns `true` when the rail shows them, so hide that component's "…" at `lg`. Phones keep the "…" sheet.
- Back buttons and breadcrumbs follow the tab's real history (`src/client/nav-history.ts`): NavBar /
  LargeTitleHeader name their page automatically when `title` is a string; the static `back` is only the
  fallback. A list pane beside a detail pane passes `history={false}`. New pass-through screens (create forms,
  print views) belong in `isTransient()`.
- People, places and records render as links where the viewer can open them: `personHref()` for teammates
  (profile for managers and yourself, else their day on the schedule; `profileHref()` when the row already has
  its own drill-down) and `mapsHref()` for addresses that aren't masked (`@/lib/links`); payment rows use
  `paymentHref()` (`@/features/payments/links`). Inline names and numbers use `TextLink`, which renders plain
  text when the href is null. Never nest a link inside a row that is already a link.
- Street inputs on staff pages are `AddressAutocomplete` (`fill` names the city/state/ZIP fields a pick fills,
  `pick="label"` for one-line addresses). It calls `/api/places/autocomplete` (signed-in only), so never use it
  on public pages.

## 9. Glossary

- **Job status:** unscheduled → scheduled → confirmed → en_route → arrived → in_progress → (on_hold) → completed → closed; or cancelled.
- **Job payment status:** none, deposit_paid, partial, paid, refunded, disputed.
- **Payment status:** pending, authorized, succeeded, failed, canceled, refunded, partially_refunded, disputed.
- **Settlement:** draft → tech_review → approved → paid → locked (a pay period's per-tech statement).
- **Ledger types:** commission, tip, spiff, reimbursement_parts/expense/mileage, cash_held, cash_remitted, chargeback_hold/release/clawback, recall_clawback, tool_deduction/allowance/deposit, draw (append-only; reversals, never edits).
- **Risk score / band** (pre-job, §11.1): low, medium, high, critical — drives deposit and start controls.
- **Readiness score** (post-job, §11.2): how dispute-proof the job's evidence is (photos, signatures, receipts).
- **Outbox (messages):** link-mode SMS cards a person taps to send. **Outbox (offline):** queued client actions replayed when online.
- **Slot:** a cross-module UI component with a frozen props contract (BUILD_PLAN §5).

## 10. Lead-engineer amendments (override SPEC.md)

1. npm, not pnpm.
2. Installed versions win over SPEC pins (Next 16.4.1, React 19.3.1, TypeScript 5.9, Biome 2.4, Tailwind 4.3 via `@tailwindcss/turbopack`).
3. No `cacheComponents` / `'use cache'` / PPR / cache tags in v1.
4. `<ViewTransition>` is used because React 19.3.1 exports it as stable.
5. Session cookie `__Host-sid` in production, `sid` on http://localhost.
6. Lightweight: §14 budgets and bans; no new runtime deps without strong reason.
7. Router cache: `experimental.staleTimes: { dynamic: 30 }` (QA round 2, T4-03). Back/forward and repeat visits
   within 30 s reuse the rendered page, so push/pop animate at once. It is the client router cache, not Cache
   Components; mutations still `refresh()` + `revalidatePath()` through `action()`.
