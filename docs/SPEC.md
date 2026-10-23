# Home-Service CRM Boilerplate: Product & Technical Spec

**Status:** v1.0 build spec. Written 2026-10-14.
**Audience:** the build team, and future Claude sessions that clone this repo and extend it for a specific business.
**Evidence base:** `docs/RESEARCH.md`. This spec is normative. Where it says MUST, build it that way.

**Conventions**
- **MVP** = ships in v1. **Later** = designed for (schema hooks, adapter slots, flags) but not built in v1.
- ⚖️ = legal-sensitive behavior. It ships as an admin-configurable warning or toggle, OFF or conservative by default. Never treat it as hard-coded legal advice.
- All money is **integer cents**. All timestamps are `timestamptz`, stored in UTC and rendered in the company time zone, unless the customer's time zone matters (quiet hours).

## Table of contents
1. Product principles
2. Final stack
3. Architecture & repo layout
4. Roles & permissions
5. Modules (M01–M24)
6. Data model
7. Domain events, automation catalog, template variables
8. API surface & server-action conventions
9. Adapter interfaces
10. Commission & settlement engine
11. Chargeback risk & readiness scores
12. iOS design system
13. Navigation / information architecture
14. Performance budget & lightweight rules
15. Extensibility conventions (for future Claude sessions)
16. Out of scope for v1
17. Open questions / unverified items

---

## 1. Product principles

1. **Lightweight by default.**
   - Server Components first. Client JS only for forms, sheets, the camera, the map and gestures.
   - Shell route ≤ 150 KB gzipped JS. No UI kits, chart libraries, date libraries or SDKs where a 50-line `fetch` does the job.
2. **Free by default, adapters for upgrades.** Every external dependency sits behind an interface in `src/adapters/*` with a free or dev driver chosen by env var:

   | Concern | Free/dev driver (default) | Paid/upgrade drivers |
   |---|---|---|
   | SMS | `link` (tap-to-send) | `twilio`, `telnyx` (Later) |
   | Email | `console` in dev, `resend` free tier in prod | — |
   | Payments | `manual` | `stripe` (MVP), `square` (Later) |
   | Storage | `local` in dev | `s3`-compatible (R2) |
   | AI | `none`, or `gemini` free tier | `gemini` paid |
   | Maps | Leaflet + env tile URL | — |
   | Push | Web Push (VAPID) | — |
   | PDF | browser print | server `PdfRenderer` |

   Switching providers MUST NOT require touching feature code.
3. **Feels like a native iOS app.**
   - Large titles, inset grouped lists and sheets with detents.
   - Spring physics that match Apple's curves.
   - 60 fps on a mid-range phone.
   - Installable PWA. Reduced-motion respected.
4. **Built for the field.** One-handed tech flows, ≥ 44 px targets, offline outbox for status, notes and photos, autosave everywhere, and job states that never couple across jobs.
5. **Money is a ledger, not a field.**
   - Balances are derived from append-only entries. Corrections are reversals.
   - Issued documents are immutable and versioned.
   - Settlements lock their jobs.
6. **Evidence by default.** Every signature, status change, photo and payment captures who, when, where and a content hash. This feeds chargeback defense, the anti-theft controls and pay disputes from the same data.
7. **Config, not code.**
   - These live in config tables or zod-validated JSON: automations, templates, commission plans, deposit rules, permissions, custom fields, checklists, tags, reminders and feature flags.
   - A per-business clone should mostly change seed data and settings.
8. **Extensible by Claude.**
   - Every module has the same folder shape and a manifest, and registers its permissions, nav items, events, templates and settings.
   - `CLAUDE.md` documents the rules (§15).
9. **No lock-in.** One-click full export (JSON + CSV + media zip). Bring your own phone number, processor, bucket and DB. No per-seat logic anywhere.
10. **Compliance-safe defaults.**
    - Quiet hours, a consent ledger, STOP handling and no review gating.
    - Wage-deduction features OFF by default with warnings.
    - Surcharging OFF (cash-discount default).
    - No AI on the money path. No PII to free-tier AI.

---

## 2. Final stack

| Layer | Choice (exact pin) | Notes |
|---|---|---|
| Runtime | Node **24.x LTS** (`"engines": {"node": "24.x"}`) | Needed for `crypto.argon2` (≥ 24.7) |
| Framework | **next@16.4.1**, App Router, `cacheComponents: true`, `partialPrefetching: true` | `proxy.ts` (not middleware). Turbopack. |
| UI runtime | **react@19.3.1**, **react-dom@19.3.1** | `<ViewTransition>` for push/pop |
| Language | **typescript@7.0.2** | Fallback if tooling breaks: TS 6.0.3 + ESLint |
| Lint/format | **Biome 2.5.15** (`create-next-app --biome`) | `pnpm lint` = `biome check .` |
| CSS | **tailwindcss@4.3.3**, **@tailwindcss/postcss@4.3.3** | Tokens in `globals.css` via `@theme inline` |
| ORM | **drizzle-orm@0.45.4**, **drizzle-kit@0.31.11** | **Core query builder only.** No `relations()` / `db.query.*`, so the v1 upgrade stays trivial. |
| Dev DB | **@electric-sql/pglite@0.5.10** (0.5.8 if 0.5.10 misbehaves) | Zero-setup local DB in `./.data/pglite`. Auto-migrates and seeds on boot. |
| Prod DB | Postgres 16/17 (Neon, Supabase or a VPS) via **pg@8.23.1** Pool (`max: 5`) | `attachDatabasePool` on Vercel. PG16-compatible SQL only. |
| Validation | **zod@4.6.7** | Every action input, webhook payload and settings JSON |
| Auth | Custom: Argon2id (`node:crypto`), DB sessions, `__Host-sid` cookie | No auth library |
| Animation | CSS `linear()` springs + `<ViewTransition>`; **motion@14.2.0** via `motion/react-m` + `LazyMotion` | `domAnimation` default; `domMax` lazy-loaded for drag |
| Icons | **lucide-react@1.57.0** | Per-icon tree-shaking |
| Map | **leaflet@1.9.4** (+ `@types/leaflet@1.9.22`) | Dynamic import on `/map` only |
| Storage | **aws4fetch@1.0.20** | Presigned PUT/GET to any S3-compatible store |
| Push | **web-push@3.6.7** (+ `@types/web-push`) | VAPID keys in env |
| Hosting helpers | **@vercel/functions@3.10.1** | `attachDatabasePool`; harmless elsewhere |
| Server-only guard | `server-only` | Imported by every DAL/adapter file |
| Phone normalization | `libphonenumber-js` (**server only**, `/min` metadata) | E.164. Never imported client-side. |
| PDF (server, Later/opt-in) | `pdf-lib` behind `PdfRenderer` | Only for dispute-pack upload. Customer PDFs use browser print. |

**Install**
```bash
npx create-next-app@16.4.1 crm --ts --tailwind --app --src-dir --biome --cache-components --import-alias "@/*" --use-pnpm
pnpm add drizzle-orm@0.45.4 pg@8.23.1 @electric-sql/pglite@0.5.10 motion@14.2.0 lucide-react@1.57.0 \
  zod@4.6.7 server-only aws4fetch@1.0.20 web-push@3.6.7 leaflet@1.9.4 @vercel/functions@3.10.1 libphonenumber-js
pnpm add -D drizzle-kit@0.31.11 @types/pg @types/leaflet@1.9.22 @types/web-push typescript@7.0.2 vitest
```
`vitest` is the only test runner. It runs golden tests for the commission engine, risk score, template renderer, permission resolver and lead normalizer.

**Banned in the base repo:** UI kits (shadcn copies are allowed only as hand-owned files within budget), chart libraries, date libraries (use `Intl`), moment, lodash, the AWS SDK, the Stripe/Twilio SDKs, `@react-pdf`, the full `motion` bundle, Vaul, MapLibre and next-auth/auth.js.

**`next.config.ts`**
```ts
import type { NextConfig } from 'next';
const prodDb = !!process.env.DATABASE_URL;
const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  serverExternalPackages: ['@electric-sql/pglite'],
  outputFileTracingExcludes: prodDb ? { '/*': ['node_modules/@electric-sql/pglite/**'] } : {},
  images: { unoptimized: true },
  experimental: { serverActions: { bodySizeLimit: '2mb' } },
  poweredByHeader: false,
  output: process.env.STANDALONE ? 'standalone' : undefined,
};
export default nextConfig;
```

**Environment variables.** Every one is optional unless marked *. Missing values degrade to free or dev drivers.

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Prod Postgres. If absent, PGlite is used. |
| `PGLITE_DIR` | Default `./.data/pglite` |
| `APP_URL`* (prod) | Absolute base URL for links in messages |
| `SESSION_SECRET`* (prod) | HMAC key for signed form timestamps and CSRF-like tokens |
| `CRON_SECRET`* (prod) | Bearer secret for `/api/cron/tick` |
| `STORAGE_DRIVER` | `local` \| `s3` |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` | S3/R2 storage |
| `MESSAGING_SMS_DRIVER` | `link` \| `console` \| `android_gateway` \| `twilio` \| `telnyx` |
| `EMAIL_DRIVER`, `RESEND_API_KEY`, `EMAIL_FROM` | Email |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push |
| `PAYMENTS_DRIVER` | `manual` \| `stripe`. Manual is always available alongside. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe |
| `AI_PROVIDER` | `none` \| `gemini` |
| `GEMINI_API_KEY`, `AI_MODEL_OCR` (default `gemini-3.5-flash-lite`), `AI_TIER` (`free` \| `paid`), `AI_DAILY_BUDGET` (default 20) | AI |
| `NEXT_PUBLIC_TILE_URL`, `NEXT_PUBLIC_TILE_ATTRIBUTION` | Map tiles (OSM URL in dev only) |
| `GEOCODER` | `census` (US, free, default) \| `nominatim` \| `none` |
| `TURNSTILE_SECRET` | Optional lead-form bot check |

**Hosting recommendation.** Documented in `docs/DEPLOY.md`.
- **Development:** `pnpm dev`, zero config. PGlite, local storage, `link`/`console` drivers.
- **Production (cheapest compliant):**
  - App: Docker (`STANDALONE=1`) on a small VPS, or Vercel **Pro**. Vercel Hobby is non-commercial only.
  - DB: Neon Free.
  - Storage: Cloudflare R2.
  - Cron: a Cloudflare Worker hitting `/api/cron/tick` every minute from 07:00 to 21:59 company time (protects Neon CU-hours), plus the in-app `after()` piggy-back.
  - Backups: a daily JSON export to R2.

---

## 3. Architecture & repo layout

### 3.1 Request flow
- **`proxy.ts`** does optimistic redirects only: no session cookie on an app route sends the user to `/login`. It also refreshes the sliding cookie expiry. **No DB calls.**
- **Data access layer (DAL):**
  - `src/features/*/queries.ts` → `requireUser(perm?)` → scoped Drizzle query → `'use cache'` keyed by user/role, tagged per entity.
  - Mutations in `actions.ts`: `'use server'` → `requireUser(perm)` → zod parse → transaction (domain write + `audit_log` + `activity` + `events` insert) → `updateTag(...)` → `after(() => processEvents())`.
- **Domain events:**
  - Every meaningful change inserts into `events` in the same transaction (transactional outbox).
  - The **event processor** (in `after()` and the cron tick) fans each event out to automations (→ `scheduled_messages`), notifications (push/in-app), integrations and derived computations (risk score, job financials).
- **Scheduler:** `/api/cron/tick`, guarded by `CRON_SECRET` and protected by `pg_try_advisory_lock(42)`, runs:
  - due `scheduled_messages`
  - `job_queue` tasks (AI, PDF, evidence builds, email)
  - reminders
  - period closes
  - expiries
  - SLA escalations
  - daily digests

  The piggy-back trigger is `after(() => maybeTick())` on authenticated requests, throttled to once per 60 s via the `scheduler_state` row.

### 3.2 Folder layout
```
/
├─ CLAUDE.md                     # rules for future Claude sessions (§15.5)
├─ AGENTS.md                     # Next-generated block (keep) + pointer to CLAUDE.md
├─ docs/  SPEC.md RESEARCH.md DEPLOY.md budget.md MODULES.md CHANGELOG.md
├─ drizzle/                      # generated SQL migrations (never hand-edit applied ones)
├─ public/  sw.js  embed.js(built)  icons/
├─ scripts/  seed.ts  export.ts  import-csv.ts  build-embed.ts  gen-vapid.ts
├─ src/
│  ├─ app/
│  │  ├─ (auth)/ login/ signup/ invite/[token]/ reset/[token]/
│  │  ├─ (app)/                  # authenticated shell (TabBar/Sidebar)
│  │  │  ├─ today/  schedule/  leads/  customers/[id]/  jobs/[id]/ (evidence/, print/)
│  │  │  ├─ estimates/[id]/  invoices/[id]/  payments/  disputes/[id]/
│  │  │  ├─ messages/ (outbox/, [customerId]/)  reviews/  parts/  inventory/
│  │  │  ├─ pay/ (settlements/[id]/, statements/)  vehicles/[id]/  tools/[id]/
│  │  │  ├─ map/  insights/  team/[id]/  notifications/  more/  approvals/  tasks/  time/
│  │  │  └─ settings/ (company, branding, services, pricebook, taxes, payments, deposits,
│  │  │              compliance, commission, messaging, templates, automations, reviews,
│  │  │              tags, custom-fields, checklists, reminders, vehicles, tools, features,
│  │  │              permissions, lead-sources, api-keys, integrations, data, audit)
│  │  ├─ (public)/  j/[token]  e/[token]  i/[token]  p/[token]  r/[token]  t/[token]
│  │  │              f/[publicKey]  sms-terms  privacy  s/[token] (sub job, Later)
│  │  ├─ api/  v1/leads/…  hooks/…  cron/tick  webhooks/stripe  uploads/presign
│  │  │        uploads/complete  push/subscribe  location  inbound/sms/[driver]  export
│  │  ├─ manifest.ts  apple-icon.png  layout.tsx  globals.css
│  ├─ features/<module>/        # see §15.1
│  ├─ adapters/  messaging/ email/ payments/ storage/ ai/ maps/ geocode/ push/ pdf/ vin/
│  ├─ lib/  auth/ db-helpers/ money.ts time.ts phone.ts template.ts events.ts
│  │        permissions.ts audit.ts ids.ts hash.ts quiet-hours.ts ratelimit.ts tokens.ts
│  ├─ db/  index.ts  schema/<module>.ts  seed/  enums.ts
│  ├─ ui/  components/ (§12.6)  motion/springs.ts  icons.ts
│  └─ client/  outbox.ts (IndexedDB)  image.ts  geo.ts  sms-href.ts  push.ts  install-prompt.ts
└─ tests/  golden/ (commission, risk, template, permissions, leads)
```

### 3.3 Tenancy
- **Single tenant per deployment.** One business per clone, matching the owner's "clone and customize" workflow.
- A singleton `company` row holds the profile and settings.
- Tables carry **no** `company_id`. A future multi-tenant fork adds `company_id` plus row filters in the DAL; every query already goes through the DAL, which keeps that change mechanical.
- Signup creates the company and the first admin **only when no company exists**. After that, the public signup page shows "Ask your admin for an invite" unless `settings.auth.open_signup` is on, in which case new signups land as `pending` users awaiting approval.

---

## 4. Roles & permissions

### 4.1 Model
- **Roles:** `admin`, `office`, `tech`. The schema allows more roles (`roles` table) so a clone can add `dispatcher`, `sales`, `subcontractor` or `bookkeeper` without migrations.
- **Permission keys** are dotted strings declared in each module's `permissions.ts` and aggregated in `src/lib/permissions.ts` (single source of truth, typed union `Perm`).
- **Resolution** (pure function, golden-tested):
  ```
  effective(user, perm) =
    user_permission_overrides[user, perm]?.effect            // 'allow' | 'deny' wins
    ?? role_permissions[user.role, perm]?.granted             // admin-edited role grid
    ?? DEFAULT_GRANTS[user.role].includes(perm)               // code defaults (table below)
  ```
- **Locks:**
  - `admin` always has `settings.permissions` and `users.manage`; these can't be revoked from the role.
  - At least one active admin must exist.
  - Overrides can't grant `settings.permissions` to non-admins.
- **Scoped permissions.** Some actions carry a numeric limit in `company.settings.limits`:
  - `estimates.discount` → `max_discount_pct` per role
  - `payments.refund` → `max_refund_cents` per role
  - `parts.approve_reimbursement` → `auto_approve_under_cents`
- **UI** (`/settings/permissions`):
  - A grid of modules (sections) × roles (columns) with iOS toggles.
  - A per-user page lists overrides with a three-state control: Inherit / Allow / Deny.
  - Changes are audited.
  - Sessions re-read permissions on every request (cached with tag `perm:{userId}`, invalidated on change).

### 4.2 Complete permission key list and default grants
Legend: **A** admin, **O** office, **T** tech. ● = granted by default.

| Key | Meaning | A | O | T |
|---|---|---|---|---|
| **Insights** |||||
| `insights.view_own` | Personal dashboard (own KPIs/earnings) | ● | ● | ● |
| `insights.view_ops` | Operations dashboard (leads, schedule, AR, outbox) | ● | ● | |
| `insights.view_financials` | Revenue, margin, payroll cost, source ROI | ● | | |
| `insights.view_team` | Per-tech leaderboard & comparisons | ● | ● | |
| `reports.export` | CSV export of any report | ● | | |
| **Customers** |||||
| `customers.view` | View customer list/records (masked contact if lacking `contact_view`) | ● | ● | ● (assigned jobs only) |
| `customers.view_all` | See all customers, not just ones on own jobs | ● | ● | |
| `customers.contact_view` | Full phone/email/address outside active job window | ● | ● | |
| `customers.create` | Create customers/properties | ● | ● | ● |
| `customers.edit` | Edit customers/properties | ● | ● | |
| `customers.delete` | Soft-delete / anonymize | ● | | |
| `customers.merge` | Merge duplicates | ● | ● | |
| `customers.export` | Export customer list | ● | | |
| `customers.flags_manage` | Set do-not-service, prepay-required, dispute flags | ● | ● | |
| **Leads** |||||
| `leads.view` | View leads inbox | ● | ● | |
| `leads.create` | Manual lead entry | ● | ● | ● |
| `leads.edit` | Edit/assign/mark contacted/lost | ● | ● | |
| `leads.convert` | Convert lead → job/estimate | ● | ● | |
| `leads.receive_alerts` | Gets new-lead push/escalations | ● | ● | |
| **Jobs & schedule** |||||
| `jobs.view_all` | All jobs | ● | ● | |
| `jobs.view_own` | Jobs assigned to me | ● | ● | ● |
| `jobs.create` | Create jobs | ● | ● | ● |
| `jobs.edit` | Edit job details (non-financial) | ● | ● | |
| `jobs.assign` | Assign/reassign techs, dispatch board | ● | ● | |
| `jobs.reschedule` | Change date/window | ● | ● | |
| `jobs.status_own` | Move own job through tech flow | ● | ● | ● |
| `jobs.status_any` | Change status of any job | ● | ● | |
| `jobs.cancel` | Cancel before arrival | ● | ● | |
| `jobs.cancel_after_arrival` | Cancel after `arrived` (needs reason + photo; queued for admin review if not admin) | ● | | ● |
| `jobs.reopen` | Reopen completed/closed job | ● | | |
| `jobs.override_requirements` | Complete without required photos/signature/checklist | ● | | |
| `jobs.approve_start` | Approve starting a Critical-risk job (§11.1); request arrives in `/approvals` | ● | | |
| `jobs.review_cancellations` | Review after-arrival cancellations in `/approvals` (ok / flagged) | ● | | |
| `jobs.set_custom_rate` | Set a per-job commission rate (`jobs.custom_rate_bps`) | ● | | |
| `jobs.view_financials` | See job cost/margin/commission | ● | | |
| `schedule.view_all` | Company calendar | ● | ● | |
| `time.clock_self` | Clock in/out | ● | ● | ● |
| `time.manage` | Edit others' time entries | ● | | |
| `tasks.view_all` | See and assign everyone's tasks (lead retries, warranty claims, restock, follow-ups). Own tasks are always visible. | ● | ● | |
| **Estimates** |||||
| `estimates.view` | View estimates (own jobs if tech) | ● | ● | ● |
| `estimates.create` | Create/edit drafts | ● | ● | ● |
| `estimates.send` | Send to customer | ● | ● | ● |
| `estimates.discount` | Apply discount up to role limit | ● | ● | ● |
| `estimates.approve_on_behalf` | Mark approved with verbal consent (logged) | ● | ● | |
| `pricebook.manage` | Edit price book items | ● | ● | |
| **Invoices & payments** |||||
| `invoices.view` | View invoices (own jobs if tech) | ● | ● | ● |
| `invoices.create` | Create/issue invoice | ● | ● | ● |
| `invoices.revise` | Revise issued invoice (creates revision) | ● | ● | |
| `invoices.void` | Void / write off | ● | | |
| `payments.collect` | Take card payment / send pay link | ● | ● | ● |
| `payments.record_manual` | Record cash/check/Zelle/Venmo | ● | ● | ● |
| `payments.keyed_entry` | Type a card number (phone/MOTO). Only works when the company setting `settings.payments.allow_keyed` is on | ● | ● | |
| `payments.verify_manual` | Mark manual payment verified in bank | ● | ● | |
| `payments.view_all` | Payments list, reconciliation | ● | ● | |
| `payments.refund` | Issue refund up to limit | ● | | |
| `deposits.waive` | Waive required deposit | ● | ● | |
| `disputes.view` | Disputes list | ● | ● | |
| `disputes.manage` | Edit/submit/accept dispute evidence | ● | | |
| `evidence.view` | View/print evidence pack | ● | ● | |
| **Photos** |||||
| `photos.upload` | Upload photos to jobs | ● | ● | ● |
| `photos.delete` | Soft-delete photos (audited) | ● | | |
| **Messaging & automation** |||||
| `messages.send` | Send to customers (own jobs if tech) | ● | ● | ● |
| `messages.view_all` | All conversations | ● | ● | |
| `messages.outbox_all` | Work everyone's outbox | ● | ● | |
| `messages.bulk_send` | Bulk/broadcast (requires typed confirm) | ● | | |
| `automations.manage` | Edit automations | ● | | |
| `templates.manage` | Edit message/doc templates | ● | ● | |
| `reviews.view` | Review requests & stats | ● | ● | ● (own) |
| `reviews.send_manual` | Manually trigger review request | ● | ● | |
| **Parts & inventory** |||||
| `parts.add_to_job` | Add parts to job | ● | ● | ● |
| `parts.view_cost` | See part cost & margin | ● | ● | ● (own purchases) |
| `parts.submit_receipt` | Upload tech-paid receipt | ● | ● | ● |
| `parts.approve_reimbursement` | Approve tech-paid parts | ● | | |
| `inventory.view` | View stock (own truck if tech) | ● | ● | ● |
| `inventory.manage` | Adjust stock, transfers, POs | ● | ● | |
| `inventory.request_restock` | Request restock for own truck (creates a `restock` task) | ● | ● | ● |
| **Pay & payroll** |||||
| `payroll.view_own` | Own earnings, statements, ledger | ● | ● | ● |
| `payroll.view_all` | All techs' pay | ● | | |
| `payroll.manage` | Run periods, adjustments, settlements | ● | | |
| `payroll.approve` | Approve settlements | ● | | |
| `payroll.payout` | Record payouts / NACHA export | ● | | |
| `comp_plans.manage` | Edit commission plans & assignments | ● | | |
| `cash.remit_own` | Record own cash remittance | ● | ● | ● |
| `cash.receive` | Confirm cash received from tech | ● | ● | |
| `payroll.bank_edit_own` | Enter/change own direct-deposit bank details (change triggers admin alert + payout hold, M16) | ● | ● | ● |
| **Vehicles** |||||
| `vehicles.view_own` | Assigned vehicle | ● | ● | ● |
| `vehicles.view_all` | Fleet | ● | ● | |
| `vehicles.manage` | Add/edit vehicles, reminder rules, docs | ● | | |
| `vehicles.log` | Submit odometer/fuel/service/inspection logs | ● | ● | ● |
| `vehicles.log_approve` | Approve logs/documents | ● | | |
| `vehicles.log_trusted` | Own logs skip `always_review` and use `auto_if_evidence`; rules-first anomaly flags still force review. Grant per user via overrides | | | |
| `vehicles.report_issue` | Report vehicle issue | ● | ● | ● |
| **Tools** |||||
| `tools.view_own` | My tools | ● | ● | ● |
| `tools.view_all` | All tools | ● | ● | |
| `tools.manage` | Add/edit/assign/retire tools | ● | | |
| `tools.audit_submit` | Complete tool audits | ● | ● | ● |
| `tools.audit_review` | Review audits/incidents | ● | | |
| `tools.report_incident` | Report own tool lost/stolen/damaged | ● | ● | ● |
| `tools.maintenance_log` | Log maintenance on a tool in own custody | ● | ● | ● |
| **Map & location** |||||
| `map.view` | Live tech map | ● | ● | |
| `location.share` | Send location pings while on shift | | | ● |
| **Team & settings** |||||
| `users.invite` | Invite users | ● | | |
| `users.manage` | Edit/deactivate users, roles, worker type | ● | | |
| `settings.manage` | General settings (company, services, taxes, invoices) | ● | | |
| `tags.manage` | Create/edit/archive custom tags (applying tags is covered by the entity's edit perm) | ● | ● | |
| `reminders.manage` | Create/edit custom reminders (§M13) | ● | ● | |
| `custom_fields.manage` | Custom fields and checklist templates | ● | | |
| `settings.permissions` | Role grid & user overrides | ● | | |
| `settings.features` | Feature flags | ● | | |
| `settings.integrations` | Payment/SMS/email/AI/storage credentials | ● | | |
| `settings.api_keys` | Lead sources & API keys | ● | | |
| `audit.view` | Audit log | ● | | |
| `data.export` | Full export | ● | | |
| `data.import` | CSV import | ● | | |

Notes:
- "(own)" and "(assigned jobs only)" restrictions are enforced in the DAL, not just the UI.
- Techs see customer contact details only during the **active job window**: from `scheduled_start − 2h` (or `en_route_at`) to `completed_at + 24h`. Outside it they see a masked number (`•••• 4242`) and a Call/Text button routed through the app (logged).
- Customer views by techs are logged to `audit_log` (`customer.viewed`).
- **Permissions vs. settings (two-key rule).** Where a company setting and a permission both apply, **both** must allow the action. Examples: keyed cards need `settings.payments.allow_keyed` AND `payments.keyed_entry`; a tech vehicle log needs `vehicles.log` AND `settings.vehicles.policies[type].tech_can_log`; tool features need flag `tools` AND `users.uses_company_tools`.
- **Settings page → required permission:** `settings.permissions` (Permissions), `settings.features` (Features), `settings.integrations` (Integrations), `settings.api_keys` (Lead sources & API keys), `automations.manage` (Automations), `templates.manage` (Templates), `tags.manage` (Tags), `reminders.manage` (Reminders), `custom_fields.manage` (Custom fields, Checklists), `comp_plans.manage` (Commission & payroll), `pricebook.manage` (Price book), `audit.view` (Audit), `data.export`/`data.import` (Data). Every other settings page needs `settings.manage`.
- **Approvals queue visibility:** `/approvals` shows only items the viewer can decide (`vehicles.log_approve`, `parts.approve_reimbursement`, `jobs.review_cancellations`, `jobs.approve_start`, `payroll.manage` for settlement flags).

---

## 5. Modules

Each module lives in `src/features/<key>/` (§15.1). The feature-flag key is listed per module; modules with no flag are always on. Flags live in `company.settings.features` and are toggled in `/settings/features`. Disabling a module hides its nav, rejects its actions (`FeatureDisabledError`) and suppresses its automations. Data is never deleted.

| # | Module | Key | Flag (default) |
|---|---|---|---|
| M01 | Auth & onboarding | `auth` | — |
| M02 | Team & roles | `team` | — |
| M03 | Customers & properties | `customers` | — |
| M04 | Leads & intake API | `leads` | `leads` (on) |
| M05 | Jobs, scheduling & dispatch | `jobs` | — |
| M06 | Technician mobile experience ("Tech") | `tech` | — |
| M07 | Estimates | `estimates` | `estimates` (on) |
| M08 | Invoices & receipts | `invoices` | — |
| M09 | Deposits & payments | `payments` | `deposits` (on) |
| M10 | Chargeback protection | `disputes` | `chargeback_protection` (on) |
| M11 | Photos & evidence media | `media` | `photos` (on), `before_after` (on) |
| M12 | Messaging | `messaging` | — |
| M13 | Automations & reminders | `automations` | — |
| M14 | Review requests | `reviews` | `reviews` (on) |
| M15 | Parts & inventory | `parts` | `parts` (on), `inventory` (off) |
| M16 | Commission, payroll & payouts | `payroll` | `payroll` (on) |
| M17 | Vehicles | `vehicles` | `vehicles` (on) |
| M18 | Tools | `tools` | `tools` (off) |
| M19 | Live tech map | `map` | `map` (on) |
| M20 | Insights dashboards | `insights` | — |
| M21 | Settings | `settings` | — |
| M22 | Notifications, activity & audit | `notify` | — |
| M23 | Customer portal (magic links) | `portal` | — |
| M24 | Data import/export & backups | `data` | — |

---

### M01 Auth & onboarding

**MVP**
- **Signup** (`/signup`), available only when no company exists:
  - Fields: company name, your name, email, mobile, password (≥ 10 chars, checked against a 1k common-password list bundled server-side), time zone (auto-detected), state (feeds the compliance profile), and a trade preset (`generic` in MVP).
  - Creates the `company` row, the admin user and the seed data in one transaction (§15.3), then lands on the **Setup checklist**.
- **Setup checklist** (dismissible card on Today until complete). It targets "under an hour" setup:
  1. Logo and brand color
  2. Business hours and service area ZIPs
  3. Job types and prices (or import a CSV price book)
  4. Tax rate
  5. Payment methods (manual on; Stripe optional)
  6. Google review link
  7. Invite team
  8. Commission plan
  9. Add vehicle(s)
  10. Lead form snippet
  11. Install the app and enable push
  12. Pick optional modules for this trade: before/after photos, tools, inventory, vehicles, map (feature flags; changeable later)
  13. Cash policy: do techs keep the cash they collect? (sets `tech_keeps_cash` on the default plan)
- **Login** (`/login`): email + password, "remember me" (30-day sliding session, otherwise 12 h).
- **Throttling:** 5 failures per email per 15 min, and 20 per IP per 15 min, tracked in `login_attempts`. Generic error messages.
- **Password hashing:** Argon2id PHC string (m=19456, t=2, p=1). Rehash on login if the parameters changed. The scrypt fallback exists only for Node < 24.7.
- **Sessions:**
  - 32 random bytes, base64url, sent as cookie `__Host-sid` (`sid` on http localhost), HttpOnly, Secure, SameSite=Lax.
  - The DB stores only `sha256(token)`.
  - `last_seen_at` is updated in `after()` at most once every 5 min.
  - "Sign out other devices" is available.
- **Invites:**
  - Admin enters name, email/phone, role and worker type; the system creates `invites` with a 7-day token.
  - The invite link is delivered by email and/or `sms:` link.
  - `/invite/[token]` lets the invitee set a password and accept the **monitoring notice** (techs, ⚖️ location tracking) and the **e-records consent**.
- **Password reset:** email link, 30-min single-use token. If no email driver is configured, an admin can generate a reset link to share.
- **Offboarding:** deactivating a user immediately revokes all sessions and push subscriptions. Their open jobs appear in a "reassign" list, and any cash they hold is flagged.
- **Install prompt:** on iOS Safari, not standalone, after the 2nd visit, show the "Add to Home Screen" instructions sheet. On Chromium, use `beforeinstallprompt`.

**Later**
- Passkeys (WebAuthn)
- Magic-link login for techs
- 2FA (TOTP) for admins
- SSO

---

### M02 Team & roles

**MVP**
- **Team list:** avatar, role, status (active/invited/deactivated), worker type, clocked-in state, cash held.
- **User profile:**
  - Name, photo (shown on the customer "tech card"), phone, email, license # (printed on documents where required), color (calendar), skills/service types, service ZIPs, `worker_type` (`w2` | `1099`), comp plan assignment, `uses_company_tools`, `uses_company_vehicle`, home base address (for distance), and hire date.
- **Working hours and time off** (techs, on the team member page, `users.manage`): booking availability (M05) and the Assign hub read them.
  - **Working hours** (`users.work_hours`): the company's business hours (the default), or each weekday on or off with a start and end time, in the company time zone.
  - **Time off** (`time_off` rows): whole days or part of a day, with an optional note. Removing one asks first. Every change is audited.
- **Role change, deactivate, reset password, and per-user permission overrides** (link to M21).
- **Time clock:**
  - `time_entries`: clock in/out with geostamp, plus optional odometer photo when vehicles are enabled and `require_odometer_on_clock` is on.
  - Breaks.
  - Needed for the W-2 floor check and the mileage log.
- **Compensation agreement status:** signed or unsigned per plan version (M16).

**Later**
- A team calendar view of working hours and time off (the hours and time off themselves are MVP, above)
- Skills-based auto-dispatch
- Subcontractor role with a job link and no login

---

### M03 Customers & properties

**MVP**
- **Customer:**
  - Type (`residential` | `commercial` | `property_manager` | `home_warranty`), name and company name, phones (primary + alt, E.164), email, preferred channel (`sms` | `whatsapp` | `email` | `call`), language, `sms_status` (derived from the consent ledger), tags, custom fields, notes, source and first-touch attribution, lifetime value (derived), and balance (derived).
  - **Flags:** `do_not_service`, `prepay_required`, `dispute_history` (auto-set on a dispute), `vip`, `tax_exempt` (+ certificate media), `do_not_text`.
- **Properties:** one customer has many service addresses.
  - Fields: street/unit/city/state/zip, lat/lng (geocoded), access notes (gate code stored **encrypted at rest** and revealed in the active job window), pets, site contact name/phone, property type, and equipment list (custom fields: e.g. door model, opener, water heater, lock type).
  - Landlord/tenant: a property may have a `site_contact` different from the bill-to customer, which feeds the risk score.
- **Customer timeline** (one feed, newest first): messages in and out, calls logged, notes, job status changes, estimates (sent/viewed/signed), invoices, payments, refunds, photos, reviews, consent events and disputes. Filter chips: All / Messages / Jobs / Money / Notes.
- **Search:** name, phone (any format → E.164 match), email, address, job #, invoice #. Uses `ILIKE` + trigram-free prefix indexes; it must answer in < 150 ms for 50k customers.
- **Duplicate detection:**
  - Exact match on E.164 phone or email.
  - A fuzzy same-address prompt (normalized street + zip).
  - Merge tool: choose the surviving fields, then re-point all FKs, write an audit entry and keep a `merged_into_id` tombstone.
- **Masked contact info for techs** outside the job window (§4.2 notes). Tap-to-call/text goes through the app and is logged.
- **Customer actions:** New job, New estimate, Text, Call, Email, Request review, Add note, Add property, Record payment, View statement (all open invoices).
- **Anonymize** (GDPR/CCPA-style request): replaces PII with placeholders and keeps financial records.

**Later**
- Memberships / maintenance plans with recurring billing
- Customer-level portal login
- Multiple contacts per customer

---

### M04 Leads & intake API

**MVP**
- **Leads inbox** (`/leads`): a grid of lead boxes, longest wait first.
  - Phones start with 2 columns. A 1 / 2 switch is remembered on the device (cookie `leads-cols`, read by the server, so the grid never flashes). Tablets and desktop fit as many columns as there's room for.
  - A count line ("11 open leads · Longest wait first"), status chips with counts (New, Contacted, Qualified, Check while there are any, Booked, Lost, Spam; tapping the picked chip again goes back to all open leads) and a Filter chip whose sheet holds Mine, Overdue and the sources. An empty inbox shows a big **New lead** button.
  - **One count everywhere:** the Leads badge (tab and sidebar) is the New chip's number: status `new` with `spam_score` under `settings.leads.spam_review_threshold`. Everyone sees the same number.
  - A **Grid / Map** switch on phones and tablets; desktop (≥ 1024 px) shows the grid and the lead map side by side (below).
- **Lead box:** the initials inside a **speed-to-lead timer** ring (green < 5 min, amber < 15, red beyond, from `created_at` to `first_response_at`; 2-column boxes show a new lead's wait under it), the name, the job and status, the street (not just the ZIP), and returning-customer and outside-the-area marks; 1-column boxes also show the day they asked for. Its buttons follow the state, and a closed lead keeps its way back:
  - open: Call, Text, Directions, Open card
  - "Check": Looks legit and Spam (Book stays available on the card)
  - lost: Reopen; spam: Not spam; booked: Open job (and Reopen once its job is cancelled)
  - Tapping the box opens the lead card. Swiping left on an open lead offers Lost and Spam, each with Undo.
- **Lead card:** slides up over the inbox instead of opening a page: a bottom sheet on phones (drag down or ✕ to close, back where you were), a centered sheet on tablet and desktop. `?lead=<id>` mirrors it, so Back closes it and a link opens it again.
  - A TL;DR on top (name, status, job type, street, the arrival window or the day they asked for), then boxes: Phone (call, text, copy), Address (mini map, directions, copy), Wants or Arrives, Quote & source, Last contact, Notes, Photos. Then the action groups, and a booking bar with **Book** as the one primary button.
  - `/leads/[id]` stays for links and printing: the same layout, plus source and attribution, the intake log, the activity and (for admins) the raw payload.
- **Lead statuses:** `new` → `contacted` → `qualified` → `booked` (converted) | `lost{reason}` | `spam`. Lost reasons are configurable: price, timing, out of area, no answer, went with competitor, other.
- **Actions** (on the lead card, in four groups with no "…" menu; every action has its way back):
  - **Reach:** Call, Text (outbox), Email. Call is `tel:`, then an outcome sheet: connected / no answer / voicemail / wrong number. Any attempt answers the timer and moves `new` → `contacted`. "No answer" creates a `tasks` row (kind `lead_retry`, due +15 min) and an auto-drafted text. "Wrong number" cancels the lead's queued follow-up texts and open call-back tasks. A started call is kept on the device until its outcome is saved; after a reload or a Skip the app asks again (up to 3 times, within 2 hours).
  - **Move forward:** Contacted ↔ Not contacted, Qualify ↔ Unqualify (back to Contacted), Looks legit on a "Check" lead (clears the score and creates the customer), **Book** (the booking flow below), and Open job once booked. Book replaces Convert; the `/jobs/new?leadId=` and `/estimates/new?leadId=` links still prefill from a lead.
  - **Manage:** Claim ↔ Release (first-to-claim, or round-robin when `settings.leads.assignment = 'round_robin'`). **Take over** of someone else's lead asks first and notifies the previous owner. Edit (name, phone, email, address, service, price, notes; a customer that still has the old phone or email is fixed too) and Tags.
  - **Close:** Lost (with a reason) ↔ Reopen, Spam ↔ Not spam.
  - **Reverse rules:** Reopen (a lost lead, or a booked one once its job is cancelled) and Not spam return the lead to the open status it had before, read from its status history (without history: Contacted when someone already answered, else New). A booked lead whose job isn't cancelled stays booked.
  - **Undo:** every change shows Undo for 5 seconds. Each status change writes a `lead_events` row (kind `status`) with what it overwrote (lost reason, spam score and reason, converted job). Undo restores it while that row is still the lead's latest status change ("This lead changed since…" otherwise). Inside the card the Undo shows in a bar above the booking bar.
- **Booking: one flow for every lead (Who → What → When).** Book on any lead (phone, website, Google, Thumbtack…) opens `/leads/new/schedule?leadId=<id>`. A phone caller starts at Who, the New lead form (manual lead entry, below).
  - **What:** the job type cards (Free estimate, Service call, Project; M05) with the trade's jobs as "What's the job?" chips under the picked card; urgency (normal / urgent / emergency), after-hours and the customer's notes (prefilled from the lead). A lockout-style job says it keeps the ID and ownership check.
  - **When:** a week strip from today (28 days; up to 60 when they asked for a later day). The day they asked for is preselected and tagged "Asked" (else the best day, else the first open one). The day shows its 2-hour arrival windows ("Arrives 8–10 AM"), open or full by the availability rules (M05); the open window with the least extra driving says "Best · adds N mi". A day with nothing open says why (closed, outside the service area, too far, fully booked), with the soonest open day and "Book by hand on New job".
  - **No tech is picked.** Book creates the job with the window, job type, priority, after-hours, the customer's notes and the day they asked for (`jobs.custom.requested_date` / `requested_window`), marks the lead booked and assigns nobody, so the job waits in the Assign hub (M05 "Needs a tech"). The lead's quoted price becomes the draft invoice's first line. Booking refuses a spam or already booked lead, a lead with no address (or no name, phone and email), a day or window already past, and a chip that isn't under its card. A "Check" lead gets its customer when it is booked.
  - **Done** shows at once: "Booked: arrives Fri, Oct 23 · 8–10 AM", the customer, job and number, and "Confirmation goes out when a tech is assigned" (the message status fills in after). Buttons: **Assign a tech** (the hub with this job picked; `jobs.assign`), **Next lead** and Open job.
- **Auto-acknowledge:** automation `lead.created` → instant customer text/email: "Got it, we'll call within {{company.lead_response_minutes}} min." In link mode this lands as a high-priority outbox card plus an email to the customer if an email exists (email is automatic). Allowed outside quiet hours because the customer just asked.
- **Escalation:** no `first_response_at` after 5 min → push to admin. After 15 min → push to all `leads.receive_alerts` users. After hours → auto-reply with the emergency line if configured.
- **Phone leads count as answered:** a lead typed in while talking to the caller stamps `first_response_at/by` (the office user, channel call), moves to `contacted` and is claimed by them. The missed-lead automations (auto-reply, the 5/15-min alerts, "we tried to reach you") run only while `lead.status = new`, so they skip it.
- **Intake endpoints** (§8):
  - JSON (`X-Site-Key` public key + allowed origins, or `Authorization: Bearer sk_…`)
  - form-encoded POST with 303 redirect
  - preset hooks (generic, zapier, make, thumbtack, angi, google_ads_leadform)
  - inbound-email endpoint (for a Cloudflare Email Worker, Later)
- **Tolerant schema with aliases:**

  | Field | Accepted aliases |
  |---|---|
  | name | `name` \| `full_name` \| `first_name` + `last_name` |
  | phone | `phone` \| `tel` \| `phone_number` |
  | email | `email` |
  | address | `address` \| `street,city,state,zip` |
  | service | `service_type` \| `service` \| `job_type` |
  | price | `price` \| `budget` \| `quoted_price` |
  | date | `preferred_date` \| `date` \| `appointment_date` |
  | time window | `preferred_window` |
  | notes | `notes` \| `message` \| `comments` |
  | attribution | `utm_*`, `gclid`, `gbraid`, `wbraid`, `fbclid`, `msclkid`, `referrer`, `landing_url`, `page_url` |
  | consent | `sms_consent`, `marketing_consent`, `consent_text` (checkbox values `on`/`true`/`1`/`yes` all mean true) |
  | after-submit | `redirect` (form posts only; must match an allowed origin, else the hosted thank-you page) |

  - Unknown fields go to `extra jsonb`. The raw body goes to `lead_events.raw` for replay or remapping.
  - Price is parsed from "$1,200", "1200", or "1200.50" into cents.
  - Dates are parsed from ISO or `MM/DD/YYYY`, in the company time zone.
  - Service names are fuzzy-matched to `service_types` (case-insensitive, then alias list); unmatched values are kept as text.
- **Per-source mapping:** each `lead_source` has an optional JSON-path mapping (`customer.displayName → name`) editable in admin, with a "test with last payload" button.
- **Spam defense:**
  - Honeypot `company_website`.
  - Signed render timestamp (`_ts` HMAC); reject anything under 3 s. **`_ts` is only enforced when present or when the source has `require_ts = true`** (the default for sources created as "JS snippet" or "hosted form"). A plain static-HTML form cannot mint a signed timestamp, so sources created as "Plain HTML form" default to `require_ts = false` and rely on the honeypot, rate limits, optional Turnstile and a soft `spam_score` (notes with > 2 URLs, no phone and no email, non-US phone, gibberish name). A lead with `spam_score ≥ settings.leads.spam_review_threshold` lands in the inbox under a **"Check"** filter instead of being discarded, so no real lead is silently lost.
  - Rate limit 10/min per IP+key, plus a daily cap per key.
  - Allowed origins.
  - Optional Turnstile.
  - Max body 32 KB.
  - Spam returns a **fake 200** and is stored as `status=spam`.
- **Dedupe:**
  - Unique `(source_id, external_id)`.
  - A 10-min hash of phone+service catches double-submits.
  - Customer match by phone, then email.
  - An open lead for the same customer + service within 14 days receives a "touch" (`lead_events`) instead of creating a new lead, and is marked `returning`.
  - Manual entry never merges silently: when the phone already has an open lead, the office chooses first (Repeat callers, below).
- **Consent capture:** if `sms_consent=true`, write a `consent_events` row with the text shown, page URL, IP and UA. Never pre-check consent, and **never make the consent box required to submit** (10DLC rejection 30931). Marketing consent (`marketing_consent`) is a **separate**, optional, unchecked box; `embed.js` renders both when missing.
- **`embed.js`** (< 3 KB gz, no dependencies, built by `scripts/build-embed.ts`):
  - `<script src="{APP_URL}/embed.js" data-key="pk_live_…" defer></script>`
  - Enhances any `<form data-crm-lead>`: fills hidden UTM/click-ID/referrer/landing fields (first and last touch, kept in `localStorage` for 90 days, try/catch-wrapped), adds `_ts`, injects the honeypot, renders the compliant **unchecked** SMS consent checkbox if missing, loads Turnstile when the key requires it, submits via fetch with an inline success state, and falls back to a normal POST.
- **Hosted form** `/f/[publicKey]` for sites that can't run scripts. Copy-paste plain HTML and WordPress/Webflow instructions live in `/settings/lead-sources`. Ready-to-paste snippets for all three integration levels (plain HTML form, JS snippet, JSON API) are specified in §8.5 and generated with the source's real key.
- **Three integration levels, all MVP:** (1) plain `<form method="post">` on any static site, no JS needed; (2) the same form plus `embed.js` for attribution, inline success and stronger spam defense; (3) JSON `POST /api/v1/leads` from any backend, Zapier/Make, or a marketplace preset.
- **Lead-source ROI:** `source_cost_cents` per lead (from payload, e.g. Thumbtack `leadPrice`) plus monthly `source_spend` entries.
- **Manual lead entry** requires a source ("How did you hear about us?"). It is **New lead** (`/leads/new`), the Who step of the booking flow: phone and name, source and quoted price, the verbal text consent and the address fit the first phone screen, then the job type tiles, urgency, after-hours and notes; the field being typed in stays clear of the sticky bars and the keyboard. **Save & book** goes on to What and When; **Save lead only** stops there.
  - **Repeat callers:** when the phone already has an open lead, the form asks "Update their open lead or start a new one?" and saves nothing until the office picks. Update puts what was typed on that lead (the new address replaces the old one, new notes go under the old ones, plus the job type, urgency and after-hours). Start a new one creates a second lead: the intake skips its 10-minute hash and same-service merges but still links the matched customer.
- **Lead map:** open inbox leads ("Check" left out) as pins beside today's jobs.
  - Phones and tablets: the inbox's Grid / Map switch. The map fills the screen and the count line, chips and lead boxes ride in a draggable drawer (peek, half, full). Desktop (≥ 1024 px): the map sits beside the grid.
  - Full screen through the app's full-screen hub (`?fs=leads-map`; Back exits): the corner button, or dragging the drawer all the way down. "Show N leads" brings the drawer back.
  - Pins: the initials in the timer ring, colored like the box; the two newest unanswered leads still inside the 15-minute ring pulse; overlapping pins fold to dots; pins at one address fan out. Tapping a pin opens that lead's card. Today's jobs show as small markers (`jobs.view_all`, else your own; outside the contact window only with `customers.contact_view`).
  - Positions come from the lead's property (`properties.lat/lng`, geocoded). Intake gives every lead it doesn't flag (with a phone or email) a customer and property. The `leads.map_backfill` cron hook (every 10 min) does the same for open leads with a street and ZIP but no property, and queues one more geocode a day for a property still waiting. A note says how many leads are on the map and why the rest aren't (no address, no property yet, still being placed, couldn't be placed).

**Later**
- Inbound-email parser (Cloudflare Email Worker + `postal-mime`) with Thumbtack/Angi/LSA/Yelp templates
- Missed-call text-back (paid telephony driver)
- Google LSA API polling
- Online booking page with live slots

---

### M05 Jobs, scheduling & dispatch

**Job status machine (MVP)**
```
unscheduled ─► scheduled ─► confirmed ─► en_route ─► arrived ─► in_progress ─► completed ─► closed
     │             │            │           │           │            │  ▲  │
     │             │            │           │           │            ▼  │  │
     │             │            │           │           │         on_hold  │ (waiting parts/approval)
     └─────────────┴────────────┴───────────┴───────────┴──► cancelled{reason}
```
- **Payment status is separate and derived from the ledger:** `none | deposit_paid | partial | paid | refunded | disputed`. "Paid" is never a job status, which avoids state coupling.
- **`closed`** = completed + balance 0 + (included in a locked settlement, or manually closed by admin). Closed jobs are read-only; any change goes through reopen (`jobs.reopen`, audited).
- **Every transition:**
  - writes `job_status_events` with actor, time, lat/lng/accuracy and distance to the property;
  - emits `job.status_changed` and a specific event (`job.en_route`, etc.);
  - goes through the guard functions below.

| Transition | Guards |
|---|---|
| → `scheduled` | Needs date + window/start + ≥ 1 assignee |
| → `en_route` | Assignee only. **Does not change any other job.** |
| → `arrived` | Geostamp captured. Distance > `settings.jobs.arrival_radius_m` (default 300 m) adds a soft warning flag, never a block. |
| → `in_progress` | When `risk_band ≥ medium` or `service_type.requires_signed_estimate`, a signed estimate or work authorization is required. Locksmith-type service types with `requires_ownership_check` need the ownership checklist completed. |
| → `completed` | All required checklist items done. Required photos present (per service type: e.g. ≥ 1 before + ≥ 1 after). Completion signature if `risk_band ≥ high`. Invoice auto-generated (draft → issued) unless `settings.invoices.auto_issue_on_complete=false`. `jobs.override_requirements` bypasses with a reason. |
| → `cancelled` | Reason code required. After `arrived` also needs a note + photo, triggers the "Was your service completed today?" verification text, and an `anomaly` flag for admin review (an `approvals` row, entity `job_cancel`, decided by `jobs.review_cancellations`). |
| `on_hold` → `scheduled` | **Return visit** (waiting for parts / customer approval / second day). Requires a new window; keeps all prior status events; increments `jobs.visit_count`. The next visit runs the normal On my way → Arrived flow. Special-order parts ordered while on hold log `deposit_requests.special_order_po_at`. |
| Critical band → `in_progress` | If the Critical control chosen is admin approval, the tech taps "Request approval" → `approvals` row (entity `job_start`) → push to `jobs.approve_start` holders. Approve/deny is pushed back to the tech. |

- **Job numbers:** sequential via `counters` (prefix configurable, e.g. `J-1042`). Immutable. Jobs are never hard-deleted.

**MVP capabilities**
- **Job fields:**
  - Customer, property, job type (a service type and its kind, below), title/summary, description, priority (`normal` | `urgent` | `emergency`; emergency/after-hours applies a premium line if configured), and source/lead link.
  - Scheduling: `scheduled_start`, `scheduled_end`, arrival window (configurable lengths: 1 h default, 2 h, 4 h; J.D. Power data favors 1 h). A booking from a lead uses 2-hour arrival windows.
  - Assignees (primary + helpers with split %), tags, custom fields, checklist (from service-type template), internal notes, customer-visible notes.
  - `callback_of_job_id` + `callback_reason` (`workmanship` | `part` | `customer` | `other`), warranty expiry.
  - Risk score/band, readiness score.
  - Cancellation policy snapshot and service-call fee disclosure snapshot.
- **Job types (two levels):** three kinds, picked as cards on the caller form, in booking and on New job.
  - **Free estimate** (`estimate`): 45 min, no deposit, the visit ends with an estimate. **Service call** (`service`): 90 min, repair rules. **Project** (`project`): half a day (240 min), the deposit rules and `contract_kind = 'improvement'`.
  - Each kind has its own row (named like the kind), which a booking uses when no trade job is picked. The trade's own jobs (Lockout, Rekey, Car key…) are `service_types` rows with a `kind`; they show as "What's the job?" chips under their card and keep their rules (price, length, photos, checklist, warranty). ⚖️ The lockout proof-of-ownership check (`requires_ownership_check` plus its checklist) stays on those jobs.
  - The old generic types (Service call / diagnostic, Repair, Installation, Maintenance, Estimate visit) are retired: renamed into the three kinds or archived, and existing jobs keep their type and history. There are no maintenance reminders any more (M13).
  - Labels, hints, icons and defaults live in `src/features/jobs/kinds.ts`.
- **Calendar / schedule board:**
  - Day view: columns per tech on desktop, list per tech on mobile. Also week and 3-day views.
  - **Unscheduled queue** sidebar. Drag a job to a slot or tech (desktop: pointer drag; mobile: "Assign" sheet).
  - Conflict warnings: overlap, outside the tech's service ZIPs, tech not clocked in today.
  - Travel-gap hint: straight-line distance ÷ 30 mph.
  - Color by status or by tech.
- **Booking availability** (the booking flow's When step, M04; `src/features/jobs/availability/`): each day is split into 2-hour arrival windows over the team's working hours. A window is **open** when at least one tech fits all of these:
  - **Works then:** their working hours for that weekday (`users.work_hours`, else the business hours) minus their time off.
  - **Has the skill:** a tech with a skill list must have the job's type; an empty list takes any job, and when nobody lists that type, skills don't block.
  - **Is under the daily cap:** one cap for everyone, `settings.jobs.daily_job_cap` (default 6). Every job that day that isn't cancelled counts.
  - **Fits the route:** the job's length plus the drive from their previous stop (straight line at 30 mph, the Assign hub's route math) gets them there before the window ends, inside their hours and clear of time off, without overlapping a booked window or pushing a later job past its own window.
  - **Isn't far:** a window counts as full (hidden) when the job adds more than `settings.jobs.max_extra_miles` (default 25) of driving for every tech who fits. A ZIP outside the service-area ZIPs gets no windows at all. An unknown ZIP or location never blocks.
  - Weekends and evenings stay closed unless a tech is set to work them. **After-hours booking** (`settings.jobs.after_hours_booking`) is off by default; when on, windows outside everyone's hours are offered to anyone not on time off, within the schedule board's hours. With it off, the office books emergencies by hand on New job.
  - Booked jobs with no tech yet still take room (each is placed with the tech the hub would rank first). Today, windows that already started are full and the earliest arrival is 30 min from now. The job's length is the trade job's default, else the kind's own row, else the kind default (45 / 90 / 240 min).
  - **Day status:** Open (2+ open windows), Limited (1), Full (0, with the reason: closed, far, full or outside the area). **Best** marks the top 3 open days nearest the day they asked for (else the soonest), then the least extra driving.
  - ⚖️ Like the Assign hub's ranking, availability never takes age or date of birth.
- **Dispatch:**
  - Assign/reassign pushes to the tech.
  - Reschedule sends the customer a reschedule text (automation).
  - The **"Unconfirmed tomorrow"** list is flagged to the office by 9:00.
  - **Assign hub** (`/dispatch`, `jobs.assign`): every tech's day on a route map, and a ranked "who should take it" for a job: the extra route miles and the load, with penalties for overlaps, the daily cap, not being clocked in and a missing skill. For a booked window, a tech who is off that day, off then or on time off is listed last with that reason (still pickable). ⚖️ Age is never an input.
  - **Needs a tech:** a booked job (an arrival window today or later; not cancelled, closed or completed) with nobody assigned. One definition for the count on Assign (sidebar and More list; on phones the More tab carries it) and the hub's queue, which lists them first, across all days, soonest first, each with its day and window. Undated jobs without a tech are listed apart and not counted. The customer's confirmation (`job.scheduled`) goes out when a tech is assigned. No auto-assign: the office picks the tech.
- **Confirmations:**
  - Reminder 24 h before ("Reply C to confirm or R to reschedule"). With paid drivers, inbound replies auto-update `confirmed`. In link mode the office marks the reply manually; the customer's magic-link page also has **Confirm / Request reschedule** buttons, which work in free mode.
- **Running late:**
  - One tap → ETA picker (15/30/45/60) → the customer text is auto-drafted.
  - Auto-prompt if the tech isn't `en_route` 15 min before the window ends.
- **Callbacks / warranty:**
  - "Create callback" from a past job pre-links `callback_of`. Callback jobs default to no-charge.
  - Commission policy per plan (M16).
  - Warranty expiry = completed_at + service-type warranty days, printed on the invoice.
- **Recurring jobs (MVP-lite):** "repeat every N weeks/months" creates the next job on completion.
- **Job checklists:** from service-type templates. Items: checkbox, text, number, photo-required, signature, select. Stored on the job as a JSON snapshot. Locksmith ownership check is a template: ID photo, proof-of-address photo, "I have authority" signature.
- **Cancellation fee policy:** captured at booking, with fee lines applied on late cancel or no-show and a `waived_count` per customer.
- **Anti-theft controls (MVP):** cancel-after-arrival review, post-cancel verification text, customer-confirmed receipts (M09), and the weekly anomaly report (M20).

**Later**
- Route optimization
- Real routing ETAs
- Multi-day project jobs with phases
- Subcontractor job link

---

### M06 Technician mobile experience ("Tech")

This expands the owner's truncated "* Tech" bullet. The tech app is the same PWA with a tech-specific IA (§13). Design target: **every common action ≤ 2 taps from Today, one-handed, works in a basement.**

**MVP**
- **Today ("My Day"):**
  - Greeting header, clock-in toggle, and a cash-on-hand pill (amount held, tappable → remit).
  - **Next job** hero card: customer first name, address, window, service, notes/gate code (revealed in the window), and big buttons **Navigate** (Apple/Google Maps deep link chosen by platform) / **On my way**.
  - Then the remaining jobs as a timeline.
  - Shortcuts: Log odometer, Upload receipt, Tool check (if due), Outbox (n).
- **Job screen (tech view):** sticky bottom **action bar** that changes with status:

  | Status | Primary action | Secondary |
  |---|---|---|
  | scheduled/confirmed | **On my way** (ETA chips 15/30/45/60 → sends text via outbox/driver) | Call, Text, Navigate |
  | en_route | **Arrived** | Running late, Navigate |
  | arrived | **Start job** (guards: estimate/ownership) | Before photos, Estimate |
  | in_progress | **Complete** (shows readiness checklist sheet with missing items) | Photos, Parts, Estimate/Change order, Checklist, Notes, Hold |
  | completed | **Collect payment** | Invoice, Send receipt, Next job. (No "Request review" button for techs: the review request is automatic, and Google prohibits pressuring for reviews on the premises, RESEARCH §4.4.) |
  | on_hold | **Schedule return visit** | Order part (special-order → deposit), Notes, Photos |

- **Photo capture:** big camera button with before/during/after segmented tags, multi-shot, captions, and a queued upload with per-photo progress. Works offline (§M11).
- **Estimates on site:** build good/better/best from the price book, have the customer sign on the tech's device or send a link, and capture a deposit.
- **Change order:** when the new total exceeds the signed total by more than `settings.estimates.change_order_threshold_pct` (default 10%) or $X, a change order with a fresh signature is **required** before Complete.
- **Collect payment:** sheet with balance; method tiles Card (pay link QR / send link / reader Later), Cash, Check, Zelle, Venmo; tip option; split payments.
  - Cash/check: amount, photo of the check, and an auto receipt to the customer (anti-skimming).
- **Parts:** add from truck stock or the price book, or "bought it now" → receipt photo → tech-paid purchase (M15).
- **My Pay:**
  - Live running balance for the current period.
  - Per-job lines with a **"Why this amount?" trace**.
  - Cash held + remit flow.
  - Pending reimbursements.
  - Statements to review and acknowledge, with the ability to flag lines.
- **My Vehicle:** odometer photo log, fuel, service due badges, inspection checklist, report issue, documents (per policy).
- **My Tools:** list with photos, scheduled audit (photo of each), report lost/damaged.
- **Outbox:** pending taps for texts assigned to me; Next mode steps through them one by one.
- **Offline:**
  - IndexedDB outbox for status changes, notes, checklist, payments (manual), odometer and photos.
  - Each item carries a client UUID (idempotency key) and device timestamp.
  - Flush on app open, `online` and `visibilitychange`.
  - A banner shows "3 changes waiting to sync". Server actions accept `client_id` and `client_ts` and are idempotent on `client_id`.
- **Autosave:** every form field saves its draft to IndexedDB on input (debounced 400 ms), and drafts restore after a crash or close.
- **Location sharing:** while clocked in and the app is visible, `watchPosition` posts at most every 60 s, plus a stamp on each status change. A visible "Sharing location" pill, off-shift never. ⚖️ Requires a signed monitoring notice at invite.
- **Push notifications:** job assigned/rescheduled/cancelled, outbox has items, statement ready, reimbursement approved/rejected, vehicle/tool due.
- **Earnings privacy:** techs never see other techs' pay or company margin unless granted.
- **Start of day:** clock in (geostamp; odometer photo if `require_odometer_on_clock`), vehicle inspection if due (`inspection_frequency`), tool audit if due, then the Today list. The `tech_daily_agenda` push (§7.3) lists the day's jobs at 07:00.
- **End of day ("Finish my day" sheet):** blocks nothing but shows, in order: unsynced offline items (must reach 0 or show a warning), unsent outbox cards, jobs left `in_progress`/`en_route`, cash and checks on hand vs. the system figure (tech confirms or enters a discrepancy note → admin alert), unreceipted tech-paid parts, end odometer photo, then **Clock out**. The day's trip log is auto-drafted for review (M17).
- **Text sender identity (free link mode) ⚖️ anti-poaching:** in link mode an SMS goes out from whichever phone taps Send, which exposes a tech's personal number (RESEARCH P3). `settings.messaging.tech_texts_from`: `tech_phone` (default; a Banner warns the admin and recommends company-issued phones) | `office_outbox` (on-my-way/running-late cards go to the office outbox; the customer always also gets the `/t/` tracking link by email when an email exists). Paid drivers remove the issue (company number).

**Later**
- Native wrapper (Capacitor) for background location and Tap to Pay
- Voice notes with transcription
- Barcode scan for parts

---

### M07 Estimates

**MVP**
- **Structure:** Estimate → **Options** (1–3; labels default to Good/Better/Best and are editable; one can be marked **Recommended**) → **Line items**. Optional add-on lines (checkboxes the customer can toggle).
- **Line item fields:** type (`service` | `labor` | `part` | `material` | `fee` | `discount`), price-book link, name, description, qty (3 decimals), unit price, unit cost (internal), **taxable** flag, part source (`company_stock` | `company_po` | `tech_purchased`), warranty days.
- **Service-call / diagnostic fee** line: "credited if you approve the repair". It is shown in the booking confirmation (⚖️ CA BHGS).
- **Details:** expiry date (default 30 days), photos of the problem, warranty terms, deposit terms (computed by the M09 rules), policies (full text inline), notes.
- **Sending:** via SMS link / email / in person. The public page `/e/[token]` shows the options; the customer selects one plus add-ons, checks the ESIGN consent box, types their name, draws a signature, then pays the deposit if required.
  - Signing captures a `signatures` row (§6) plus a hash of the rendered snapshot.
- **Statuses:** `draft` → `sent` → `viewed` → `approved` | `declined{reason}` | `expired`. Approval converts the chosen option into job line items and an invoice draft.
- **Follow-up automation:** +2 h, +2 d, +5 d, +10 d, close-out at +30 d. Cancelled on reply, approval or decline.
- **Unsold estimates board:** sorted by value, with close rate per tech.
- **Approve on behalf** (verbal) needs `estimates.approve_on_behalf`, records "verbal" as the channel with a note, and raises the risk score.
- **Discount:** limited by role `max_discount_pct`; anything higher requires admin.
- **FTC Cooling-Off ⚖️:** service types flagged `upsell_covered` (and lines tagged `upsell` beyond the requested repair, when the total is ≥ $25 and the sale is at the home) auto-attach the 3-business-day cancellation notice to the estimate. The emergency waiver supports "photo of handwritten statement".
- **Compliance-profile warnings:** state contract templates (CT home improvement fields, CA deposit cap) show when the service type is tagged `improvement`.

**Later**
- Financing offers
- Estimate templates library per vertical
- Proposal PDF with cover page

---

### M08 Invoices & receipts

**MVP**
- **Invoice:**
  - Sequential number (`counters`, prefix `INV-`), job link, customer bill-to, service address, service date(s), tech name + license #.
  - Line items, per-line tax, discounts.
  - **Credits:** deposits and payments as credit lines ("Deposit 10/02, Visa ••4242 −$150.00").
  - Balance due (derived), due date (`due_on_receipt` residential; net 15/30 for commercial or property-manager customers).
  - Warranty block, policies excerpt, notes.
  - **Before/after photos** (toggle per company / service type / invoice; up to 8, 2-up grid).
  - **Pay QR code** linking `/p/[token]` (QR generated by a ~2 KB hand-rolled encoder or a server-rendered SVG; no dependency over 5 KB).
  - "Appears on your statement as ACME LOCK* J1042".
  - "Pay only {Company}. Never pay a technician personally."
- **Lifecycle:** `draft` (editable) → `issued` (immutable) → `partially_paid` → `paid` | `void` | `uncollectible`. These are status values on the invoice row; balance is still derived.
- **Revisions:**
  - "Revise" on an issued invoice creates `invoice_revisions` with a full JSON snapshot + hash + diff; the invoice number is unchanged and the version increments.
  - Revising after payment requires `invoices.revise` and a reason, and is flagged on the anomaly report.
  - Credit notes for reductions after payment.
- **$0 invoices** go straight to `paid` (a known incumbent bug: avoid it).
- **Printable page:** `/invoices/[id]/print`, the public `/i/[token]`, and a "Download PDF" that uses `window.print()`. Print CSS per §12.
- **Receipt:**
  - One per payment: amount, method, last4, entry mode, auth code, date/time, remaining balance, and a photo strip if enabled.
  - Sent automatically to the customer (SMS/email) for **every** payment including cash/check: "You paid $X by cash to {tech} for job #… Wrong amount? Reply/tap here." That reply/tap creates a high-priority admin alert.
- **Dunning:** unpaid reminders at +3 / +7 / +14 days (friendly → firm → final, including late-fee policy if configured ⚖️). Stops on payment or dispute.
- **Aging report:** 0–30 / 31–60 / 61–90 / 90+, filterable by tech and source.
- **Customer statement:** all open invoices on one page.
- **7-day check-in** after completion: "Anything not right? Reply here." Doubles as chargeback evidence.

**Later**
- Multiple payers (homeowner + warranty company) split billing
- Progress invoicing for projects
- Lien/demand-letter templates with state deadline reminders ⚖️
- QuickBooks/Xero export adapter

---

### M09 Deposits & payments

**Payments ledger (MVP)**
- A `payments` row per collection attempt that succeeds or holds.
  - `kind`: `deposit` | `payment` | `tip_only`.
  - `method`: `card` | `ach` | `cash` | `check` | `zelle` | `venmo` | `other`.
  - Also: provider + ref, `amount_cents`, `tip_cents`, `fee_cents` (actual from the provider; configured % for manual methods via `settings.payments.fee_pct_by_method`), auth snapshot (entry mode, brand, funding, last4, fingerprint, AVS, CVC, 3DS, IP), `collected_by_user_id`, `verified_at/by` for manual methods, and status.
- **Balances** = invoice total − Σ succeeded payments (non-tip) + Σ refunds. Always derived via SQL view `invoice_balances`.
- **Overpayment guard:** a charge > balance is blocked (UI and server).
- **Manual methods:**
  - Reference # required for check/Zelle/Venmo; photo optional (required for checks when `settings.payments.require_check_photo`).
  - Shown as "Unverified" until an office user marks it verified in the bank (guards against fake screenshots).
  - Cash records the collecting tech and becomes a `cash_held` ledger line (M16).
- **Stripe adapter over REST** (no SDK):
  - Pay link `/p/[token]` creates a Checkout Session on click (parameters per RESEARCH §2.7): itemized lines, `shipping` = service address, `statement_descriptor_suffix` = job #, metadata, ToS consent, 3DS when risk ≥ High, an idempotency key, and expiry 1 h.
  - Webhook `/api/webhooks/stripe` with HMAC verification handles `checkout.session.completed`, `payment_intent.succeeded`/`payment_failed`/`canceled`, `charge.refunded`, `charge.dispute.*` and `radar.early_fraud_warning.created`.
  - Event IDs go into `webhook_events` for idempotency.
  - After a payment, fetch `balance_transaction` for the actual fee.
- **Refunds:** `payments.refund` up to the role limit, to the original method. Promised refunds can be scheduled with a due date + alert (prevents "credit not processed" disputes).
- **Tips:** optional tip screen (presets 0/10/15/20% or custom). Tips go 100% to the tech by default. ⚖️ No card fee is deducted from tips by default.
- **Fee policy** (`settings.payments.fee_policy`): `absorb` | `cash_discount` (default; shows "cash price" as discounted) | `surcharge`.
  - `surcharge` is opt-in, blocked when the compliance-profile state is CT or MA, capped at 2% in CO and 3% elsewhere, credit only, and shows a warning about 30-day processor notice.
- **Reconciliation view:** Stripe payouts vs. invoices marked paid by card; unmatched items flagged. Manual payments unverified for more than 3 days are flagged.

**Deposits (MVP)**
- **Rules** (`deposit_rules`, evaluated in priority order; the first match wins). Triggers:
  - `always`
  - `estimate_total_gte`
  - `has_special_order_parts`
  - `after_hours`
  - `new_customer`
  - `risk_band_gte`
  - `scheduled_days_out_gte`
  - `service_type_in`
  - `lead_source_in`
  - `customer_flag` (prepay_required)
- **Amount:** `fixed` | `percent_total` | `percent_parts` | `parts_plus_percent`, with min/max and rounding to $5.
- **Collection mode:** `capture` (pay now) | `hold` (auth hold, captured at completion; for jobs ≤ 5 days out) | `card_on_file` (save the card with signed authorization text for a no-show fee or balance) | `manual` (cash/Zelle deposit).
- **Policy:** refundable until (hours before the window) / restocking % / "non-refundable once special-order part is ordered" (the PO date is logged). The full policy text is snapshotted at acceptance (`policy_versions` + hash).
- **Lifecycle:** `deposit_requests` `required` → `requested` (link sent) → `paid`/`held` → `applied` (credit line on the invoice) | `refunded` | `forfeited` | `waived` (`deposits.waive`, reason).
- **Behavior:**
  - The job shows a "Deposit required" chip.
  - The automation sends a link instantly and again at +24 h.
  - The schedule board flags unpaid deposits.
  - If the deposit exceeds the final total, the system suggests a refund.
  - Expiring auth holds trigger an alert 24 h before expiry.
  - **Applying to the invoice:** deposit payments are taken before an invoice exists (`payments.invoice_id` null, `deposit_request_id` set). When the job's invoice is created, every succeeded deposit payment for the job is linked (`invoice_id` set, audited) and rendered as a credit line; the request moves to `applied`. Commission treats the deposit as a payment, never extra revenue (§10.2).
  - **No processor configured** (`PAYMENTS_DRIVER=manual`): rules with mode `capture`/`hold`/`card_on_file` fall back to `manual` (cash/Zelle/check deposit recorded by staff) and the Deposits settings page shows a Banner explaining it. Nothing breaks without Stripe.
  - **Deposit visibility for the tech:** the job card and the Collect-payment sheet show "Deposit $X paid {date}" so a deposit is never charged twice (duplicate-charge disputes).
- **⚖️ State caps** (compliance profile, warnings only): CA improvement ≤ min($1,000, 10%); MA ≤ max(1/3, special-order cost) over $1,000; MD ≤ 1/3; FL > 10% → permit/start deadlines reminder. Applies when service type `contract_kind = 'improvement'`.

**Later**
- Square adapter (POS API app-switch for card-present at no hardware cost, payment links)
- Stripe Terminal S700 server-driven
- ACH via Stripe
- Financing partners
- Card-on-file auto-charge for balances

---

### M10 Chargeback protection

**MVP**
- **Evidence capture everywhere** (no extra tech work):
  - signatures with an audit block
  - geostamped status events
  - hashed, geostamped photos
  - policy versions shown and accepted
  - portal access log (views, signs, pay-link opens with IP/UA)
  - message log
  - payment-auth snapshot
  - 7-day check-in reply
- **Job Risk Score** (pre-job, §11.1): recomputed on estimate/payer/payment-method/schedule changes. The band drives required controls:
  - **Medium:** signed estimate + minimum photos before Complete.
  - **High:** deposit or hold, 3DS link or card-present, completion signature, no keyed cards.
  - **Critical:** admin approval or prepayment or cash/ACH only.
  - Shown as a colored chip with a "why" sheet listing contributing signals.
- **Readiness Score** (post-job, §11.2): a ring on the job card. The Complete sheet lists the missing items.
- **Evidence Pack** `/jobs/[id]/evidence`:
  - Print-optimized page, chronological and grouped: cover + timeline → signed authorization & change orders → arrival/departure geostamps → before/after grid → completion sign-off → receipts → communications excerpt → policy excerpt → payment-auth signals.
  - Rules: 12 pt+, Letter/A4, no color reliance, images compressed to 1600 px JPEG at q 0.7, target < 4.5 MB and ≤ 19 pages.
  - Print to PDF (MVP).
- **Disputes** (Stripe webhook, MVP):
  - `charge.dispute.created` → `disputes` row (reason, network code, `due_by`), push + email to admins with a countdown, customer flagged `dispute_history`, commission hold per plan (M16).
  - Build the evidence JSON mapped to Stripe fields per reason category (RESEARCH §2.4).
  - Auto-write a neutral narrative from the job timeline (template-based, **not AI**).
  - Admin reviews in `/disputes/[id]`: edit narrative, attach/remove items, then **Submit** or **Accept**. The UI suggests Accept when amount < $50 and readiness < 50.
  - **Server PDF + upload to Stripe** (`purpose=dispute_evidence`, staged with `submit=false`) requires the `PdfRenderer` adapter. If that's absent, the UI provides the printable pack and a field-by-field copy panel for the Stripe Dashboard.
  - Tracks `updated` / `closed` / `funds_withdrawn` / `funds_reinstated`, and the outcome feeds analytics.
- **Early fraud warning:** suggest a refund when amount ≤ the dispute fee ($15) × `settings.disputes.efw_refund_multiplier` (default 1).
- **Prevention rules:**
  - Statement-descriptor check in the setup checklist.
  - Keyed cards discouraged (UI hides "type card number" unless the setting `settings.payments.allow_keyed` is on **and** the user has `payments.keyed_entry`).
  - Every receipt ends with "Questions about this charge? Reply here".
  - `dispute_history` customers require prepayment.
  - Card-fingerprint match against past disputers adds +40 risk.
- **Retention:** evidence media and signatures are kept ≥ 24 months; deletion of evidence-linked media is blocked.
- **Analytics:** dispute rate (disputes received ÷ card payments, trailing 30/90 d) against the 0.75% line, broken down by tech, service, source, entry mode and reason; win rate by readiness band.

**Later**
- Server-side PDF (`pdf-lib`) as default
- Square disputes API mapping
- Visa CE3.0 auto-assembly
- Verifi RDR / Ethoca toggles
- Smart Disputes passthrough

---

### M11 Photos & evidence media

**MVP**
- **Capture:**
  - `<input type="file" accept="image/*" capture="environment" multiple>` plus library pick.
  - At capture: `navigator.geolocation` (if permitted), `File.lastModified`, and SHA-256 of the **original** bytes (`crypto.subtle.digest`).
  - Tag: `before` | `during` | `after` | `problem` | `receipt` | `odometer` | `document` | `tool` | `signature` | `id_check` | `other`. Optional caption.
- **Compression** (`src/client/image.ts`, ~1 KB):
  - `createImageBitmap(file)` (applies EXIF orientation) → canvas → `toBlob('image/webp', 0.8)`; if the blob type isn't webp, re-encode as `image/jpeg` at 0.8.
  - Produces a **1600 px long edge** derivative and a **320 px thumbnail**.
  - The original is uploaded too **only** when `settings.media.keep_originals` (default on for `before`/`after`/`id_check`/`signature` when chargeback protection is enabled; off otherwise, to save storage). The hash is always recorded.
- **Upload:**
  - `POST /api/uploads/presign` (auth, perm, content-type allowlist, size ≤ 15 MB) returns presigned PUT URLs (aws4fetch).
  - The client PUTs directly to storage, then calls `POST /api/uploads/complete` with metadata; the server records `server_received_at` and creates the `media` row.
  - The offline queue retries with backoff.
- **Storage:** private bucket. Reads via short-lived signed GET (10 min). Public invoice pages get signed URLs at render.
- **Flags:** `possibly_from_library` when `server_received_at − file_last_modified > 24 h`; `no_geo`.
- **Append-only:** soft-delete only (`photos.delete`), audited. Media linked to an issued invoice, signature or dispute cannot be deleted.
- **Before/after:** per service type `photos_required_before`, `photos_required_after` (ints). The job shows a **side-by-side comparison** view (slider). Selected photos (star) are embedded in the invoice/receipt when `include_in_invoice`.
- **Optional per company (one switch, no duplicate setting):** the feature flag `before_after` (§5) is the only on/off for before/after. Off → no before/after tags, no comparison view, no photo grid on invoices/receipts, and per-service-type `photos_required_before/after` are ignored. The flag `photos` governs **job** photos only; receipt, odometer, document and tool photos always work because other modules depend on them.
  - **Knock-on rules when job photos or before/after are off:** the Readiness "Before/after photos" item becomes not applicable (full credit), and the Medium/High risk-band photo control is replaced by the completion signature. The setup checklist asks "Do before/after photos suit your service?" so the owner decides at signup.
- **Embedding in documents:** three levels, each overriding the one before: company default (`settings.invoices.photos_on_invoice`, `settings.invoices.photos_on_receipt`), service type (`service_types.photos_on_invoice`), and the individual invoice (`invoices.show_photos` + the ordered `photo_media_ids`). The tech or office stars photos on the job (`media.include_in_invoice`); if none are starred, the latest 2 before + 2 after are used. Invoices show up to 8 in a 2-up grid with "Before"/"After" captions and the stamped date; receipts show a strip of up to 4 thumbnails; the customer portal shows all starred photos full-size.
- **Stamped derivative** for evidence and invoices, rendered via CSS overlay at print time (no image re-encode): date/time, address, job #.

**Later**
- Annotations/markup on photos
- Video clips
- Server-side EXIF parse of originals

---

### M12 Messaging

**MVP**
- **One adapter interface** (§9.1) with drivers:
  - `link` (default SMS): `sms:` deep link
  - `whatsapp_link`: `wa.me`
  - `console` (dev)
  - `email` (Resend / console)
  - `push` (staff)
  - `android_gateway`: optional, Later-ready, MVP stub
  - `twilio` / `telnyx`: Later, interface-complete
- **Outbox** (link mode):
  - The scheduler sets due messages to `pending_tap` with `assigned_user_id`: the tech for job-live messages (on my way, running late); office/admin for reminders, follow-ups, dunning and reviews (`settings.messaging.outbox_owner_by_template`).
  - A push alert goes out ("3 customer texts ready"), with a badge on the Outbox tab.
  - Each card shows recipient, editable body, due/expiry and a GSM-7/segment indicator.
  - **Send** opens `smsHref()` / `wa.me`. On `visibilitychange` back to the app, a bottom sheet asks "Sent? Yes / Not sent / Skip" → `sent_manual` | stays `pending_tap` | `skipped`.
  - **Next mode** steps through the queue. **Copy text** fallback.
  - **Expiry:** each template has `expires_after` (on-my-way 30 min, 2 h reminder at window start, review 48 h). Expired → `expired`, never sent late.
- **`smsHref`:** Apple UA → `&body=`, else `?body=`; per-device override in Settings (`?`, `&`, `?&`) with "Send test to myself". Bodies always use `encodeURIComponent`. No multi-recipient links.
- **Conversation thread per customer** (`/messages/[customerId]`): bubbles for all channels, merged into the timeline. A composer with template picker and variable preview sends through the default channel for the customer. Inbound appears only with drivers that support it; in link mode the office can **log** a received reply manually ("Customer replied: …").
- **Consent & compliance:**
  - Consent ledger (`consent_events`, append-only), derived `customers.sms_status`.
  - Purposes: `transactional` | `marketing` | `review` | `internal`.
  - `do_not_text` and `opted_out` suppress all automated customer messages (ready for revoke-all).
  - Manual one-off replies are still allowed for transactional purposes after an explicit warning.
  - **STOP keywords** (paid/gateway drivers): `STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, REVOKE, OPTOUT, OPT OUT` → opt-out + a single confirmation text. `START, YES, UNSTOP` → opt-in. `HELP, INFO` → help text.
  - Natural-language opt-outs ("stop texting me", "wrong number", "remove me") flagged for one-tap review.
  - One-tap **"Customer asked us to stop texting"** on the profile.
  - **Quiet hours:** default 08:00–20:00 in the **recipient's** time zone (from service-address ZIP via a static ZIP3 → TZ table; fallback the company TZ). Out-of-window sends are **deferred** to 08:00 + jitter (0–30 min). Templates with `allow_outside_quiet_hours` (lead auto-ack within 5 min, on-my-way for an active job) bypass.
  - **Frequency caps:** ≤ 3 automated non-live messages per customer per 24 h; marketing ≤ 1 per 7 days. Excess is deferred to the next day.
  - **GSM-7 lint** in the template editor: flags emoji, curly quotes and non-GSM chars; shows segment count.
  - **Links** only on own domain (`/j/`, `/e/`, `/i/`, `/p/`, `/r/`, `/t/`); public shorteners are rejected in templates.
  - **First message to a number** and every marketing message append "Reply STOP to opt out" (paid drivers; in link mode it is appended to the first automated message).
- **Generated compliance pages:** `/privacy` and `/sms-terms` from company settings, including the no-sharing-of-mobile-opt-in-data clause. They make later 10DLC approval easy.
- **Bulk send:** requires `messages.bulk_send`, a filter preview, and typing the count to confirm; it is never reachable from review-request screens.
- **Email:** HTML + text, company branding, invoice/estimate links (no PDF attachments in MVP; links instead). Bounce handling Later.
- **Web Push for staff** (§M22).

**Later**
- Twilio/Telnyx drivers with inbound + status webhooks and MMS
- "Go live with SMS" wizard (EIN/sole prop, sample messages from templates, opt-in screenshot URL)
- Android gateway driver
- Missed-call text-back
- Shared team inbox with assignment
- Translations

---

### M13 Automations & reminders

**MVP**
- **Model:** `automations(trigger_event, conditions, steps[], cancel_on[], enabled, builtin)`.
  - Each step: `delay` (ISO-like `{minutes|hours|days}`), `anchor` (`event_time` | `job.scheduled_start` | `job.window_start` | `job.window_end` | `job.completed_at` | `invoice.due_at` | `dispute.due_by` | `deposit.capture_before` | `entity.expires_on` | `fixed_time_local "09:00"`), `channel` (`sms` | `email` | `push` | `in_app` | `customer_preferred`), `audience` (`customer` | `assigned_tech` (primary) | `assigned_techs` (all assignees) | `subject_user` (the user the entity belongs to: settlement owner, purchaser, reporter, cash holder, task assignee) | `creator` | `vehicle_assignee` | `office` | `admins` | `perm:<key>` (every active user holding that permission, e.g. `perm:vehicles.log_approve`) | `role:<r>` | `user:<id>`), `template_key`.
  - Negative delays relative to an anchor are allowed (e.g. −24 h before `scheduled_start`).
- **Conditions** (JSON, evaluated with a tiny safe evaluator, no `eval`): `{ all: [ { field: 'job.service_type_id', op: 'in', value: [...] }, { field: 'customer.tags', op: 'contains', value: 'vip' } ] }`.
  - Ops: `eq, neq, in, nin, gt, gte, lt, lte, contains, exists, not_exists`.
- **Scheduling:**
  - On event, matching automations create `scheduled_messages` per step with `dedupe_key = automation_id:entity_id:step_idx` (unique), so re-emitted events don't double-send.
  - Rescheduling a job recomputes anchored sends (cancel + recreate).
- **Send-time re-check:** consent, quiet hours, frequency caps, cancel conditions (e.g. invoice paid), entity still in a valid state, feature flag on. Otherwise → `canceled` / `suppressed_optout` / `deferred_quiet`.
- **Built-in automations** (seeded, editable, can be disabled; §7.3 has the full table): lead ack, lead not reached, booking confirmation, deposit request, 24 h reminder with C/R, 2 h prep, on my way, running late, job completed → invoice, payment receipt (all methods), dunning 3/7/14, estimate follow-ups 2 h/2/5/10/30 d, review request + reminder, 7-day check-in, post-cancel verification, maintenance/seasonal (marketing consent only; the maintenance reminder is retired, see below), and internal alerts.
- **Admin editor** (`/settings/automations`):
  - List with on/off toggles.
  - Edit timing, audience, channel, template and conditions via form controls (not raw JSON; a raw JSON view is available to admins).
  - "Send test to me".
  - **Preview with a real job**.
- **Templates** (`/settings/templates`):
  - Per key, channel and locale (`en` only in MVP).
  - Logic-less renderer `{{path|fallback}}` (§7.4), ~30 LOC, HTML-escaped for email.
  - Variable picker with live preview, GSM lint, a character/segment counter, and "reset to default".
- **Custom reminders** (`reminders` table): admin-defined reminders that are not tied to a trigger event.
  - Audience: a user, a role, or a customer (customer reminders still pass consent/quiet hours).
  - Recurrence: `once` | `daily` | `weekly(days)` | `monthly(day)` | `every_n_days` | `every_n_miles` (vehicle-linked).
  - Optional entity link (vehicle, tool, customer, property).
  - Channel (push / email / sms / in_app), template or free text.
  - Examples: "Every Monday 8:00 remind techs to upload fuel receipts"; "Remind customer every 12 months about dryer vent cleaning".
- **Maintenance reminders for customers:** retired with the job types (M05). The maintenance interval is no longer a job type field and `service_types.maintenance_interval_months` stays null, so the built-in `maintenance` automation (`job.completed` + N months, marketing consent required) never fires.

**Later**
- Visual flow builder with branches
- Two-way reply parsing beyond C/R and STOP
- A/B testing templates

---

### M14 Review requests

**MVP**
- **Trigger:** `job.completed` AND `payment_status = paid` (or `job.closed`). Send +1.5 h (configurable 1–2 h), respecting quiet hours. One reminder at +3 days if not clicked. **At most two asks per job.** Not asked if the customer was asked in the last `settings.reviews.min_days_between` (default 365), is opted out, is `do_not_contact`, is internal/test, or the job was a no-charge callback (configurable).
- **Sentiment-neutral (hard rule, not configurable):** who gets asked never depends on rating or sentiment.
  - Optional "How did we do? 1–5" page `/r/[token]`: **every** rating sees the Google button. Ratings ≤ 3 *additionally* see "Want the owner to call you?" and trigger an admin alert.
  - No incentive variables are allowed in review templates; the template linter rejects `discount`, `coupon`, `% off`, `free` near "review".
- **Link:** `settings.reviews.google_url` (the GBP share link `g.page/r/<id>/review`; the builder from Place ID is a fallback with a "Test link" button). Multi-location: per-location links Later.
  - Always sent as `/r/[token]`: it logs the click (job, tech, time, UA) and 302s. Tech attribution comes from the click, never by asking the customer to name the tech.
- **Yelp** is never offered as a target (Yelp forbids solicitation).
- **Consent basis ⚖️:** review requests use purpose `review`. `settings.reviews.consent_basis`: `transactional` (default; sent to anyone with transactional SMS consent who isn't opted out) | `marketing` (conservative; only customers with marketing consent, others get email). Review messages count toward the 3-per-24 h automated cap.
- **No on-site asking by techs:** the tech job screen has no "Request review" button; only office/admin can send manually (`reviews.send_manual`), and never more than the two-ask limit.
- **Stats:** requests sent, click rate, internal ratings distribution, and per-tech leaderboard (clicks attributed). Optional manual "review received" logging per tech for review bonuses (`comp_plans.spiffs` type `review_bonus`, ⚖️ the bonus must not be conditioned on review sentiment).

**Later**
- Google Business Profile API to import actual reviews and reply
- Multi-location

---

### M15 Parts & inventory

**MVP (parts)**
- **Price book items** (`pricebook_items`): kind (`service` | `part` | `material` | `fee`), SKU, name, description, unit cost, unit price (or computed from the **markup matrix**), taxable, warranty days, `is_special_order` (non-returnable → deposit trigger), and vendor.
- **Markup matrix** (`settings.parts.markup_tiers`): e.g. `[{lt: 2000, mult: 4.0}, {lt: 10000, mult: 3.0}, {lt: null, mult: 2.0}]` (cents). The UI shows markup **and margin**.
- **Adding a part to a job** creates a line item with `part_source`:
  1. **Company-paid** (`company_stock` | `company_po` | `company_card`): cost recorded; decrements truck stock when inventory is on. Cost is deducted from the commission base per plan. No reimbursement.
     - `company_stock` / `company_po`: receipt/PO media optional.
     - `company_card` (tech buys at the supply house with a company card or company account): creates a `part_purchases` row with `paid_by='company'`, `instrument='company_card'`, **receipt photo required**, auto-approved, no ledger line. It exists so card statements reconcile and so "bought on the company card but never billed" shows on the anomaly report.
  2. **Tech-paid** (`tech_purchased`): creates a `part_purchases` row (`paid_by='tech'`) with receipt photo (required above `settings.parts.receipt_required_over_cents`, default $0 = always), vendor, date, total, and job link.
     - Optional **Gemini extraction** fills vendor, date, subtotal, tax, total and lines.
     - Status `pending` → `approved` | `rejected{reason}`.
     - **Auto-approve** when all hold: under `auto_approve_under_cents`, receipt present, AI total matches typed total within $0.50 (or no AI configured and under the limit), and date within 7 days of the job.
     - Approved → `reimbursement_parts` ledger line in the next settlement; the cost is also deducted from the commission base.
- **Non-job purchases** (fuel, vehicle supplies, tool) use the same `part_purchases` flow with `category` and links to a vehicle/tool instead of a job. Approved tech-paid non-job purchases post `reimbursement_expense` (not `reimbursement_parts`) and never touch a commission base.
- **The two work trees → payroll** (normative):
  ```
  Part used on job
  ├─ COMPANY PAID (company_stock | company_po | company_card)
  │    cost → job_financials.company_parts_cents ──► deducted from commission base (plan.company_parts)
  │    receipt: optional (stock/PO) | required (company_card)      no ledger line, no reimbursement
  └─ TECH PAID (tech_purchased)
       part_purchases(paid_by=tech, receipt required) → pending
         ├─ rejected{reason} ──► tech push; no reimbursement; line flagged "tech part without approved receipt"
         └─ approved (manual, or auto rules) ─┬─► tech_parts_cents ──► deducted from commission base (plan.tech_parts)
                                              └─► ledger reimbursement_parts (+cost × reimburse_bps) to the PURCHASER
                                                  → settlement → payout (wage_class reimbursement, never taxed as wages)
  ```
  Golden cases A–C (§10.4) cover both trees in one settlement. A job may mix both trees; each line carries its own `part_source`.
- **Flags** (anomaly report):
  - a receipt with no matching invoice line ("unbilled part")
  - a tech-purchased part line with no receipt
  - tech-paid receipt older than 60 days (accountable plan ⚖️)
  - a job with parts cost > price
- **Warranty claims (MVP-lite):** part lines with `manufacturer_warranty_months`; a callback with reason `part` creates a `tasks` row (kind `warranty_claim`) with a due date (default 30 days).

**Inventory (flag `inventory`, default off; MVP-lite)**
- **Stock locations:** warehouse + one per vehicle. On-hand per item per location with min/max (par).
- **Stock moves:** `receive` | `transfer` | `use_on_job` | `adjust` | `return`. Average cost per item.
- **Restock request:** tech taps "Request restock" (`inventory.request_restock`) → list below par → a `tasks` row (kind `restock`, payload = items + qty) assigned to office → office fulfils → transfer closes the task.
- **Monthly cycle count:** variance report (no automatic deduction from techs).

**Later**
- Purchase orders to suppliers
- Supplier price history from receipts
- Core returns
- Barcode scanning

---

### M16 Commission, payroll & payouts

The engine is fully specified in §10. Module surface:

**MVP**
- **Comp plans** (`/settings/commission`):
  - Versioned plans with `effective_from` and a zod-validated config (§10.1).
  - A UI form covers the common fields; an "Advanced (JSON)" view is available to admins.
  - **Defaults seeded:** "Partner 25% after parts & card fee" (owner's model): basis `net_after_deductions`, deduct company parts + tech parts + processing fees (actual), tips 100% to tech, tech-parts reimburse 100%, `tech_keeps_cash: true`, settlement `net_in_payout` for 1099 / `separate_remittance` for W-2.
- **Assignment:** per tech (`tech_comp`) with overrides per service type and per job. Rate resolution: **job custom → tech × service type → tech → service type → role default → plan base**.
- **Worker type switch ⚖️:** `w2` | `1099` per tech. It sets defaults:
  - **1099:** cash netting allowed, deductions allowed if agreed.
  - **W-2:** cash goes to the **remittance ledger** (never a wage deduction); tool/chargeback/recall deductions are flagged for admin review instead of auto-applied; minimum-wage + overtime floor check on; the "deduct card fee on tips" toggle is disabled.
- **Job financials:**
  - Computed on `job.completed` and recomputed on any financial change until locked.
  - Stored in `job_financials` with `plan_version`, `rate_snapshot` and the `trace` JSON.
  - **Snapshot when the job closes or enters a settlement; locked thereafter.**
- **Ledger** (`ledger_entries`, append-only, integer cents, reversing corrections): commission, tip, spiff, reimbursement_parts, reimbursement_expense, reimbursement_mileage, cash_held, cash_remitted, chargeback_hold, chargeback_release, chargeback_clawback, recall_clawback, tool_deduction, tool_allowance, tool_deposit, draw, guarantee_topup, ot_topup, adjustment, payout, carry_forward. (Same list as §6.10; that DDL comment is canonical.)
- **Does the tech keep cash? (admin-configurable, per plan and per tech)**

  | Setting | Effect |
  |---|---|
  | `cash.tech_keeps_cash = true` + `settlement = 'net_in_payout'` (1099 default) | Cash the tech collected is subtracted from that period's pay (**deducted from the paycheck**). If the period goes negative, the plan's `negative_balance` applies (carry forward or remittance request). Golden case B. |
  | `cash.tech_keeps_cash = true` + `settlement = 'separate_remittance'` (forced for W-2) | Cash is never netted against wages; it sits in the custody balance until remitted. |
  | `cash.tech_keeps_cash = false` | Tech must hand in or deposit all cash within `remit_within_days` (default 1). Forces `separate_remittance`; nothing is deducted from pay. |

  - Per-tech override: `tech_comp.overrides.tech_keeps_cash` / `.cash_settlement` beat the plan (e.g. one trusted 1099 partner nets cash, everyone else hands it in). Changing either is audited and requires `comp_plans.manage`.
  - **Checks are never netted.** Checks are payable to the company ("Pay only {Company}"), so `cash.methods` defaults to `['cash']`; checks are always custody items to remit, whatever the plan says.
- **Cash custody:**
  - **Custody balance per tech** = Σ succeeded cash + check payments with `collected_by_user_id = tech` − Σ confirmed `cash_remittances` − Σ cash already netted in a locked settlement. Shown on the tech's Today pill, Team list and the admin dashboard; identical for every worker type.
  - Every cash payment collected by a tech → `cash_held` (negative to the tech balance for 1099 netting, or informational with amount 0 for `separate_remittance`).
  - Alerts at `max_cash_held` (default $1,500) and when cash is older than `remit_within_days` (default 3).
  - **Remit:** tech records a deposit or hand-in with a photo of the deposit slip; office confirms receipt (`cash.receive`).
- **Pay periods:** weekly (default, week start configurable), bi-weekly or semi-monthly. Auto-close by cron at the period end + `settings.payroll.close_delay_hours` (default 24).
- **Settlement lifecycle:** `draft` (auto-generated) → `tech_review` (48 h; tech can **flag** lines with a comment) → `approved` (`payroll.approve`) → `paid` (payout recorded) → `locked`.
  - Changes after lock become adjustments in the next period.
  - Negative balance: `carry_forward` (default) or `request_remittance`, with optional `max_deduction_per_period_pct` ⚖️.
- **Pay stub / statement** (HTML print → PDF):
  - Header (tech, period, worker type, plan version).
  - Per-job rows: job #, date, city, total, method, fee, parts (co/tech), base, rate, commission, tip, cash held, line net.
  - Then adjustments, reimbursements, chargebacks, carry-forward, payout(s), running balance, YTD totals, and the acknowledgment timestamp.
- **Tech acknowledgment:** e-acknowledge (typed name + timestamp + IP). Statements are never auto-acknowledged; unacknowledged ones stay "not acknowledged" and are visible to admin. Approval does not wait on acknowledgment after the 48 h review window.
- **Payouts ("paycheck deposit"):**
  - Record a payout: method (`ach_nacha` | `zelle` | `check` | `cash` | `payroll_provider` | `other`), reference, date, proof media, amount, and linked settlement(s).
  - **NACHA file export** (MVP, behind `settings.payroll.nacha_enabled`): generates a PPD (personal) / CCD (business) credit batch from approved settlements with positive balances. Tech bank info (routing, account, type) is stored **encrypted at rest** (AES-GCM with key from `SESSION_SECRET`-derived KEK). Only `payroll.payout` users can view the last 4 digits. The company uploads the file to its own bank. File format validated by golden tests.
  - **Direct-deposit setup** (`/pay/bank`, `payroll.bank_edit_own`): the tech enters holder name, routing (ABA checksum validated client and server), account (typed twice), checking/savings and personal/business. They e-acknowledge an authorization text (`policy_versions` kind `direct_deposit_auth`).
    - **Anti-fraud (payroll-diversion scams):** any change emails/pushes all `payroll.payout` users plus the tech's own email ("Your bank details changed. Not you? Tell your admin"). It sets `users.bank_changed_at`, and the next NACHA batch **excludes** that tech for `settings.payroll.bank_change_hold_hours` (default 72) unless an admin confirms by phone and taps "Verified".
  - **Payout notification:** recording a payout pushes the tech "Payment of $X sent by {method} on {date}" with a link to the statement.
  - **CSV export** for Gusto/ADP (W-2 wages, reimbursements separated).
  - **Never** build tax withholding or payroll tax filing. No fee on payouts.
- **Compensation agreement generator:**
  - Renders the plan config into a readable agreement with formulas and two worked examples from the tech's actual rate.
  - Tech e-signs plus signed receipt (⚖️ CA Labor Code 2751).
  - **Re-sign required** when the plan version changes. Unsigned → banner on the tech's Pay tab and on the admin team list.
- **Chargeback & recall handling** per plan: `on_open: hold | none`, `on_lost: clawback_100 | clawback_pct | none`, `dispute_fee_to_tech: false` (default); recall `window_days`, `policy: no_commission_on_recall | clawback_pct | none` ⚖️ (MA note: docking for recalls may be illegal for employees).
- **Reports:**
  - Per-tech settlement & YTD
  - Cash outstanding by tech with aging
  - Pending reimbursements
  - Open chargeback holds
  - Job P&L
  - 1099 totals ≥ $2,000 (2026+ threshold, admin-editable)

**Later**
- Stripe Connect payouts adapter
- Gusto/ADP API adapters
- Hourly + spiff auto-calculation from time entries beyond the floor check
- Tiered retro commissions UI (engine supports tiers in MVP; UI exposes them as Advanced)

---

### M17 Vehicles

**MVP**
- **Vehicle record:** VIN (decoded free via NHTSA vPIC: year/make/model/trim/engine/fuel/GVWR), plate + state, nickname, owned/leased/tech-owned, assigned tech, photos, tank size (gal), current odometer (derived from the latest approved reading), status (`active` | `in_shop` | `retired`).
  - USDOT fields shown when GVWR ≥ 10,001 lb.
- **Recalls:** NHTSA recalls lookup on save and monthly; open recalls become a reminder.
- **Odometer log:** value, photo, source (`manual` | `photo` | `service` | `fuel` | `clock`), optional AI-read value + confidence, recorder, approval status.
- **Fuel log:** gallons, $/gal, total, odometer, receipt photo (AI extraction optional); computes MPG.
- **Service records:** task(s) (oil change, tire rotation, brakes, inspection, custom), date, odometer, vendor, cost, paid by (company/tech → reimbursement via `part_purchases` category `vehicle`), receipt/shop invoice media (AI maps services → reminder tasks; admin confirms).
- **Reminder rules** (Fleetio model):
  - Per vehicle per task: `interval_miles`, `interval_days`, `due_soon_miles`, `due_soon_days`; whichever comes first.
  - The due date is forecast from the trailing 30-day average daily miles.
  - Reset **only** when a matching approved service record is logged.
  - **Seeds:** oil change 5,000 mi / 6 mo (due soon 500 mi / 14 d), tire rotation 7,500 mi, brake inspection 15,000 mi / 12 mo, registration expiry, insurance expiry, inspection expiry.
- **Documents:** registration, insurance card, inspection, lease, title; expiry date; reminders 30/14/3 days before.
- **Inspections (DVIR-lite):** checklist (tires, lights, fluids, wipers, brakes feel, damage photos), configurable frequency (`settings.vehicles.inspection_frequency`: `none` | `daily` | `weekly`).
- **Issues:** "Report vehicle issue" (description, photos, severity, can-drive?) → admin push. A **response timer** is visible to admin until acknowledged and resolved.
- **Mileage / trip log (IRS Pub 463):**
  - Clock-in/out odometer photos (when `require_odometer_on_clock`).
  - Daily trip entries auto-filled from the day's job addresses (destination) and service types (purpose).
  - Classification `business` | `commute` | `personal`; start/stop odometer.
  - Tech-owned vehicles: `reimbursement_mileage` ledger lines at the admin-editable IRS rate table (`mileage_rates` with `effective_from`; seeded 2026 = 72.5¢; ⚠ verify the 76¢ mid-year report).
- **Approval workflow (admin-configurable per entry type):** `settings.vehicles.policies` for `odometer`, `fuel`, `service`, `document`, `inspection`, `trip`:
  - `tech_can_log: boolean` (if false, only admins/office log; techs see read-only).
  - `approval: 'auto' | 'auto_if_evidence' | 'always_review'`.
  - `auto_if_evidence` passes when the required photo is present; the AI-read odometer matches typed within ±0.5% (skipped if AI is off → falls to review unless `ai_optional: true`); reading > last approved; daily miles < 600; and the receipt total matches typed.
  - Otherwise → the `approvals` queue (`/vehicles/approvals`): image + extracted fields side by side, Approve / Reject (reason) / Edit-and-approve.
  - Pending entries don't reset reminders or create reimbursements. Every decision is audited.
  - **Resolution order (pure function `resolveVehicleLogPolicy(user, type)`, golden-tested):**
    1. Can log? `vehicles.log` AND (`user.role ≠ tech` OR `policies[type].tech_can_log`). Otherwise the form is hidden and the tech sees read-only data with "Ask your admin to log this".
    2. Logged by a user holding `vehicles.log_approve` → `approved` immediately (self-approval of documents is still audited).
    3. User holds `vehicles.log_trusted` (per-user override) → `always_review` is treated as `auto_if_evidence`.
    4. Apply `policies[type].approval`. **Any rules-first anomaly flag forces review**, whatever steps 2–3 say.
  - **Admin review screen** shows the uploaded document/photo full-size next to the typed values, the AI-read values (if any) with a confidence chip, the previous approved reading, and the flags. "Approve all clean" bulk action for entries with no flags.
  - **Seeded defaults:** odometer `tech_can_log: true, approval: auto_if_evidence`; fuel `true, auto_if_evidence`; service `true, always_review`; document `true, always_review`; inspection `true, auto`; trip `true, auto_if_evidence`.
- **Gemini assist (AI_PROVIDER=gemini):** odometer read, receipt fields, shop invoice → service tasks, maintenance suggestions from VIN-decoded data + mileage (always "suggested — admin confirms"), and tool label read (M18). With `AI_PROVIDER=none` every flow still works by typing.
  - Free tier: **only** odometer, fuel/parts receipts and tool photos are sent. Registration and insurance documents are **never** sent on `AI_TIER=free`.
  - Budget-limited queue. Manual fallback always.
- **Rules-first anomaly flags:** odometer backwards/jump; gallons > tank size; MPG drop > 20%; two fuel buys the same day; fuel while the odometer is unchanged; weekend fuel (configurable). The LLM only explains flags (optional).
- **Fleet reports:** cost per mile, fuel spend, upcoming due, overdue, open issues.

**Later**
- OBD/telematics adapter (continuous GPS, auto odometer)
- Fuel card import
- Plain-language monthly fleet summary via AI

---

### M18 Tools (flag `tools`, default off; also per-tech `uses_company_tools`)

**MVP**
- **Tool record:** name, category, brand/model, **serial #**, QR asset tag (generated in the browser, printable sheet of labels), purchase date/cost, replacement cost, photos (required on create), owner (`company` | `tech_owned`; the tech-owned registry exists for theft/insurance), status (`available` | `assigned` | `in_repair` | `lost` | `stolen` | `retired`), condition (`new` | `good` | `fair` | `poor`), calibration/maintenance due date, notes.
- **Kits:** a named set of tools assigned to a vehicle/tech in one action.
- **Assignment:**
  - Check-out/check-in by tapping or scanning (QR via `BarcodeDetector` when available; manual select fallback, no zxing in base).
  - Condition + photo at each handoff, tech acknowledgment (tap "I have received these tools").
  - Full history. **Block assignment when calibration is overdue.**
- **Audits:** the admin schedules them (every 30/60/90 days per tech). The tech gets a checklist and must capture a timestamped photo of each assigned tool. Missing tools → incident. Audit status is shown on the team list.
- **Incidents:** lost/stolen/damaged → admin decides `write_off` | `repair` | `tech_responsibility`.
  - `tech_responsibility` creates a **pending** `tool_deduction` only if `settings.tools.deductions_enabled` (default **off**, ⚖️ blocked for W-2 in states flagged in the compliance profile; requires a signed tool agreement).
  - Alternatives: tool deposit or tool-allowance ledger lines.
- **One-click theft report:** a printable page with serials, photos, purchase values, last-seen assignment and date (for police and insurance).
- **Tool maintenance** (the owner asked for a tools *maintenance* system, not only a register):
  - Per tool: `maintenance_interval_days` and an optional task label (e.g. "Calibrate", "Replace blades", "Battery check", "Service drill"), `last_maintained_on`, derived `next_maintenance_on`. Calibration keeps its own `calibration_due_on`.
  - **Maintenance log** (`tool_maintenance_logs`): date, task, done by (tech or vendor), cost, paid by (company/tech → `part_purchases` category `tool`), notes, photo. Logging resets the due date. Techs log for tools in their custody (`tools.maintenance_log`).
  - Due/overdue tools show on the tech's Today shortcuts ("Tool check") and emit `tool.maintenance_due` (7 days before and on the day).
  - Tools in `in_repair` can't be assigned; returning from repair requires a condition + photo.
- **Add tool fast:** photo of the tool's label/nameplate → optional Gemini `tool_label` read prefills brand, model and serial (tech confirms). Fully typed when AI is off.
- **Optional by design:** flag `tools` (default off) hides the module company-wide; per-tech `uses_company_tools = false` hides My Tools, audits and tool reminders for that tech, while the tech-owned registry stays available if the tech wants their own tools on record.

**Later**
- Bluetooth tag integrations
- Depreciation schedules

---

### M19 Live tech map (flag `map`)

**MVP**
- `/map`, admin/office: Leaflet (dynamic import, `ssr:false`), tile URL from `NEXT_PUBLIC_TILE_URL`, `L.divIcon` markers.
- **Tech markers:**
  - Initials in a colored circle with a status ring (clocked out / idle / en route / on job).
  - "Last seen 4 min ago" with staleness fading: > 15 min grey, > 60 min hidden unless toggled.
  - Shows `accuracy` as a halo when > 100 m.
- **Job pins** for today: status color and window. Tap → job sheet with an assign action.
- **Side list (desktop) / bottom sheet (mobile):** techs with current job and next job, ETA chip.
- **Location sources** (web limits): pings every ≥ 60 s while the app is open and on shift, plus status-change stamps.
  - Upsert `tech_locations` (last known).
  - Optional `location_breadcrumbs` (`settings.map.keep_breadcrumbs_days`, default 0 = off; max 30), pruned daily.
- **Customer tracking page** `/t/[token]`: active only while the job is `en_route`. Shows tech card (first name, photo, license #), ETA, company phone, and the tech's last-known position on a small static map. Expires on `arrived` or after 3 h. No continuous tracking claims.
- ⚖️ Pings are accepted only when the user is clocked in and `monitoring_notice_ack_at` is set.
- **Geocoding:** properties geocoded on save via the `GeocodeProvider` (US Census free default). Results are cached.

**Later**
- OBD/vehicle tracker adapter for continuous positions
- Route playback
- Geofence auto-arrive
- Nearest-tech suggestion for new emergency jobs (straight-line distance in MVP-lite is fine)

---

### M20 Insights dashboards

All KPIs are computed server-side in SQL, rendered as Server Components with hand-rolled SVG charts. Period selector: Today / This week / This month / Last 30 / Custom (company TZ). Every number is tappable → the filtered list behind it. "Δ vs previous period" is shown where meaningful.

**Definitions used below**
- *Collected revenue* = Σ `payments.amount_cents` where status `succeeded`, kind ∈ {`deposit`, `payment`}, `succeeded_at` in period − Σ refunds `created_at` in period. Tips are excluded.
- *Invoiced revenue* = Σ invoice totals (pre-tax subtotal − discounts) for invoices `issued_at` in period, not void.
- *Completed job* = a job with `completed_at` in period, not cancelled.

**Admin dashboard**

| KPI | Formula |
|---|---|
| Collected revenue | as defined |
| Invoiced revenue | as defined |
| Avg ticket | invoiced revenue ÷ completed jobs with invoice total > 0 |
| Jobs completed | count |
| Gross margin % | (invoiced revenue − parts cost − processing fees − tech commission − reimbursements) ÷ invoiced revenue |
| Company net per job | Σ `job_financials.company_net` ÷ completed jobs |
| AR outstanding | Σ invoice balances > 0; aging buckets 0–30/31–60/61–90/90+ by `issued_at` |
| Estimate close rate | approved ÷ (approved + declined + expired) for estimates `sent_at` in period |
| Unsold estimate value | Σ max-option total for `sent`/`viewed` estimates not expired |
| Lead → booked % | leads created in period with status `booked` ÷ leads created in period (excl. spam) |
| Median speed-to-lead | median(`first_response_at − created_at`) for leads created in period (business hours only when `settings.leads.sla_business_hours`) |
| % leads contacted < 5 min | count(response ≤ 5 min) ÷ leads |
| Lead-source ROI | per source: leads, booked, collected revenue from jobs linked to those leads, cost (Σ `source_cost_cents` + `source_spend`), CPL = cost ÷ leads, cost/booked, ROAS = revenue ÷ cost |
| Callback rate | jobs with `callback_of` completed in period ÷ completed jobs; per tech by original job's primary tech (target ≈ 2%) |
| Cancellation rate | cancelled ÷ jobs scheduled in period; breakdown by reason; **cancelled-after-arrival count** |
| No-show (customer) rate | cancelled with reason `customer_no_show` ÷ scheduled |
| Review request click rate | clicked ÷ sent |
| Dispute rate | disputes created in trailing 30/90 d ÷ card payments in same window (alert line 0.75%) |
| Dispute win rate | won ÷ closed |
| Cash held outstanding | Σ net `cash_held` − `cash_remitted` per tech; oldest age |
| Payroll cost % | Σ tech earnings excluding tips and reimbursements (commission + spiffs + guarantee top-ups) ÷ collected revenue |
| Tech leaderboard | per tech: completed jobs, invoiced revenue, avg ticket, close rate, callback rate, review clicks, readiness avg, cash share (cash collected ÷ total collected) |
| Fleet | cost per mile (Σ fuel + service ÷ miles), overdue reminders, open issues |
| Anomaly report (weekly card) | cancelled-after-arrival; $0 or > X% discounted jobs; invoice revisions after completion/payment; tech cash share > company avg + 2σ (or > 1.5× avg when n < 10); arrival geostamp within radius but job cancelled; invoice # gaps (should be none); unbilled tech receipts and company-card receipts; manual payments unverified > 3 d; **completed jobs with no payment and no invoice sent after 48 h** (personal-card/cash side-deal signal); **customer-flagged receipts** ("Wrong amount?"); cash-on-hand discrepancies declared at end of day; bank-detail changes in the period |

**Office dashboard ("Today / Ops")**
- New leads waiting (with SLA timers)
- Leads not contacted > 15 min
- Unassigned jobs today/tomorrow
- **Unconfirmed tomorrow**
- Deposits unpaid
- Outbox pending (mine/all)
- Overdue invoices (count, Σ)
- Estimates to follow up today
- Approvals queue (vehicles, parts receipts, cancels)
- Running-late techs (window end passed and not arrived)
- Tasks due today / overdue (mine, or all with `tasks.view_all`)
- Customer-flagged receipts and low internal ratings awaiting a call back

**Tech dashboard ("My Day / My Stats")**
- Today: jobs count, next job, completed today
- **Period earnings (live)**: Σ tech line nets for the open period, plus the trace
- Avg ticket, close rate, callback rate, review clicks (own; ranks shown only if `settings.insights.show_tech_rank`)
- Cash on hand + age
- Pending reimbursements
- Vehicle due items, tool audit due

**Later**
- Saved custom reports
- Scheduled email digests beyond the daily overdue/ops digest (the daily digest is MVP)
- Goals and targets

---

### M21 Settings

All settings live in `company.settings` (zod schema `CompanySettings`, versioned with defaults merged at read) unless they need their own table. Pages and contents:

| Page | Contents | MVP |
|---|---|---|
| Company | Legal name, DBA/brand name, logo, phone, email, website, address, license #s (per state/trade), EIN (optional, for 10DLC later), time zone, business hours, after-hours definition, service-area ZIPs, currency (USD) | ✓ |
| Branding | Accent color (overrides `--sys-blue` for brand; contrast-checked; auto-derives `--accent-text`), logo light/dark, app name/icon (manifest), invoice header style | ✓ |
| Job types (`/settings/services`) | Two levels (M05): the three kind cards (Free estimate, Service call, Project) with their defaults row, and the trade's jobs under each. Per job: name, color, icon, default duration, default price/price-book items, `contract_kind` (`repair`/`improvement`), deposit rule, checklist template, required photos before/after, requires signed estimate, requires ownership check (⚖️), warranty days, `upsell_covered`, include photos on invoice, custom fields; a kind switch moves a job to another card; archive and restore. No maintenance interval | ✓ |
| Jobs & scheduling | Booking (jobs per tech a day `daily_job_cap` 6, far jobs `max_extra_miles` 25, book after hours `after_hours_booking` off), arrival windows (default length, the unconfirmed flag time), arrival check radius, cancellation policy and fees, service-call fee, callbacks & warranty, schedule board hours, job number prefix | ✓ |
| Price book | Items, categories, markup matrix, CSV import/export | ✓ |
| Taxes | Rates (name, bps), default rate, per-service-type override, labor vs parts taxability defaults, tax-exempt customers | ✓ |
| Invoices & estimates | Number prefixes/next number, due terms, footer, terms & policies (versioned: cancellation, refund, warranty, deposit, e-records consent text), estimate expiry, change-order threshold, auto-issue on complete, photos on invoice default, photos on receipt default, late-fee policy | ✓ |
| Payments | Enabled methods, Stripe keys (`settings.integrations`), statement descriptor + suffix rule, fee policy (absorb/cash discount/surcharge), fee % per manual method, tips on/off + presets, keyed cards allowed, check photo required, max refund per role | ✓ |
| Deposits | Rules list (priority, trigger, amount, mode, policy) | ✓ |
| Compliance profile ⚖️ | State, contract templates on/off, deposit cap warnings, surcharge restrictions, wage-deduction restrictions, monitoring-notice text, quiet hours (default 8–20), frequency caps, consent text | ✓ |
| Chargeback protection | Risk weights & thresholds (§11), controls per band, readiness weights, EFW multiplier | ✓ |
| Commission & payroll | Plans, assignments (incl. per-tech cash overrides), pay period, close delay, negative-balance policy, NACHA settings (company bank info encrypted), bank-change payout hold hours, 1099 threshold, mileage rates | ✓ |
| Messaging | SMS driver, outbox owner by template, `tech_texts_from` (tech_phone / office_outbox, §M06), link-mode delimiter default, WhatsApp on/off, email from-name, company phone for replies | ✓ |
| Templates | All message/doc templates | ✓ |
| Automations | §M13 | ✓ |
| Reviews | Google review URL (+ test), min days between, delay, reminder on/off, internal rating page on/off | ✓ |
| Tags | Custom tags: name, color, applies-to (customer/job/lead/estimate/invoice/tool/vehicle) | ✓ |
| Custom fields | Per entity (customer, property, job, lead, vehicle, tool) + optional service-type scope: key, label, type (`text`/`number`/`money`/`date`/`select`/`multiselect`/`boolean`/`photo`), options, required, show on invoice | ✓ |
| Checklists | Templates per service type | ✓ |
| Reminders | Custom reminders (§M13) | ✓ |
| Vehicles | Policies per entry type, inspection frequency, require odometer on clock, seeds for reminder rules | ✓ |
| Tools | Enabled, audit frequency, default maintenance intervals per category, deductions (⚖️ off), tool agreement text | ✓ |
| Features | All module flags (§5 table) | ✓ |
| Permissions | Role grid + per-user overrides (§4) | ✓ |
| Lead sources & API keys | Sources (integration kind: plain form / JS snippet / hosted form / JSON API / preset; public/secret keys, allowed origins, `require_ts`, spam review threshold, mapping, Turnstile, cost model), snippet generator (§8.5), test console showing last 20 payloads; general API keys (scopes) | ✓ |
| Integrations | Stripe, email, SMS driver creds, storage, Gemini (tier, budget), push (VAPID public key display), geocoder, tiles. Secrets are **write-only** in the UI (show last 4), stored encrypted (`secrets` table) or via env (env wins) | ✓ |
| Data | Export everything (JSON+CSV+media zip), CSV imports (customers, price book, jobs history), backups status, danger zone (reset demo data) | ✓ |

---

### M22 Notifications, activity & audit

**MVP**
- **In-app notifications** (`notifications`): bell with unread count; grouped; deep links; mark all read.
- **Web Push:**
  - VAPID via `web-push`.
  - Subscribe from a user gesture after install (iOS 16.4+ standalone only).
  - `push_subscriptions` per device; dead subscriptions (410) are pruned.
  - Per-user preferences per notification type (push / email / off).
- **Email fallback** for critical alerts when push is unavailable: new lead (if on-call), dispute, cash over limit, settlement ready.
- **Notification catalog:** listed in §7.3 (internal audience rows).
- **Activity (timeline)** (`activity`): human-readable entries per entity (customer/job/lead/estimate/invoice/vehicle/tool/user) written by event handlers. Powers the customer timeline and job history.
- **Audit log** (`audit_log`, append-only):
  - Fields: actor, action, entity, entity id, **before/after JSON diff**, IP, UA, time.
  - Covers every mutation of money, permissions, settings, invoices, payments, comp plans, settlements, customer PII views by techs, exports and deletions.
  - Viewer `/settings/audit` with filters (`audit.view`). DB-level: no UPDATE/DELETE grants for the app role on `audit_log`, `ledger_entries`, `consent_events` or `signatures` in prod (documented in DEPLOY.md; enforced by a trigger raising an exception).
- **Daily ops digest** (email/push 07:30): today's jobs, unconfirmed, overdue invoices, pending approvals.
- **Tasks** (`tasks`): one lightweight to-do list used by every module instead of ad-hoc "task" concepts. Kinds: `lead_retry` (call no-answer, +15 min), `warranty_claim` (M15), `restock` (M15), `callback_customer` (low rating, flagged receipt), `refund_due`, `follow_up`, `custom`. Fields: title, due_at, assignee, entity link, status (`open` | `done` | `dismissed`). Shown on Today (own) and `/tasks` (all, with `tasks.view_all`). A due task emits `task.due` → push to the assignee. Anyone can create a task for themselves; assigning to others needs `tasks.view_all`.

---

### M23 Customer portal (magic links, no login)

**MVP**
- **Token links** (`public_tokens`, sha256-hashed, minted per send, expiring):

  | Path | Purpose | Expiry |
  |---|---|---|
  | `/j/[token]` | Job page: tech card, status, window, confirm/reschedule request, estimate, invoice, photos, pay button, contact | 30 d after completion |
  | `/e/[token]` | Estimate view/select/sign/deposit | Estimate expiry |
  | `/i/[token]` | Invoice view/print/pay. `?receipt={payment_id}` opens that payment's receipt with a **"Wrong amount? / I didn't pay this"** button → portal action `receipt_flagged` → event `payment.customer_flagged` → high-priority admin alert + `callback_customer` task. `receipt.link` in templates resolves to this URL. | 180 d |
  | `/p/[token]` | Pay link (creates Checkout Session) | 7 d (re-mint on resend) |
  | `/r/[token]` | Review redirect / rating page | 30 d |
  | `/t/[token]` | Live arrival tracking | While en route (≤ 3 h) |

- Every portal hit is written to `portal_access_log` (token id, path, action, IP, UA, time). This feeds `access_activity_log` evidence.
- Pages are Server Components with minimal client JS (the signature pad is ~3 KB hand-rolled canvas; the pay button is a plain link).
- Branding from Settings. Footer: company license #, phone, and "Pay only {Company}".
- **Security:** tokens are 32 random bytes; enumeration is impossible; rate limit 60/min per IP; no PII in URLs.

**Later**
- Customer account login (history across jobs)
- Self-service online booking
- Membership management

---

### M24 Data import/export & backups

**MVP**
- **Export everything** (`data.export`): background job → zip in storage containing JSON per table (excluding secrets/session tokens), CSVs for the main entities, and a media manifest + files. A signed download link is valid for 24 h.
- **CSV import:** customers (+ properties), price book, past jobs (for history/LTV); column mapping UI; dry-run preview; dedupe.
- **Nightly backup:** cron 02:00 → JSON export of all tables to storage under `backups/YYYY-MM-DD/`, keeping 14 daily + 8 weekly copies. Restore script `scripts/restore.ts`.
- **Demo seed:** `pnpm seed:demo` creates a realistic sample: 3 techs, 1 office, 60 customers, 120 jobs, estimates, payments and a settlement.

**Later**
- QuickBooks/Xero sync adapters
- Import from Jobber/Housecall Pro/Workiz CSV exports (mapping presets)

---

## 6. Data model

### 6.1 Conventions (MUST)
- **SQL dialect:** Postgres **16-compatible** SQL only (PGlite runs 18.3; prod may run 16/17). Do not use `uuidv7()` or extensions.
- **Primary keys:** `id uuid primary key default gen_random_uuid()` unless noted. High-volume append-only logs use `bigint generated always as identity`.
- **Timestamps:** every mutable table has `created_at timestamptz not null default now()` and `updated_at timestamptz not null default now()` (updated in the DAL, not by triggers). The DDL below writes these as `…ts` for brevity, and `id uuid pk` means `id uuid primary key default gen_random_uuid()`.
- **Soft delete:** `deleted_at timestamptz null` where listed. The DAL filters `deleted_at is null` by default.
- **Money:** `bigint` columns named `*_cents` (Drizzle `bigint({ mode: 'number' })`). Rates use **basis points** in `int` (`2500` = 25.00%). Quantities use `numeric(12,3)`. Rounding is half away from zero at the line level (`src/lib/money.ts`).
- **Enums:** stored as `text`. Allowed values are in `src/db/enums.ts` (zod enums) and listed in the comments below. CHECK constraints are added only where noted. Rationale: adding a value should never require a type migration.
- **Phones:** E.164 `text`. **Emails:** lower-cased `text`.
- **Custom field values:** `custom jsonb not null default '{}'`, keyed by `custom_field_defs.key`.
- **Append-only tables:** `audit_log`, `ledger_entries`, `consent_events`, `signatures`, `job_status_events`, `portal_access_log`, `events`, `invoice_revisions`. A `BEFORE UPDATE OR DELETE` trigger raises an exception. The one exception is `events.processed_at/attempts/error`, which the processor updates.
- **Schema files:** one Drizzle file per module in `src/db/schema/<module>.ts`. Shared columns come from helpers (`id()`, `timestamps()`, `softDelete()`, `money()`).
- **Encryption at rest** for gate codes, bank numbers and integration secrets: AES-256-GCM using a key derived (HKDF) from `SESSION_SECRET` (env `DATA_KEY` overrides). Stored as `v1:<iv>:<ct>:<tag>` base64url (`src/lib/crypto.ts`).

### 6.2 Company, auth, team, config
```sql
create table company (                       -- singleton
  id smallint primary key default 1 check (id = 1),
  name text not null,                        -- brand / DBA shown to customers
  legal_name text, phone text, email text, website text,
  address jsonb,                             -- {street,unit,city,state,zip,lat,lng}
  timezone text not null default 'America/New_York',
  state char(2),                             -- compliance profile state
  logo_media_id uuid,                        -- -> media (no FK: created before media)
  settings jsonb not null default '{}',      -- CompanySettings (zod, defaults merged on read)
  settings_version int not null default 1,
  …ts
);

create table roles (
  key text primary key,                      -- 'admin' | 'office' | 'tech' | custom
  name text not null,
  base_role text not null,                   -- which DEFAULT_GRANTS to inherit: admin|office|tech
  builtin boolean not null default false,
  …ts
);

create table users (
  id uuid pk,
  email text not null,                       -- lower-cased
  phone text,                                -- E.164
  name text not null,
  role text not null references roles(key),
  status text not null default 'active',     -- invited|pending|active|deactivated
  password_hash text,                        -- PHC string (argon2id or scrypt)
  avatar_media_id uuid,
  color text,                                -- calendar color hex
  license_numbers jsonb not null default '[]', -- [{state,trade,number,expires_on}]
  worker_type text not null default '1099',  -- w2|1099 (pay engine defaults)
  comp_plan_key text,                        -- current plan (history in tech_comp)
  uses_company_tools boolean not null default true,
  uses_company_vehicle boolean not null default true,
  skills uuid[] not null default '{}',       -- service_type ids
  service_zips text[] not null default '{}',
  home_base jsonb,
  work_hours jsonb,                          -- [{day:0-6 (0 = Sunday), start:'HH:MM', end:'HH:MM'}], company zone; null = business hours, [] = no regular days
  hire_date date,
  monitoring_notice_ack_at timestamptz,      -- ⚖️ required before location.share works
  esign_consent_at timestamptz,
  bank_routing_enc text, bank_account_enc text, bank_last4 text,
  bank_account_type text,                    -- checking|savings
  bank_holder_type text,                     -- personal(PPD)|business(CCD)
  bank_changed_at timestamptz, bank_verified_at timestamptz, bank_verified_by uuid, -- payout hold (M16)
  notification_prefs jsonb not null default '{}', -- {type: 'push'|'email'|'off'}
  last_login_at timestamptz, deactivated_at timestamptz,
  …ts
);
create unique index users_email_uq on users (email);
create index users_role_idx on users (role) where status = 'active';

create table time_off (                      -- a tech's time off (booking availability, Assign hub); rows are deleted to remove
  id uuid pk,
  user_id uuid not null references users(id) on delete cascade,
  starts_at timestamptz not null, ends_at timestamptz not null, -- check (ends_at > starts_at)
  note text, created_by uuid references users(id),
  …ts
);
create index time_off_user_idx on time_off (user_id, starts_at);

create table sessions (
  id uuid pk,
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,           -- sha256(base64url token)
  remember boolean not null default false,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  ip text, user_agent text,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index sessions_user_idx on sessions (user_id) where revoked_at is null;

create table login_attempts (
  id bigint generated always as identity primary key,
  email text, ip text, success boolean not null,
  created_at timestamptz not null default now()
);
create index login_attempts_email_idx on login_attempts (email, created_at);
create index login_attempts_ip_idx on login_attempts (ip, created_at);

create table invites (
  id uuid pk, name text not null, email text, phone text,
  role text not null references roles(key), worker_type text not null default '1099',
  token_hash text not null unique, invited_by uuid not null references users(id),
  expires_at timestamptz not null, accepted_at timestamptz, accepted_user_id uuid references users(id),
  revoked_at timestamptz, created_at timestamptz not null default now()
);

create table password_resets (
  id uuid pk, user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique, expires_at timestamptz not null, used_at timestamptz,
  created_by uuid references users(id),       -- admin-generated link
  created_at timestamptz not null default now()
);

create table role_permissions (
  role text not null references roles(key) on delete cascade,
  perm text not null,
  granted boolean not null,
  updated_by uuid references users(id), updated_at timestamptz not null default now(),
  primary key (role, perm)
);

create table user_permission_overrides (
  user_id uuid not null references users(id) on delete cascade,
  perm text not null,
  effect text not null check (effect in ('allow','deny')),
  reason text, created_by uuid references users(id), created_at timestamptz not null default now(),
  primary key (user_id, perm)
);

create table secrets (                         -- integration credentials set via UI (env wins)
  key text primary key, value_enc text not null, last4 text,
  updated_by uuid references users(id), updated_at timestamptz not null default now()
);

create table api_keys (                        -- general server API keys (Zapier etc.)
  id uuid pk, name text not null, prefix text not null,  -- 'sk_live_ab12'
  key_hash text not null unique, scopes text[] not null default '{leads:write}',
  last_used_at timestamptz, created_by uuid references users(id),
  created_at timestamptz not null default now(), revoked_at timestamptz
);

create table counters (                        -- gapless human numbers
  key text primary key,                        -- 'job'|'invoice'|'estimate'|'change_order'|'credit_note'
  prefix text not null, next_value bigint not null default 1001
);
-- next number: UPDATE counters SET next_value = next_value + 1 WHERE key=$1 RETURNING prefix, next_value - 1
-- inside the same transaction as the insert (row lock => gapless).

create table time_entries (
  id uuid pk, user_id uuid not null references users(id),
  clock_in_at timestamptz not null, clock_out_at timestamptz,
  in_lat double precision, in_lng double precision, out_lat double precision, out_lng double precision,
  in_odometer_id uuid, out_odometer_id uuid,  -- -> odometer_readings
  vehicle_id uuid,
  break_minutes int not null default 0,
  source text not null default 'app',         -- app|admin_edit
  edited_by uuid references users(id), edit_reason text,
  client_id uuid unique,                      -- offline idempotency
  …ts
);
create index time_entries_user_idx on time_entries (user_id, clock_in_at desc);

create table service_types (                -- job types: the three kinds' own rows + the trade's jobs (M05)
  id uuid pk, name text not null, color text, icon text,
  kind text not null default 'service',       -- estimate|service|project (Free estimate / Service call / Project)
  aliases text[] not null default '{}',       -- for lead fuzzy matching
  default_duration_min int not null default 60,
  default_price_cents bigint,
  contract_kind text not null default 'repair',  -- repair|improvement (⚖️ deposit caps)
  checklist_template_id uuid,
  photos_required_before int not null default 0,
  photos_required_after int not null default 0,
  photos_on_invoice boolean not null default true,
  requires_signed_estimate boolean not null default false,
  requires_ownership_check boolean not null default false, -- locksmith lockout/rekey
  upsell_covered boolean not null default false,          -- ⚖️ FTC cooling-off notice
  warranty_days int not null default 30,
  maintenance_interval_months int,            -- retired: always null (no maintenance reminders)
  sort int not null default 0, active boolean not null default true,
  …ts, deleted_at timestamptz
);

create table checklist_templates (
  id uuid pk, name text not null,
  items jsonb not null,                        -- [{id,label,type:'check'|'text'|'number'|'photo'|'signature'|'select',required,options?}]
  …ts
);

create table tags (
  id uuid pk, name text not null, color text not null default 'gray',
  applies_to text[] not null,                  -- customer|job|lead|estimate|invoice|vehicle|tool
  created_at timestamptz not null default now()
);
create unique index tags_name_uq on tags (lower(name));

create table entity_tags (
  tag_id uuid not null references tags(id) on delete cascade,
  entity_type text not null, entity_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (tag_id, entity_type, entity_id)
);
create index entity_tags_entity_idx on entity_tags (entity_type, entity_id);

create table custom_field_defs (
  id uuid pk, entity_type text not null,       -- customer|property|job|lead|vehicle|tool
  key text not null, label text not null,
  type text not null,                          -- text|number|money|date|select|multiselect|boolean|photo
  options jsonb, required boolean not null default false,
  service_type_ids uuid[] not null default '{}', -- empty = all
  show_on_invoice boolean not null default false,
  sort int not null default 0, active boolean not null default true,
  …ts,
  unique (entity_type, key)
);

create table tax_rates (
  id uuid pk, name text not null, rate_bps int not null,   -- 825 = 8.25%
  is_default boolean not null default false, active boolean not null default true, …ts
);

create table policy_versions (                -- immutable once referenced
  id uuid pk,
  kind text not null,  -- cancellation|refund|warranty|deposit|esign_consent|sms_terms|privacy|
                       -- comp_agreement|tool_agreement|monitoring_notice|cooling_off|card_on_file|
                       -- direct_deposit_auth
  version int not null, title text not null, body text not null,
  sha256 text not null, effective_from timestamptz not null default now(),
  created_by uuid references users(id), created_at timestamptz not null default now(),
  unique (kind, version)
);

create table pricebook_items (
  id uuid pk, kind text not null,              -- service|labor|part|material|fee
  sku text, name text not null, description text, category text,
  unit_cost_cents bigint, unit_price_cents bigint, -- null price => markup matrix
  avg_cost_cents bigint,                        -- maintained by stock moves
  taxable boolean not null default true,
  warranty_days int, manufacturer_warranty_months int,
  is_special_order boolean not null default false,
  vendor text, active boolean not null default true,
  …ts, deleted_at timestamptz
);
create index pricebook_name_idx on pricebook_items (lower(name) text_pattern_ops);

create table deposit_rules (
  id uuid pk, name text not null, priority int not null,
  trigger jsonb not null,    -- {type:'always'|'estimate_total_gte'|'has_special_order_parts'|'after_hours'|
                             --  'new_customer'|'risk_band_gte'|'scheduled_days_out_gte'|'service_type_in'|
                             --  'lead_source_in'|'customer_flag', value?}
  amount jsonb not null,     -- {type:'fixed'|'percent_total'|'percent_parts'|'parts_plus_percent',
                             --  value, min_cents?, max_cents?, round_to_cents?}
  mode text not null,        -- capture|hold|card_on_file|manual
  policy_version_id uuid references policy_versions(id),
  active boolean not null default true, …ts
);
```

### 6.3 Customers, properties, consent, leads
```sql
create table customers (
  id uuid pk,
  type text not null default 'residential',   -- residential|commercial|property_manager|home_warranty
  first_name text, last_name text, display_name text not null, company_name text,
  phone text, phone_alt text, email text,
  preferred_channel text not null default 'sms', -- sms|whatsapp|email|call
  language text not null default 'en',
  sms_status text not null default 'unknown',    -- unknown|transactional|marketing|opted_out (derived)
  do_not_service boolean not null default false,
  prepay_required boolean not null default false,
  dispute_history boolean not null default false,
  vip boolean not null default false,
  tax_exempt boolean not null default false, tax_exempt_media_id uuid,
  do_not_text boolean not null default false,
  do_not_contact boolean not null default false,
  is_test boolean not null default false,
  waived_fee_count int not null default 0,
  card_fingerprints text[] not null default '{}', -- from payments (risk matching)
  lead_source_id uuid, source text,               -- denormalized first source
  first_touch jsonb,
  custom jsonb not null default '{}',
  notes text,
  merged_into_id uuid references customers(id),
  anonymized_at timestamptz,
  created_by uuid references users(id),
  …ts, deleted_at timestamptz
);
create index customers_phone_idx on customers (phone);
create index customers_phone_alt_idx on customers (phone_alt);
create index customers_email_idx on customers (email);
create index customers_name_idx on customers (lower(display_name) text_pattern_ops);
create index customers_fp_idx on customers using gin (card_fingerprints);

create table properties (
  id uuid pk, customer_id uuid not null references customers(id),
  label text,                                   -- 'Home', 'Rental #2'
  street text not null, unit text, city text not null, state char(2) not null, zip text not null,
  lat double precision, lng double precision,
  geocode_status text not null default 'pending', -- pending|ok|failed|manual
  timezone text,                                -- derived from ZIP (quiet hours)
  access_notes text, gate_code_enc text, pets text,
  site_contact_name text, site_contact_phone text,
  property_type text,                           -- house|condo|apartment|commercial|other
  is_primary boolean not null default false,
  custom jsonb not null default '{}',
  …ts, deleted_at timestamptz
);
create index properties_customer_idx on properties (customer_id);
create index properties_addr_idx on properties (zip, lower(street));

create table consent_events (                   -- append-only, keep >= 5 years
  id uuid pk, customer_id uuid not null references customers(id),
  address text not null,                        -- phone (E.164) or email
  channel text not null,                        -- sms|whatsapp|email
  purpose text not null,                        -- transactional|marketing
  action text not null,                         -- grant|revoke
  source text not null,                         -- web_form|verbal|sms_keyword|admin|import|portal|natural_language
  text_shown text, page_url text, ip text, user_agent text,
  actor_user_id uuid references users(id),
  message_id uuid,                              -- inbound message that caused it
  created_at timestamptz not null default now()
);
create index consent_customer_idx on consent_events (customer_id, created_at);

create table lead_sources (
  id uuid pk, name text not null,
  kind text not null,       -- website|google_lsa|google_ads|angi|thumbtack|yelp|referral|repeat|phone|walk_in|zapier|other
  preset text not null default 'generic', -- generic|zapier|make|thumbtack|angi|google_ads_leadform
  public_key text unique,                 -- 'pk_live_…' (not secret)
  secret_hash text,                       -- sha256 of 'sk_…'
  hook_secret_hash text,                  -- path secret for presets
  allowed_origins text[] not null default '{}',
  mapping jsonb,                          -- {"customer.displayName":"name", …}
  turnstile_required boolean not null default false,
  integration_kind text not null default 'js_snippet', -- plain_form|js_snippet|hosted_form|json_api|preset
  require_ts boolean not null default true,  -- false by default for plain_form (static HTML can't sign _ts)
  daily_cap int not null default 500,
  cost_model text not null default 'none', -- none|per_lead|monthly
  default_cost_cents bigint,
  google_key_hash text,                   -- Google Ads lead form key
  active boolean not null default true, …ts
);

create table source_spend (
  id uuid pk, lead_source_id uuid not null references lead_sources(id),
  month date not null, amount_cents bigint not null, notes text, …ts,
  unique (lead_source_id, month)
);

create table leads (
  id uuid pk,
  lead_source_id uuid references lead_sources(id),
  external_id text,                        -- marketplace id (Thumbtack negotiationID, Google lead_id)
  status text not null default 'new',      -- new|contacted|qualified|booked|lost|spam
  customer_id uuid references customers(id),
  property_id uuid references properties(id),
  name text, phone text, email text,
  address jsonb,                           -- raw/normalized {street,city,state,zip}
  service_type_id uuid references service_types(id), service_text text,
  quoted_price_cents bigint, preferred_date date, preferred_window text,
  notes text,
  attribution jsonb not null default '{}', -- utm_*, gclid, gbraid, wbraid, fbclid, msclkid, referrer, landing_url, page_url, first_touch, last_touch
  extra jsonb not null default '{}',       -- unknown fields; _booking = {kind, priority, after_hours} typed on the call
  source_cost_cents bigint,
  sms_consent boolean not null default false,
  marketing_consent boolean not null default false,
  spam_score int not null default 0,       -- soft heuristics; >= threshold => "Check" filter
  is_returning boolean not null default false,
  is_test boolean not null default false,
  assigned_user_id uuid references users(id),
  first_response_at timestamptz, first_response_by uuid references users(id),
  lost_reason text, spam_reason text,
  converted_job_id uuid, converted_estimate_id uuid,
  dedupe_hash text,                        -- sha256(phone|service) for 10-min double-submit
  …ts
);
create unique index leads_source_ext_uq on leads (lead_source_id, external_id) where external_id is not null;
create index leads_status_idx on leads (status, created_at desc);
create index leads_dedupe_idx on leads (dedupe_hash, created_at);
create index leads_phone_idx on leads (phone);

create table lead_events (
  id uuid pk, lead_id uuid references leads(id), lead_source_id uuid references lead_sources(id),
  kind text not null,                      -- received|touch|call_attempt|status|note|spam|mapping_error
  raw jsonb, outcome text,                 -- call outcome: connected|no_answer|voicemail|wrong_number
                                           -- status rows: raw = {from, to, prev:{lost_reason, spam_score, spam_reason, converted_job_id}} (Undo, Reopen)
  actor_user_id uuid references users(id), ip text, user_agent text,
  created_at timestamptz not null default now()
);
create index lead_events_lead_idx on lead_events (lead_id, created_at);

create table calls (                       -- manual call log (tel: links)
  id uuid pk, customer_id uuid references customers(id), lead_id uuid references leads(id),
  job_id uuid, user_id uuid not null references users(id),
  direction text not null,                 -- out|in
  outcome text not null,                   -- connected|no_answer|voicemail|wrong_number|busy
  notes text, created_at timestamptz not null default now()
);
```

### 6.4 Jobs, scheduling, notes
```sql
create table jobs (
  id uuid pk,
  number text not null unique,             -- 'J-1042' via counters
  customer_id uuid not null references customers(id),
  property_id uuid not null references properties(id),
  service_type_id uuid references service_types(id),
  lead_id uuid references leads(id),
  estimate_id uuid,                        -- approved estimate (if any)
  title text not null, description text, customer_notes text,
  priority text not null default 'normal', -- normal|urgent|emergency
  after_hours boolean not null default false,
  status text not null default 'unscheduled',
    -- unscheduled|scheduled|confirmed|en_route|arrived|in_progress|on_hold|completed|closed|cancelled
  payment_status text not null default 'none', -- cache of ledger: none|deposit_paid|partial|paid|refunded|disputed
  scheduled_start timestamptz, scheduled_end timestamptz,
  window_start timestamptz, window_end timestamptz,
  confirmed_at timestamptz, en_route_at timestamptz, eta_at timestamptz,
  arrived_at timestamptz, started_at timestamptz, completed_at timestamptz,
  closed_at timestamptz, cancelled_at timestamptz,
  cancel_reason text,  -- customer_cancelled|customer_no_show|no_access|price|duplicate|tech_unavailable|weather|other
  cancel_note text, cancel_review_status text, -- null|pending|ok|flagged (after-arrival cancels)
  is_callback boolean not null default false,
  callback_of_job_id uuid references jobs(id),
  callback_reason text,                    -- workmanship|part|customer|other
  warranty_expires_at timestamptz,
  recurrence jsonb,                        -- {every:'weeks'|'months', n:int, until?:date}
  visit_count int not null default 1,      -- incremented by on_hold -> scheduled (return visit)
  custom_rate_bps int,                     -- per-job commission override (jobs.set_custom_rate); NOT in custom jsonb
  checklist jsonb not null default '[]',   -- snapshot of template items + answers
  custom jsonb not null default '{}',
  risk_score int, risk_band text,          -- low|medium|high|critical
  readiness_score int,
  cancellation_policy_version_id uuid references policy_versions(id),
  service_fee_disclosure text,             -- text shown at booking
  settlement_locked_at timestamptz,
  created_by uuid references users(id),
  …ts
);
create index jobs_sched_idx on jobs (scheduled_start) where status not in ('cancelled','closed');
create index jobs_status_idx on jobs (status, scheduled_start);
create index jobs_customer_idx on jobs (customer_id, created_at desc);
create index jobs_completed_idx on jobs (completed_at);
create index jobs_callback_idx on jobs (callback_of_job_id);

create table job_assignments (
  job_id uuid not null references jobs(id) on delete cascade,
  user_id uuid not null references users(id),
  role text not null default 'primary',    -- primary|helper
  split_bps int not null default 10000,    -- share of commission/spiffs
  assigned_by uuid references users(id), assigned_at timestamptz not null default now(),
  primary key (job_id, user_id)
);
create index job_assignments_user_idx on job_assignments (user_id);

create table job_status_events (           -- append-only
  id uuid pk, job_id uuid not null references jobs(id),
  from_status text, to_status text not null,
  actor_user_id uuid references users(id),
  at timestamptz not null default now(), client_ts timestamptz,
  lat double precision, lng double precision, accuracy_m real,
  distance_m real,                         -- to property lat/lng
  eta_minutes int, note text,
  client_id uuid unique                    -- offline idempotency
);
create index job_status_events_job_idx on job_status_events (job_id, at);

create table notes (
  id uuid pk, entity_type text not null, entity_id uuid not null,
  customer_id uuid, job_id uuid,
  body text not null, visibility text not null default 'internal', -- internal|customer
  pinned boolean not null default false,
  author_id uuid references users(id), client_id uuid unique,
  …ts, deleted_at timestamptz
);
create index notes_entity_idx on notes (entity_type, entity_id);
```

### 6.5 Estimates, invoices, signatures
```sql
create table estimates (
  id uuid pk, number text not null unique,  -- 'E-1001'
  job_id uuid references jobs(id), customer_id uuid not null references customers(id),
  property_id uuid references properties(id),
  status text not null default 'draft',     -- draft|sent|viewed|approved|declined|expired
  title text, notes text, warranty_text text,
  expires_at timestamptz,
  sent_at timestamptz, viewed_at timestamptz, approved_at timestamptz,
  declined_at timestamptz, decline_reason text,
  approved_option_id uuid, signature_id uuid,
  approval_channel text,                    -- remote_link|in_person|verbal
  policy_version_ids uuid[] not null default '{}',
  created_by uuid references users(id), …ts
);
create index estimates_status_idx on estimates (status, sent_at);
create index estimates_customer_idx on estimates (customer_id);

create table estimate_options (
  id uuid pk, estimate_id uuid not null references estimates(id) on delete cascade,
  label text not null, sort int not null default 0,
  recommended boolean not null default false, notes text, …ts
);

create table change_orders (
  id uuid pk, number text not null unique,  -- 'CO-1001'
  job_id uuid not null references jobs(id), estimate_id uuid references estimates(id),
  reason text not null,
  status text not null default 'draft',     -- draft|sent|approved|declined
  delta_cents bigint not null default 0,
  signature_id uuid, created_by uuid references users(id), …ts
);

create table invoices (
  id uuid pk, number text not null unique,  -- 'INV-1001'
  job_id uuid references jobs(id), customer_id uuid not null references customers(id),
  property_id uuid references properties(id),
  status text not null default 'draft',     -- draft|issued|partially_paid|paid|void|uncollectible (cache)
  version int not null default 1,
  issued_at timestamptz, due_at timestamptz,
  subtotal_cents bigint not null default 0, discount_cents bigint not null default 0,
  tax_cents bigint not null default 0, total_cents bigint not null default 0, -- frozen at issue
  terms text, notes text, warranty_text text,
  show_photos boolean not null default true,
  photo_media_ids uuid[] not null default '{}', -- ordered selection
  descriptor_suffix text,                   -- e.g. 'J1042'
  voided_at timestamptz, void_reason text,
  created_by uuid references users(id), …ts
);
create index invoices_customer_idx on invoices (customer_id);
create index invoices_status_idx on invoices (status, due_at);

create table line_items (
  id uuid pk,
  parent_type text not null,                -- estimate_option|invoice|change_order
  parent_id uuid not null,
  sort int not null default 0,
  type text not null,                       -- service|labor|part|material|fee|discount
  pricebook_item_id uuid references pricebook_items(id),
  name text not null, description text,
  qty numeric(12,3) not null default 1,
  unit_price_cents bigint not null, unit_cost_cents bigint,
  discount_cents bigint not null default 0,
  total_cents bigint not null,              -- round(qty*unit_price) - discount
  taxable boolean not null default true, tax_rate_bps int,
  part_source text,                         -- company_stock|company_po|company_card|tech_purchased (type=part/material)
  part_purchase_id uuid,                    -- -> part_purchases
  is_optional boolean not null default false, is_selected boolean not null default true,
  is_upsell boolean not null default false, -- ⚖️ cooling-off
  is_service_fee boolean not null default false, -- credited if repair approved
  warranty_days int, manufacturer_warranty_months int, serial text,
  …ts
);
create index line_items_parent_idx on line_items (parent_type, parent_id);
-- Lines whose parent invoice is issued are immutable (enforced in the DAL; revisions copy lines).

create table invoice_revisions (            -- append-only
  id uuid pk, invoice_id uuid not null references invoices(id),
  version int not null, snapshot jsonb not null, sha256 text not null,
  diff jsonb, reason text, created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (invoice_id, version)
);

create table credit_notes (
  id uuid pk, number text not null unique, invoice_id uuid not null references invoices(id),
  amount_cents bigint not null, reason text not null,
  created_by uuid references users(id), created_at timestamptz not null default now()
);

create table signatures (                    -- append-only
  id uuid pk,
  doc_type text not null,  -- estimate|change_order|completion|deposit_terms|ownership|comp_agreement|
                           -- tool_agreement|monitoring_notice|card_on_file|cooling_off_waiver|statement_ack
  doc_id uuid not null,
  doc_sha256 text not null,                  -- hash of rendered snapshot JSON/HTML
  doc_snapshot jsonb,                        -- what was shown (lines, totals, policy ids)
  policy_version_ids uuid[] not null default '{}',
  signer_name text not null, signer_kind text not null, -- customer|user
  signer_user_id uuid references users(id), customer_id uuid references customers(id),
  signature_media_id uuid,                   -- PNG of drawn signature
  channel text not null,                     -- in_person|remote_link|verbal
  esign_consent boolean not null, consent_text text,
  ip text, user_agent text,
  lat double precision, lng double precision, accuracy_m real,
  device_ts timestamptz, signed_at timestamptz not null default now(),
  token_id uuid                               -- public_tokens (remote)
);
create index signatures_doc_idx on signatures (doc_type, doc_id);

create view invoice_balances as
select i.id as invoice_id, i.total_cents,
  coalesce((select sum(p.amount_cents) from payments p
            where p.invoice_id = i.id and p.status in ('succeeded','partially_refunded','refunded','disputed')),0) as paid_cents,
  coalesce((select sum(r.amount_cents) from refunds r join payments p on p.id = r.payment_id
            where p.invoice_id = i.id and r.status = 'succeeded'),0) as refunded_cents,
  coalesce((select sum(c.amount_cents) from credit_notes c where c.invoice_id = i.id),0) as credited_cents
from invoices i;
-- balance_cents = total - paid + refunded - credited   (tips are stored separately in tip_cents, never in amount_cents)
-- A lost dispute is recorded as a refunds row (reason 'dispute_lost', status 'succeeded') so the balance reopens;
-- the $15 dispute fee is an expense line in job_financials.other_deductions_cents, not a refund.
```

### 6.6 Payments, deposits, disputes, risk
```sql
create table payments (
  id uuid pk,
  invoice_id uuid references invoices(id), job_id uuid references jobs(id),
  customer_id uuid not null references customers(id),
  deposit_request_id uuid,
  kind text not null,          -- deposit|payment|tip_only
  method text not null,        -- card|ach|cash|check|zelle|venmo|other
  provider text not null,      -- manual|stripe|square
  provider_ref text,           -- PaymentIntent / charge id
  status text not null,        -- pending|authorized|succeeded|failed|canceled|refunded|partially_refunded|disputed
  amount_cents bigint not null,          -- excludes tip
  tip_cents bigint not null default 0,
  fee_cents bigint not null default 0,   -- processor fee on amount+tip (actual or configured)
  fee_on_tip_cents bigint not null default 0,
  fee_source text not null default 'configured', -- actual|configured
  entry_mode text,             -- tap|chip|swipe|keyed|online|wallet|cash|check|p2p
  card_brand text, card_funding text, card_last4 text, card_fingerprint text,
  avs_result text, cvc_result text, three_ds text, wallet text,
  payer_name text, payer_ip text,
  reference text,              -- check #, Zelle conf
  proof_media_id uuid,
  collected_by_user_id uuid references users(id), -- tech who physically took cash/check
  verified_at timestamptz, verified_by uuid references users(id),
  authorized_at timestamptz, capture_before timestamptz, succeeded_at timestamptz,
  client_id uuid unique, idempotency_key text unique,
  raw jsonb,                   -- provider snapshot (trimmed)
  …ts
);
create index payments_invoice_idx on payments (invoice_id);
create index payments_job_idx on payments (job_id);
create index payments_success_idx on payments (succeeded_at) where status = 'succeeded';
create index payments_collected_idx on payments (collected_by_user_id, method);
create index payments_fp_idx on payments (card_fingerprint);

create table refunds (
  id uuid pk, payment_id uuid not null references payments(id),
  amount_cents bigint not null, reason text not null,
  status text not null default 'pending',   -- scheduled|pending|succeeded|failed
  due_at timestamptz,                        -- promised refund date
  provider_ref text, created_by uuid references users(id),
  created_at timestamptz not null default now(), completed_at timestamptz
);

create table deposit_requests (
  id uuid pk, job_id uuid references jobs(id), estimate_id uuid references estimates(id),
  rule_id uuid references deposit_rules(id),
  amount_cents bigint not null, mode text not null,  -- capture|hold|card_on_file|manual
  status text not null default 'required',  -- required|requested|paid|held|applied|refunded|forfeited|waived|expired
  policy_version_id uuid references policy_versions(id), policy_sha256 text,
  requested_at timestamptz, due_at timestamptz,
  payment_id uuid, special_order_po_at timestamptz,
  waived_by uuid references users(id), waive_reason text, forfeited_at timestamptz,
  cap_warning text,                          -- ⚖️ compliance warning shown
  …ts
);

create table checkout_sessions (
  id uuid pk, token_id uuid, provider text not null, session_ref text not null unique,
  invoice_id uuid, deposit_request_id uuid,
  amount_cents bigint not null, mode text not null,  -- capture|hold|save
  status text not null default 'open',      -- open|completed|expired
  expires_at timestamptz not null, created_at timestamptz not null default now()
);

create table disputes (
  id uuid pk, payment_id uuid not null references payments(id),
  provider text not null, provider_ref text not null unique,
  category text not null,      -- fraudulent|unrecognized|product_not_received|product_unacceptable|
                               -- credit_not_processed|duplicate|subscription_canceled|general
  network_reason_code text, amount_cents bigint not null,
  status text not null,        -- inquiry|needs_response|under_review|won|lost|accepted|warning_closed
  due_by timestamptz,
  evidence jsonb not null default '{}',     -- NormalizedEvidence (Stripe field names)
  evidence_files jsonb not null default '{}', -- field -> {media_id, provider_file_id}
  narrative text,
  readiness_at_open int,
  staged_at timestamptz, submitted_at timestamptz,
  outcome text, closed_at timestamptz,
  fee_cents bigint not null default 1500,
  …ts
);

create table risk_assessments (
  id uuid pk, job_id uuid not null references jobs(id),
  score int not null, band text not null,
  signals jsonb not null,                    -- [{key, points, detail}]
  trigger text not null,                     -- estimate_changed|payer_changed|payment_method|schedule|manual
  computed_at timestamptz not null default now()
);
create index risk_job_idx on risk_assessments (job_id, computed_at desc);

create table webhook_events (
  id uuid pk, provider text not null, event_id text not null, type text not null,
  payload jsonb not null, received_at timestamptz not null default now(),
  processed_at timestamptz, error text,
  unique (provider, event_id)
);
```

### 6.7 Media
```sql
create table media (
  id uuid pk,
  kind text not null,          -- photo|document|signature|receipt|avatar|logo|export|backup
  tag text,                    -- before|during|after|problem|receipt|odometer|document|tool|signature|id_check|other
  storage_key text not null,   -- derived 1600px (or file itself for docs)
  thumb_key text, original_key text,
  mime text not null, width int, height int, bytes int,
  sha256_original text, sha256_stored text,
  caption text,
  job_id uuid, customer_id uuid,
  entity_type text, entity_id uuid,         -- vehicle|tool|part_purchase|payment|odometer|…
  uploader_id uuid references users(id),
  file_last_modified timestamptz,           -- File.lastModified
  client_captured_at timestamptz,
  server_received_at timestamptz not null default now(),
  lat double precision, lng double precision, accuracy_m real,
  flags text[] not null default '{}',       -- possibly_from_library|no_geo|far_from_site
  include_in_invoice boolean not null default false,
  evidence_locked boolean not null default false, -- linked to issued invoice/signature/dispute
  client_id uuid unique,
  deleted_at timestamptz, deleted_by uuid references users(id), delete_reason text,
  created_at timestamptz not null default now()
);
create index media_job_idx on media (job_id, created_at);
create index media_entity_idx on media (entity_type, entity_id);
```

### 6.8 Messaging, automations, notifications, portal
```sql
create table message_templates (
  id uuid pk, key text not null,            -- e.g. 'job.on_my_way'
  channel text not null,                    -- sms|email|push|in_app
  locale text not null default 'en',
  purpose text not null,                    -- transactional|marketing|review|internal
  subject text, body text not null, default_body text not null,
  expires_after_minutes int,                -- outbox expiry
  allow_outside_quiet_hours boolean not null default false,
  builtin boolean not null default true,
  updated_by uuid references users(id), …ts,
  unique (key, channel, locale)
);

create table automations (
  id uuid pk, key text not null unique, name text not null, description text,
  trigger_event text not null,              -- see §7.1
  conditions jsonb not null default '{}',
  steps jsonb not null,  -- [{delay:{minutes?,hours?,days?}, anchor, channel, audience, template_key}]
  cancel_on jsonb not null default '[]',   -- event names or state predicates
  feature_flag text,                        -- suppressed when flag off
  enabled boolean not null default true, builtin boolean not null default true,
  updated_by uuid references users(id), …ts
);

create table events (                       -- transactional outbox
  id bigint generated always as identity primary key,
  type text not null, entity_type text, entity_id uuid,
  payload jsonb not null, actor_user_id uuid,
  created_at timestamptz not null default now(),
  processed_at timestamptz, attempts int not null default 0, error text
);
create index events_unprocessed_idx on events (id) where processed_at is null;

create table scheduled_messages (
  id uuid pk,
  automation_id uuid references automations(id), step_index int,
  dedupe_key text not null unique,          -- automation:entity:step  (or manual:<uuid>)
  event_id bigint,
  template_key text not null, channel text not null, purpose text not null,
  audience_type text not null,              -- customer|user
  recipient_customer_id uuid, recipient_user_id uuid, to_address text,
  entity_type text, entity_id uuid, job_id uuid,
  send_at timestamptz not null, expires_at timestamptz,
  status text not null default 'scheduled',
    -- scheduled|deferred_quiet|pending_tap|sent|sent_manual|skipped|delivered|failed|canceled|suppressed_optout|expired
  driver text, assigned_user_id uuid references users(id),
  rendered_subject text, rendered_body text,
  message_id uuid, provider_id text, attempts int not null default 0, last_error text,
  …ts
);
create index sched_due_idx on scheduled_messages (send_at) where status in ('scheduled','deferred_quiet');
create index sched_outbox_idx on scheduled_messages (assigned_user_id, status) where status = 'pending_tap';
create index sched_entity_idx on scheduled_messages (entity_type, entity_id);

create table messages (
  id uuid pk,
  customer_id uuid references customers(id), lead_id uuid, job_id uuid,
  user_id uuid references users(id),        -- staff counterpart (internal or sender)
  direction text not null,                  -- out|in
  channel text not null, driver text not null, purpose text not null,
  to_address text, from_address text, subject text, body text not null,
  media_ids uuid[] not null default '{}',
  status text not null,                     -- queued|sent|sent_manual|delivered|failed|received|logged
  provider_id text, error text,
  scheduled_message_id uuid, template_key text,
  sent_by_user_id uuid references users(id),
  sent_at timestamptz, delivered_at timestamptz,
  created_at timestamptz not null default now()
);
create index messages_customer_idx on messages (customer_id, created_at desc);
create index messages_provider_idx on messages (provider_id);

create table notifications (
  id uuid pk, user_id uuid not null references users(id) on delete cascade,
  type text not null, title text not null, body text, url text,
  entity_type text, entity_id uuid, priority text not null default 'normal',
  read_at timestamptz, created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, created_at desc) where read_at is null;

create table push_subscriptions (
  id uuid pk, user_id uuid not null references users(id) on delete cascade,
  endpoint text not null unique, p256dh text not null, auth text not null,
  user_agent text, failed_count int not null default 0, last_success_at timestamptz,
  created_at timestamptz not null default now()
);

create table reminders (                     -- custom reminders (admin)
  id uuid pk, title text not null, body text, template_key text,
  audience jsonb not null,                   -- {type:'user'|'role'|'customer', id|role}
  channel text not null,                     -- push|email|sms|in_app
  recurrence jsonb not null,                 -- {type:'once'|'daily'|'weekly'|'monthly'|'every_n_days'|'every_n_miles', …}
  next_at timestamptz, last_at timestamptz,
  entity_type text, entity_id uuid,
  active boolean not null default true, created_by uuid references users(id), …ts
);
create index reminders_due_idx on reminders (next_at) where active;

create table review_requests (
  id uuid pk, job_id uuid not null unique references jobs(id),
  customer_id uuid not null references customers(id), tech_user_id uuid references users(id),
  token_id uuid, sent_count int not null default 0,
  first_sent_at timestamptz, last_sent_at timestamptz,
  clicked_at timestamptz, click_count int not null default 0,
  rating int, feedback text, wants_callback boolean,
  review_received_at timestamptz,            -- manual log for bonuses
  created_at timestamptz not null default now()
);

create table public_tokens (
  id uuid pk, token_hash text not null unique,
  kind text not null,                        -- job|estimate|invoice|pay|review|tracking|sub_job
  entity_type text not null, entity_id uuid not null,
  customer_id uuid, job_id uuid,
  expires_at timestamptz not null, revoked_at timestamptz,
  use_count int not null default 0, last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create table portal_access_log (              -- append-only
  id bigint generated always as identity primary key,
  token_id uuid not null, path text not null,
  action text not null,  -- viewed|signed|approved|declined|pay_opened|paid|confirmed|reschedule_requested|rated|clicked|receipt_flagged
  ip text, user_agent text, created_at timestamptz not null default now()
);
create index portal_log_token_idx on portal_access_log (token_id, created_at);
```

### 6.9 Parts & inventory
```sql
create table part_purchases (
  id uuid pk,
  paid_by text not null,                     -- company|tech
  instrument text,                           -- personal (tech) | company_card | company_account | po
  purchaser_user_id uuid references users(id),
  category text not null default 'part',     -- part|fuel|vehicle|tool|supplies|other
  job_id uuid references jobs(id), vehicle_id uuid, tool_id uuid,
  vendor text, purchased_on date,
  subtotal_cents bigint, tax_cents bigint, total_cents bigint not null,
  receipt_media_id uuid,
  ai_extract jsonb, ai_status text,           -- null|queued|done|failed|skipped
  status text not null default 'pending',    -- pending|approved|rejected (company-paid: approved on create)
  decided_by uuid references users(id), decided_at timestamptz, reject_reason text,
  auto_approved boolean not null default false,
  ledger_entry_id uuid,                       -- reimbursement line
  notes text, client_id uuid unique, …ts
);
create index part_purchases_status_idx on part_purchases (status, created_at);
create index part_purchases_job_idx on part_purchases (job_id);

create table stock_locations (
  id uuid pk, kind text not null,            -- warehouse|vehicle
  name text not null, vehicle_id uuid, active boolean not null default true, …ts
);

create table inventory_levels (
  location_id uuid not null references stock_locations(id),
  pricebook_item_id uuid not null references pricebook_items(id),
  on_hand numeric(12,3) not null default 0, min_qty numeric(12,3), max_qty numeric(12,3),
  updated_at timestamptz not null default now(),
  primary key (location_id, pricebook_item_id)
);

create table stock_moves (
  id uuid pk, pricebook_item_id uuid not null references pricebook_items(id),
  from_location_id uuid references stock_locations(id), to_location_id uuid references stock_locations(id),
  qty numeric(12,3) not null, unit_cost_cents bigint,
  kind text not null,                        -- receive|transfer|use_on_job|adjust|return|count
  job_id uuid, line_item_id uuid, note text,
  actor_user_id uuid references users(id), created_at timestamptz not null default now()
);
```

### 6.10 Commission, payroll, payouts
```sql
create table comp_plans (
  id uuid pk, plan_key text not null,        -- 'partner_25'
  name text not null, version int not null,
  effective_from date not null,
  config jsonb not null,                     -- CompPlan (§10.1), zod-validated
  created_by uuid references users(id), created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (plan_key, version)
);

create table tech_comp (                     -- assignment history
  id uuid pk, user_id uuid not null references users(id),
  plan_key text not null, overrides jsonb not null default '{}',
    -- {rate_bps?, by_service_type?:{id:bps}, tech_keeps_cash?:bool, cash_settlement?:'net_in_payout'|'separate_remittance'}
  effective_from date not null,
  agreement_signature_id uuid, agreement_plan_version int,
  created_by uuid references users(id), created_at timestamptz not null default now()
);
create index tech_comp_user_idx on tech_comp (user_id, effective_from desc);

create table job_financials (                -- one per job; recomputed until locked
  job_id uuid primary key references jobs(id),
  revenue_cents bigint not null,             -- subtotal - discounts (excl tax, tip)
  tax_cents bigint not null, tip_cents bigint not null,
  company_parts_cents bigint not null, tech_parts_cents bigint not null,
  fees_cents bigint not null,                -- fees attributable to revenue (excl tip fee)
  fees_on_tips_cents bigint not null,
  other_deductions_cents bigint not null default 0,
  base_cents bigint not null,
  company_net_cents bigint not null,
  plan_key text not null, plan_version int not null,
  trace jsonb not null,
  computed_at timestamptz not null default now(),
  locked_settlement_id uuid, locked_at timestamptz
);

create table job_earnings (                  -- per tech per job
  job_id uuid not null references jobs(id), user_id uuid not null references users(id),
  split_bps int not null, rate_bps int not null, rate_source text not null, -- job|tech_service|tech|service|role|plan
  commission_cents bigint not null, spiffs_cents bigint not null default 0,
  tip_cents bigint not null, reimbursement_cents bigint not null,
  cash_held_cents bigint not null, net_cents bigint not null,
  trace jsonb not null,
  primary key (job_id, user_id)
);

create table pay_periods (
  id uuid pk, starts_on date not null unique, ends_on date not null,
  status text not null default 'open',       -- open|closed
  closed_at timestamptz
);

create table ledger_entries (                 -- append-only; + = company owes tech
  id uuid pk, user_id uuid not null references users(id),
  type text not null,
    -- commission|tip|spiff|reimbursement_parts|reimbursement_expense|reimbursement_mileage|
    -- cash_held|cash_remitted|chargeback_hold|chargeback_release|chargeback_clawback|recall_clawback|
    -- tool_deduction|tool_allowance|tool_deposit|draw|guarantee_topup|ot_topup|adjustment|payout|carry_forward
  amount_cents bigint not null,
  effective_date date not null,
  job_id uuid, ref_table text, ref_id uuid,
  pay_period_id uuid references pay_periods(id),
  settlement_id uuid,
  reverses_id uuid references ledger_entries(id),
  wage_class text not null default 'n/a',    -- wage|reimbursement|custody|n/a (W-2 exports)
  needs_review boolean not null default false, -- ⚖️ W-2 deductions awaiting admin
  memo text, created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index ledger_user_period_idx on ledger_entries (user_id, pay_period_id);
create index ledger_unsettled_idx on ledger_entries (user_id) where settlement_id is null;
create index ledger_job_idx on ledger_entries (job_id);

create table settlements (
  id uuid pk, user_id uuid not null references users(id),
  pay_period_id uuid not null references pay_periods(id),
  status text not null default 'draft',      -- draft|tech_review|approved|paid|locked
  worker_type text not null,
  opening_balance_cents bigint not null, period_net_cents bigint not null,
  closing_balance_cents bigint not null,
  totals jsonb not null,                     -- by ledger type + wages/reimbursements split
  review_deadline timestamptz,
  tech_ack_at timestamptz, tech_ack_name text, tech_ack_ip text,
  approved_by uuid references users(id), approved_at timestamptz,
  paid_at timestamptz, locked_at timestamptz,
  …ts,
  unique (user_id, pay_period_id)
);

create table settlement_flags (
  id uuid pk, settlement_id uuid not null references settlements(id),
  ledger_entry_id uuid references ledger_entries(id), job_id uuid,
  user_id uuid not null references users(id), comment text not null,
  status text not null default 'open',       -- open|resolved|rejected
  resolution text, resolved_by uuid references users(id),
  created_at timestamptz not null default now(), resolved_at timestamptz
);

create table payouts (
  id uuid pk, user_id uuid not null references users(id),
  amount_cents bigint not null,
  method text not null,                      -- ach_nacha|zelle|check|cash|payroll_provider|stripe_connect|other
  reference text, paid_on date not null, proof_media_id uuid,
  nacha_batch_id uuid, ledger_entry_id uuid,
  created_by uuid references users(id), created_at timestamptz not null default now()
);

create table payout_settlements (
  payout_id uuid not null references payouts(id), settlement_id uuid not null references settlements(id),
  amount_cents bigint not null, primary key (payout_id, settlement_id)
);

create table nacha_batches (
  id uuid pk, storage_key text not null, sec_code text not null,  -- PPD|CCD
  entry_count int not null, total_cents bigint not null, effective_date date not null,
  created_by uuid references users(id), created_at timestamptz not null default now()
);

create table cash_remittances (
  id uuid pk, user_id uuid not null references users(id),
  amount_cents bigint not null, method text not null,  -- bank_deposit|hand_in
  proof_media_id uuid, status text not null default 'pending', -- pending|confirmed|disputed
  received_by uuid references users(id), received_at timestamptz,
  ledger_entry_id uuid, client_id uuid unique, …ts
);

create table mileage_rates (
  id uuid pk, effective_from date not null unique,
  millicents_per_mile int not null,          -- 72500 = 72.5¢
  source text
);
```

### 6.11 Vehicles
```sql
create table vehicles (
  id uuid pk, nickname text not null,
  vin text, year int, make text, model text, trim text, engine text, fuel_type text,
  gvwr_lbs int, usdot_number text,
  plate text, plate_state char(2),
  ownership text not null default 'company_owned', -- company_owned|leased|tech_owned
  assigned_user_id uuid references users(id),
  tank_gal numeric(6,2),
  status text not null default 'active',     -- active|in_shop|retired
  decoded jsonb,                              -- vPIC response subset
  odometer_cached int, avg_daily_miles numeric(8,2),
  open_recalls jsonb not null default '[]',
  custom jsonb not null default '{}',
  …ts, deleted_at timestamptz
);

create table odometer_readings (
  id uuid pk, vehicle_id uuid not null references vehicles(id),
  value int not null, unit text not null default 'mi',
  source text not null,                       -- manual|photo|service|fuel|clock
  photo_media_id uuid, ai_value int, ai_confidence real,
  recorded_by uuid references users(id), recorded_at timestamptz not null,
  approval_status text not null default 'pending', -- pending|approved|rejected
  flags text[] not null default '{}', client_id uuid unique,
  created_at timestamptz not null default now()
);
create index odometer_vehicle_idx on odometer_readings (vehicle_id, recorded_at desc);

create table fuel_logs (
  id uuid pk, vehicle_id uuid not null references vehicles(id), user_id uuid references users(id),
  gallons numeric(8,3) not null, total_cents bigint not null,
  odometer_reading_id uuid, receipt_media_id uuid, part_purchase_id uuid,
  filled_at timestamptz not null,
  approval_status text not null default 'pending', flags text[] not null default '{}',
  client_id uuid unique, created_at timestamptz not null default now()
);

create table service_records (
  id uuid pk, vehicle_id uuid not null references vehicles(id),
  tasks text[] not null,                      -- oil_change|tire_rotation|brakes|inspection|custom:<x>
  performed_on date not null, odometer int,
  vendor text, cost_cents bigint, paid_by text not null default 'company', -- company|tech
  receipt_media_id uuid, part_purchase_id uuid,
  ai_extract jsonb, notes text,
  approval_status text not null default 'pending',
  created_by uuid references users(id), created_at timestamptz not null default now()
);

create table vehicle_reminder_rules (
  id uuid pk, vehicle_id uuid not null references vehicles(id),
  task text not null,                         -- matches service_records.tasks / document kinds
  interval_miles int, interval_days int, due_soon_miles int, due_soon_days int,
  last_done_on date, last_done_odometer int,
  next_due_on date, next_due_miles int,       -- forecast
  status text not null default 'ok',          -- ok|due_soon|overdue
  active boolean not null default true, …ts,
  unique (vehicle_id, task)
);

create table vehicle_documents (
  id uuid pk, vehicle_id uuid not null references vehicles(id),
  kind text not null,                         -- registration|insurance|inspection|lease|title|other
  media_id uuid not null, expires_on date,
  approval_status text not null default 'pending', notes text,
  created_by uuid references users(id), created_at timestamptz not null default now()
);

create table inspections (
  id uuid pk, vehicle_id uuid not null references vehicles(id), user_id uuid references users(id),
  results jsonb not null, passed boolean not null, media_ids uuid[] not null default '{}',
  approval_status text not null default 'pending', -- policies.inspection (seed: auto)
  client_id uuid unique, created_at timestamptz not null default now()
);

create table vehicle_issues (
  id uuid pk, vehicle_id uuid not null references vehicles(id), reported_by uuid references users(id),
  description text not null, severity text not null, -- low|medium|high|unsafe
  can_drive boolean not null, media_ids uuid[] not null default '{}',
  status text not null default 'open',        -- open|acknowledged|in_repair|resolved
  acknowledged_at timestamptz, acknowledged_by uuid, resolved_at timestamptz, resolution text,
  created_at timestamptz not null default now()
);

create table trips (                           -- IRS-style daily log
  id uuid pk, user_id uuid not null references users(id), vehicle_id uuid references vehicles(id),
  trip_date date not null, start_odometer int, end_odometer int, miles numeric(8,1) not null,
  destinations jsonb not null default '[]',   -- [{job_id, address_short}]
  purpose text, classification text not null default 'business', -- business|commute|personal
  reimbursable boolean not null default false, ledger_entry_id uuid,
  approval_status text not null default 'pending',
  created_at timestamptz not null default now(),
  unique (user_id, trip_date, vehicle_id)
);

create table approvals (                       -- generic review queue (UI: /approvals)
  id uuid pk, entity_type text not null, entity_id uuid not null,
    -- odometer|fuel|service|document|inspection|trip|part_purchase|job_cancel|job_start|settlement_flag
  policy text not null,                        -- auto|auto_if_evidence|always_review
  status text not null default 'pending',     -- pending|approved|rejected
  requested_by uuid references users(id), reviewer_id uuid references users(id),
  decided_at timestamptz, reason text, evidence jsonb, -- extracted vs typed values
  created_at timestamptz not null default now()
);
create index approvals_pending_idx on approvals (entity_type, created_at) where status = 'pending';

create table ai_tasks (                        -- queue + cache
  id uuid pk, kind text not null,             -- odometer|receipt|shop_invoice|tool_label|maintenance_suggest|explain_flags
  input_hash text not null,                   -- sha256(images+prompt version)
  media_ids uuid[] not null default '{}',
  status text not null default 'queued',      -- queued|running|done|failed|skipped_budget|skipped_policy
  model text, output jsonb, error text, attempts int not null default 0,
  run_after timestamptz not null default now(),
  created_at timestamptz not null default now(), completed_at timestamptz,
  unique (kind, input_hash)
);

create table ai_usage (day date primary key, requests int not null default 0);
```

### 6.12 Tools
```sql
create table tools (
  id uuid pk, name text not null, category text, brand text, model text,
  serial text, asset_tag text unique,
  purchase_date date, purchase_cost_cents bigint, replacement_cost_cents bigint,
  owner text not null default 'company',      -- company|tech_owned
  owner_user_id uuid references users(id),
  status text not null default 'available',   -- available|assigned|in_repair|lost|stolen|retired
  condition text not null default 'good',     -- new|good|fair|poor
  calibration_due_on date,
  maintenance_interval_days int, maintenance_task text,
  last_maintained_on date, next_maintenance_on date,   -- derived on log
  kit_id uuid, current_user_id uuid references users(id), current_vehicle_id uuid,
  notes text, custom jsonb not null default '{}',
  …ts, deleted_at timestamptz
);
create index tools_current_user_idx on tools (current_user_id);

create table tool_kits (id uuid pk, name text not null, vehicle_id uuid, user_id uuid, …ts);

create table tool_assignments (
  id uuid pk, tool_id uuid not null references tools(id),
  user_id uuid references users(id), vehicle_id uuid,
  checked_out_at timestamptz not null default now(), checked_in_at timestamptz,
  out_condition text, in_condition text, out_media_id uuid, in_media_id uuid,
  acknowledged_at timestamptz, by_user_id uuid references users(id)
);
create index tool_assign_tool_idx on tool_assignments (tool_id, checked_out_at desc);

create table tool_audits (
  id uuid pk, user_id uuid not null references users(id), due_on date not null,
  status text not null default 'scheduled',   -- scheduled|in_progress|submitted|reviewed
  submitted_at timestamptz, reviewed_by uuid, reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table tool_audit_items (
  id uuid pk, audit_id uuid not null references tool_audits(id) on delete cascade,
  tool_id uuid not null references tools(id),
  present boolean, condition text, media_id uuid, note text
);

create table tool_incidents (
  id uuid pk, tool_id uuid not null references tools(id), user_id uuid references users(id),
  kind text not null,                          -- lost|stolen|damaged
  description text, media_ids uuid[] not null default '{}', police_report_no text,
  decision text,                               -- write_off|repair|tech_responsibility
  decided_by uuid, decided_at timestamptz, deduction_ledger_entry_id uuid,
  created_at timestamptz not null default now()
);

create table tool_maintenance_logs (
  id uuid pk, tool_id uuid not null references tools(id),
  task text not null, performed_on date not null,
  performed_by_user_id uuid references users(id), vendor text,
  cost_cents bigint, paid_by text not null default 'company', -- company|tech (tech -> part_purchases category 'tool')
  part_purchase_id uuid, media_id uuid, notes text,
  client_id uuid unique, created_at timestamptz not null default now()
);
create index tool_maint_tool_idx on tool_maintenance_logs (tool_id, performed_on desc);
```

### 6.13 Location, activity, audit, system
```sql
create table tech_locations (                  -- last known (upsert)
  user_id uuid primary key references users(id),
  lat double precision not null, lng double precision not null, accuracy_m real,
  heading real, speed real, source text not null, -- ping|status
  job_id uuid, recorded_at timestamptz not null
);

create table location_breadcrumbs (            -- optional, pruned daily
  id bigint generated always as identity primary key,
  user_id uuid not null, lat double precision not null, lng double precision not null,
  accuracy_m real, recorded_at timestamptz not null
);
create index breadcrumbs_user_idx on location_breadcrumbs (user_id, recorded_at);

create table activity (                        -- human timeline
  id bigint generated always as identity primary key,
  entity_type text not null, entity_id uuid not null,
  customer_id uuid, job_id uuid,
  kind text not null,                           -- event type
  summary text not null, data jsonb,
  actor_user_id uuid, created_at timestamptz not null default now()
);
create index activity_customer_idx on activity (customer_id, created_at desc);
create index activity_job_idx on activity (job_id, created_at desc);
create index activity_entity_idx on activity (entity_type, entity_id, created_at desc);

create table audit_log (                       -- append-only
  id bigint generated always as identity primary key,
  actor_user_id uuid, actor_kind text not null, -- user|system|api|webhook|public_token
  action text not null,                          -- 'invoice.revised', 'customer.viewed', 'perm.changed', …
  entity_type text, entity_id uuid,
  before jsonb, after jsonb,
  ip text, user_agent text, created_at timestamptz not null default now()
);
create index audit_entity_idx on audit_log (entity_type, entity_id, created_at desc);
create index audit_actor_idx on audit_log (actor_user_id, created_at desc);

create table job_queue (                       -- background tasks
  id bigint generated always as identity primary key,
  kind text not null,                           -- email|ai|pdf|evidence_pack|export|backup|geocode|vin|recalls|push
  payload jsonb not null, dedupe_key text unique,
  run_at timestamptz not null default now(),
  status text not null default 'queued',        -- queued|running|done|failed|dead
  attempts int not null default 0, max_attempts int not null default 5,
  locked_at timestamptz, last_error text,
  created_at timestamptz not null default now(), finished_at timestamptz
);
create index job_queue_due_idx on job_queue (run_at) where status = 'queued';
-- worker: SELECT … FOR UPDATE SKIP LOCKED LIMIT 10

create table scheduler_state (key text primary key, last_run_at timestamptz, data jsonb);

create table tasks (                           -- shared to-do list (M22)
  id uuid pk,
  kind text not null,       -- lead_retry|warranty_claim|restock|callback_customer|refund_due|follow_up|custom
  title text not null, body text, payload jsonb,
  assignee_user_id uuid references users(id),
  entity_type text, entity_id uuid, customer_id uuid, job_id uuid,
  due_at timestamptz,
  status text not null default 'open',         -- open|done|dismissed
  done_at timestamptz, done_by uuid references users(id),
  created_by uuid references users(id), …ts
);
create index tasks_assignee_idx on tasks (assignee_user_id, due_at) where status = 'open';
create index tasks_entity_idx on tasks (entity_type, entity_id);

create table action_receipts (                 -- idempotency for offline-replayed actions
  client_id uuid primary key, user_id uuid not null, action text not null,
  result jsonb not null, created_at timestamptz not null default now()
);                                             -- pruned after 30 days

create table rate_limits (
  key text not null, window_start timestamptz not null, count int not null default 0,
  primary key (key, window_start)
);

create table exports (
  id uuid pk, kind text not null,               -- full|csv|backup|nacha|report
  status text not null default 'queued', storage_key text,
  requested_by uuid references users(id), params jsonb,
  created_at timestamptz not null default now(), completed_at timestamptz, expires_at timestamptz
);
```

### 6.14 Relationship summary
- `customers 1─* properties`, `customers 1─* jobs`, `customers 1─* leads/estimates/invoices/payments/messages/consent_events`.
- `jobs 1─* job_assignments *─1 users`; `jobs 1─* job_status_events`; `jobs 1─1 job_financials`; `jobs 1─* job_earnings`; `jobs 1─* media`; `jobs 1─* invoices` (usually 1); `jobs 0..1─ estimates`; `jobs 1─* change_orders`; `jobs 0..1─1 review_requests`; `jobs ─ jobs` (`callback_of_job_id`).
- `estimates 1─* estimate_options 1─* line_items`; `invoices 1─* line_items`; `invoices 1─* payments 1─* refunds`; `payments 0..1─1 disputes`.
- `users 1─* ledger_entries *─1 settlements *─1 pay_periods`; `settlements *─* payouts` via `payout_settlements`.
- `vehicles 1─* odometer_readings/fuel_logs/service_records/vehicle_documents/inspections/vehicle_issues/vehicle_reminder_rules`.
- `tools 1─* tool_assignments/tool_incidents/tool_maintenance_logs`; `tool_audits 1─* tool_audit_items`.
- `users 1─* tasks` (assignee); `tasks` link polymorphically to any entity.
- Polymorphic links (`entity_type`, `entity_id`) on `media`, `notes`, `activity`, `audit_log`, `entity_tags`, `approvals` and `public_tokens` are validated in the DAL. Allowed entity types are listed in `src/db/enums.ts`.

---

## 7. Domain events, automation catalog, template variables

### 7.1 Event catalog

Events are emitted with `emit(tx, type, entity, payload)` inside the mutating transaction. Every payload includes `{ id, at, actor_user_id|null }` plus the fields listed below. Payload types live in `src/lib/events.ts` (a discriminated union), so adding an event is a type error until it is handled or explicitly ignored.

| Event | Payload (beyond base) | Default consumers |
|---|---|---|
| `lead.created` | lead_id, source_id, customer_id?, service, is_returning, sms_consent | ack automation, staff push, SLA timer |
| `lead.touched` | lead_id, raw_event_id | push to assignee |
| `lead.responded` | lead_id, user_id, channel, response_seconds | cancel escalations |
| `lead.sla_breached` | lead_id, minutes (5, 15) | escalation push |
| `lead.status_changed` | lead_id, from, to, lost_reason? | — |
| `lead.converted` | lead_id, job_id?, estimate_id? | — |
| `customer.created` / `customer.updated` / `customer.merged` | customer_id, (merged_from) | — |
| `consent.changed` | customer_id, channel, purpose, action, source | suppress queue, opt-out confirmation |
| `job.created` | job_id, customer_id, service_type_id, priority | risk calc |
| `job.scheduled` | job_id, scheduled_start, window_start/end, assignees | booking confirmation, deposit check, reminders |
| `job.rescheduled` | job_id, old_start, new_start | reschedule text, recompute anchored sends |
| `job.assigned` | job_id, user_ids_added, user_ids_removed | tech push |
| `job.confirmed` | job_id, via (`portal`/`reply`/`manual`) | cancel unconfirmed flag |
| `job.reschedule_requested` | job_id, via, note | office alert |
| `job.en_route` | job_id, tech_id, eta_minutes, tracking_token | on-my-way text |
| `job.running_late` | job_id, tech_id, new_eta_minutes | running-late text |
| `job.arrived` | job_id, tech_id, distance_m | cancel on-my-way leftovers |
| `job.started` | job_id | — |
| `job.on_hold` | job_id, reason | — |
| `job.completed` | job_id, tech_ids, invoice_id | invoice text, review timer, 7-day check-in, financials, maintenance reminder |
| `job.closed` | job_id | — |
| `job.cancelled` | job_id, reason, after_arrival(bool) | cancel scheduled sends; post-cancel verification if after arrival; anomaly flag |
| `job.callback_created` | job_id, original_job_id, reason | recall policy, warranty claim task |
| `estimate.sent` | estimate_id, channel | follow-up sequence |
| `estimate.viewed` | estimate_id, token_id | push to creator |
| `estimate.approved` | estimate_id, option_id, signature_id, channel | cancel follow-ups, deposit request, push |
| `estimate.declined` | estimate_id, reason | cancel follow-ups |
| `estimate.expired` | estimate_id | close-out |
| `change_order.approved` | change_order_id, job_id, delta_cents | risk recompute |
| `invoice.issued` | invoice_id, total_cents, due_at | invoice text/email |
| `invoice.revised` | invoice_id, version, reason | anomaly |
| `invoice.overdue` | invoice_id, days_overdue | dunning (emitted by daily cron) |
| `invoice.paid` | invoice_id | cancel dunning, review eligibility |
| `deposit.required` | deposit_request_id, job_id, amount_cents | deposit request text |
| `deposit.paid` | deposit_request_id, payment_id | push office |
| `deposit.hold_expiring` | deposit_request_id, capture_before | admin alert |
| `payment.succeeded` | payment_id, invoice_id, method, amount_cents, collected_by | receipt (all methods), ledger, payment_status cache |
| `payment.failed` | payment_id, error | office alert |
| `payment.manual_unverified` | payment_id, age_days | office alert |
| `refund.created` / `refund.succeeded` / `refund.due` | refund_id, payment_id, amount_cents | customer notice, promised-refund alert |
| `dispute.created` | dispute_id, payment_id, category, due_by | admin push/email, holds, evidence build |
| `dispute.updated` / `dispute.closed` | dispute_id, status, outcome | clawback/release |
| `efw.created` | payment_id, amount_cents | refund suggestion |
| `review.requested` / `review.clicked` / `review.rated` | review_request_id, rating? | low-rating admin alert |
| `message.received` | message_id, customer_id, body | keyword handling, thread push |
| `message.failed` | message_id, error | office alert |
| `message.optout_detected` | message_id, customer_id, confidence | review prompt |
| `photo.uploaded` | media_id, job_id, tag | readiness recompute |
| `signature.captured` | signature_id, doc_type, doc_id | readiness/risk recompute |
| `part_purchase.submitted` / `.approved` / `.rejected` | part_purchase_id, paid_by, total_cents | approver push, tech push |
| `cash.over_limit` | user_id, held_cents, oldest_days | admin alert |
| `cash.remitted` / `cash.received` | remittance_id | — |
| `pay_period.closed` | pay_period_id | settlement drafts |
| `settlement.ready_for_review` / `.flagged` / `.approved` / `.paid` | settlement_id, user_id | tech/admin push |
| `comp_agreement.required` | user_id, plan_key, version | tech banner + push |
| `vehicle.log_submitted` | entity_type, entity_id, vehicle_id, approval_id? | approver push |
| `vehicle.reminder_due` | vehicle_id, task, status | assignee + admin push |
| `vehicle.document_expiring` | vehicle_document_id, days | admin push |
| `vehicle.issue_reported` | issue_id, severity | admin push (unsafe → also email) |
| `vehicle.anomaly` | vehicle_id, flags | admin digest |
| `tool.audit_due` / `tool.audit_submitted` / `tool.incident` | ids | push |
| `user.invited` / `user.deactivated` / `permission.changed` | ids | audit |
| `user.bank_changed` | user_id, last4 | payout hold, alert payout users + the tech |
| `invoice.voided` | invoice_id, reason | cancel dunning/review sends |
| `dispute.evidence_submitted` | dispute_id | cancel dispute countdown alerts |
| `payment.customer_flagged` | payment_id, customer_id, note? | admin alert, `callback_customer` task, anomaly report |
| `job.start_approval_requested` / `job.start_approved` / `job.start_denied` | job_id, approval_id | approver push / tech push |
| `job.cancel_review_requested` | job_id, approval_id | approver push |
| `job.return_visit_scheduled` | job_id, visit_count, window | booking confirmation (return visit) |
| `tool.maintenance_due` | tool_id, task, due_on | custodian push |
| `task.created` / `task.due` | task_id, assignee_user_id | assignee push |
| `cash.discrepancy_declared` | user_id, system_cents, declared_cents | admin alert |
| `reminder.due` | reminder_id | custom reminder delivery |
| `digest.daily` | date | ops digest |

### 7.2 Automation step semantics
- **`send_at`** = anchor time + delay (negative allowed). If that is already past at schedule time:
  - transactional sends go out immediately;
  - sends whose anchor has passed by more than the template's `expires_after_minutes` are skipped as `expired`.
- **Re-check at send time:**
  - feature flag
  - automation enabled
  - `cancel_on` (event already happened, e.g. `invoice.paid`)
  - entity still in a valid state (`job.status ∉ {cancelled}`)
  - consent / `do_not_text`
  - quiet hours (customer audience only)
  - frequency caps
- **Channel resolution for `customer_preferred`:**
  - `sms` if `sms_status ∈ {transactional, marketing}` (or unknown, for transactional purpose with a phone number);
  - otherwise `email` if an email exists;
  - otherwise skip, logging the reason.
- **Audiences** (full list in §M13):
  - `assigned_tech` = the job's primary assignee; `assigned_techs` = all assignees
  - `office` = users with `leads.receive_alerts` (for leads) or role `office`
  - `admins` = role `admin`
  - `perm:<key>` = every active user whose **effective** permission (§4.1) includes the key. Used for "approvers" (`perm:vehicles.log_approve`, `perm:parts.approve_reimbursement`, `perm:jobs.approve_start`, `perm:jobs.review_cancellations`).
  - `subject_user` = the user the entity belongs to (settlement, part purchase, cash remittance, task, tool incident reporter).
  - Shorthand in §7.3: "tech" = `assigned_tech`, "approvers" = the matching `perm:` audience.

### 7.3 Built-in automations (seeded; all editable)

| Key | Trigger → timing | Audience / channel | Template key | Cancel on |
|---|---|---|---|---|
| `lead_ack` | lead.created → 0, only while `lead.status = new` (phone-entered leads skip it) | customer / preferred (outside quiet hours allowed ≤ 5 min) | `lead.ack` | lead.responded |
| `lead_alert` | lead.created → 0 | office / push | `staff.new_lead` | — |
| `lead_escalate_5` | lead.created → +5 min, only while `lead.status = new` | admins / push | `staff.lead_sla` | lead.responded |
| `lead_escalate_15` | lead.created → +15 min, only while `lead.status = new` | all leads.receive_alerts / push | `staff.lead_sla` | lead.responded |
| `lead_not_reached` | lead.created → +1 h, next day 09:00, +3 d, only while `lead.status = new` | customer / sms | `lead.not_reached` | lead.converted, lead.status_changed→lost/spam, message.received |
| `booking_confirm` | job.scheduled → 0 | customer / preferred | `job.booked` (includes service-call fee & cancellation policy summary) | — |
| `tech_assigned` | job.assigned → 0 | tech / push | `staff.job_assigned` | — |
| `deposit_request` | deposit.required → 0, +24 h | customer / preferred | `deposit.request` | deposit.paid, job.cancelled |
| `reminder_24h` | anchor job.window_start → −24 h | customer / preferred | `job.reminder_24h` ("Reply C to confirm or R to reschedule" + portal link) | job.cancelled, job.rescheduled (re-created) |
| `unconfirmed_flag` | anchor job.window_start → day before 09:00 local | office / push+in_app | `staff.unconfirmed` | job.confirmed |
| `reminder_2h` | anchor job.window_start → −2 h | customer / sms | `job.reminder_2h` (adult home, pets secured) | job.cancelled, job.en_route |
| `on_my_way` | job.en_route → 0 | customer / sms (outbox owner = tech; quiet-hours bypass) | `job.on_my_way` | job.arrived |
| `running_late` | job.running_late → 0 | customer / sms | `job.running_late` | job.arrived |
| `late_prompt` | anchor job.window_end → −15 min | tech / push | `staff.late_prompt` | job.en_route, job.arrived |
| `job_completed_invoice` | job.completed → 0 | customer / preferred | `job.completed` (invoice link + photos) | invoice.paid |
| `payment_receipt` | payment.succeeded → 0 | customer / preferred (+email copy) | `payment.receipt` ("Wrong amount? Reply") | — |
| `dunning` | invoice.issued → +3 d, +7 d, +14 d (anchor due_at for non-receipt terms) | customer / preferred; admin digest | `invoice.reminder_1/2/3` | invoice.paid, dispute.created, invoice.voided |
| `estimate_followup` | estimate.sent → +2 h, +2 d, +5 d, +10 d | customer / preferred | `estimate.followup_1..4` | estimate.approved/declined, message.received |
| `estimate_closeout` | estimate.sent → +30 d | customer / preferred | `estimate.closeout` | same |
| `review_request` | job.completed → +90 min (requires payment_status=paid at send; else waits for invoice.paid + 60 min) | customer / sms first | `review.request` | review.clicked |
| `review_reminder` | review.requested → +3 d | customer / sms | `review.reminder` | review.clicked |
| `checkin_7d` | job.completed → +7 d 10:00 | customer / preferred | `job.checkin` | job.cancelled |
| `post_cancel_verify` | job.cancelled (after_arrival) → +2 h | customer / sms | `job.cancel_verify` ("Was your service completed today? Reply 1 yes / 2 no") | — |
| `maintenance` | job.completed → + service_type.maintenance_interval_months (retired: the interval is always null, so it never fires) | customer / sms+email (**marketing consent**) | `marketing.maintenance` | job.created for same customer & service |
| `refund_due` | refund.due → 0 | admins / push | `staff.refund_due` | refund.succeeded |
| `dispute_alert` | dispute.created → 0, due_by −3 d, −1 d | admins / push+email | `staff.dispute` | dispute.closed, dispute.evidence_submitted |
| `cash_over_limit` | cash.over_limit → 0 | admins + tech / push | `staff.cash_over_limit` | cash.received |
| `settlement_ready` | settlement.ready_for_review → 0 | tech / push | `staff.settlement_ready` | — |
| `vehicle_due` | vehicle.reminder_due → 0 | assignee + admins / push | `staff.vehicle_due` | — |
| `doc_expiring` | vehicle.document_expiring → 30/14/3 d | admins / push+email | `staff.doc_expiring` | — |
| `tool_audit_due` | tool.audit_due → 0, +2 d | tech / push | `staff.tool_audit_due` | tool.audit_submitted |
| `approval_needed` | vehicle.log_submitted / part_purchase.submitted / job.cancel_review_requested → 0 | approvers (`perm:` audience per entity) / push (batched 15 min) | `staff.approval_needed` | — |
| `start_approval` | job.start_approval_requested → 0 (not batched) | `perm:jobs.approve_start` / push | `staff.start_approval` | job.start_approved, job.start_denied |
| `start_decided` | job.start_approved / job.start_denied → 0 | assigned_tech / push | `staff.start_decided` | — |
| `reschedule_notice` | job.rescheduled → 0 | customer / preferred | `job.rescheduled` (new window + link) | job.cancelled |
| `return_visit_notice` | job.return_visit_scheduled → 0 | customer / preferred | `job.return_visit` | job.cancelled |
| `cancel_notice` | job.cancelled (not after_arrival) → 0 | customer / preferred | `job.cancelled` (cancellation-fee line if applied; deposit refund status) | — |
| `reschedule_request_alert` | job.reschedule_requested → 0 | office / push+in_app | `staff.reschedule_requested` | job.rescheduled |
| `tech_job_changed` | job.rescheduled / job.cancelled / job.assigned (removed) → 0 | assigned_techs (incl. removed) / push | `staff.job_changed` | — |
| `tech_daily_agenda` | fixed_time_local 07:00 on working days | role:tech with ≥ 1 job today / push | `staff.daily_agenda` | — |
| `estimate_viewed_staff` | estimate.viewed → 0 (first view only) | creator / push | `staff.estimate_viewed` | — |
| `estimate_approved_staff` | estimate.approved → 0 | creator + office / push | `staff.estimate_approved` | — |
| `invoice_sent` | invoice.issued → 0, only when **not** issued by job completion (avoids double send with `job_completed_invoice`) | customer / preferred | `invoice.sent` | invoice.paid |
| `deposit_paid_staff` | deposit.paid → 0 | office + assigned_tech / push | `staff.deposit_paid` | — |
| `hold_expiring` | deposit.hold_expiring → 0 | admins / push | `staff.hold_expiring` | deposit.paid (captured) |
| `refund_notice` | refund.succeeded → 0 | customer / preferred | `refund.issued` (amount, method, 5–10 day bank note; prevents "credit not processed" disputes) | — |
| `efw_alert` | efw.created → 0 | admins / push+email | `staff.efw` (with refund suggestion) | — |
| `payment_failed_alert` | payment.failed → 0 | office / push | `staff.payment_failed` | payment.succeeded |
| `manual_unverified_alert` | payment.manual_unverified (daily cron, age ≥ 3 d) | `perm:payments.verify_manual` / in_app | `staff.manual_unverified` | — |
| `receipt_flag_alert` | payment.customer_flagged → 0 | admins / push+email | `staff.receipt_flagged` | — |
| `low_rating_alert` | review.rated with rating ≤ 3 → 0 | admins / push | `staff.low_rating` | — |
| `message_failed_alert` | message.failed → 0 | office / in_app | `staff.message_failed` | — |
| `reimbursement_decided` | part_purchase.approved / .rejected → 0 | subject_user / push | `staff.reimbursement_decided` | — |
| `settlement_flagged` | settlement.flagged → 0 | `perm:payroll.manage` / push | `staff.settlement_flagged` | — |
| `payout_sent` | settlement.paid → 0 | subject_user / push+email | `staff.payout_sent` | — |
| `comp_agreement_required` | comp_agreement.required → 0, +2 d | subject_user / push | `staff.comp_agreement` | signature.captured (comp_agreement) |
| `bank_changed_alert` | user.bank_changed → 0 | `perm:payroll.payout` + subject_user / push+email | `staff.bank_changed` | — |
| `vehicle_issue_alert` | vehicle.issue_reported → 0 | admins / push (severity `unsafe` → also email) | `staff.vehicle_issue` | — |
| `tool_incident_alert` | tool.incident → 0 | `perm:tools.audit_review` / push | `staff.tool_incident` | — |
| `tool_maintenance_due` | tool.maintenance_due → 0 | subject_user (custodian) / push | `staff.tool_maintenance_due` | — |
| `cash_discrepancy` | cash.discrepancy_declared → 0 | `perm:cash.receive` / push | `staff.cash_discrepancy` | — |
| `task_due` | task.due → 0 | subject_user (assignee) / push | `staff.task_due` | — |
| `daily_digest` | digest.daily (07:30 local) | admin+office / email+push | `staff.daily_digest` | — |

**Notes on the catalog**
- `lead_ack` switches to template `lead.ack_after_hours` (includes the emergency line if `company.emergency_phone` is set) outside business hours.
- `booking_confirm` and `reminder_24h` also fire for each **return visit**.
- **Coverage by audience** (owner requirement "for customer, tech and admin"): customer = lead ack → booking → deposit → reminders → on my way/late → invoice/receipt → dunning → review → check-in → maintenance; tech = assignment/changes, daily agenda, late prompt, start approvals, reimbursements, settlement/payout, comp agreement, vehicle/tool due, tasks; admin/office = leads/SLA, approvals, disputes/EFW, cash, flagged receipts, low ratings, payment failures, vehicle issues, daily digest.
- Every template above (customer and staff) is seeded with editable default text in `/settings/templates`; staff templates default to push + in-app.

**Default template texts** (GSM-7, short; editable). Examples for the customer templates:
- `lead.ack`: `Hi {{customer.first_name|there}}, it's {{company.name}}. We got your {{lead.service}} request and will call you within {{company.lead_response_minutes}} min from {{company.phone}}. Reply STOP to opt out.`
- `job.booked`: `Booked: {{job.service}} on {{job.date_short}}, {{job.window}} at {{job.address_short}}. {{job.service_fee_line}} Details/reschedule: {{job.link}}`
- `job.reminder_24h`: `Reminder: {{company.name}} tomorrow {{job.window}}. Reply C to confirm or R to reschedule, or tap {{job.link}}`
- `job.reminder_2h`: `{{tech.first_name}} arrives {{job.window}} today. Please have an adult home and pets secured.`
- `job.on_my_way`: `{{tech.first_name}} from {{company.name}} is on the way, about {{eta_minutes}} min. Track: {{tracking.link}}`
- `job.completed`: `Thanks {{customer.first_name|}}! Your invoice for {{invoice.total}} with photos: {{invoice.link}}`
- `payment.receipt`: `{{company.name}}: received {{payment.amount}} by {{payment.method}} for job {{job.number}}{{payment.collected_by_line}}. Wrong amount? Reply or tap {{receipt.link}}`
- `invoice.reminder_1`: `Friendly reminder: {{invoice.balance}} is due for {{job.service}}. Pay: {{invoice.pay_link}}`
- `estimate.followup_1`: `Any questions on your {{estimate.total}} estimate? Approve or ask here: {{estimate.link}}`
- `review.request`: `Thanks for choosing {{company.name}} today. Would you share your experience? {{review.link}}`

### 7.4 Template variable catalog
The renderer is `render(template, ctx)`. Syntax: `{{path}}` or `{{path|fallback}}`. No logic, loops or helpers. Values are pre-formatted strings built by `buildContext(entity)` in `src/features/automations/context.ts`. Unknown paths render the fallback, or an empty string, and log a warning in the editor preview.

| Group | Variables |
|---|---|
| company | `company.name`, `company.phone`, `company.email`, `company.website`, `company.license`, `company.lead_response_minutes`, `company.address_short`, `company.review_link` (raw; use `review.link` in messages) |
| customer | `customer.first_name`, `customer.last_name`, `customer.display_name`, `customer.company_name` |
| lead | `lead.service`, `lead.preferred_date`, `lead.source` |
| job | `job.number`, `job.service`, `job.date_short` ("Tue Oct 14"), `job.date_long`, `job.window` ("1–2 PM"), `job.time`, `job.address_short` ("12 Oak St"), `job.address_full`, `job.link` (portal), `job.service_fee_line` ("Service call fee $89, credited if you approve the repair."), `job.status_label` |
| tech | `tech.first_name`, `tech.photo_url` (email only), `tech.license` |
| arrival | `eta_minutes`, `eta_time`, `tracking.link` |
| estimate | `estimate.number`, `estimate.total` (recommended/max option), `estimate.link`, `estimate.expires_date` |
| invoice | `invoice.number`, `invoice.total`, `invoice.balance`, `invoice.due_date`, `invoice.link`, `invoice.pay_link` |
| payment | `payment.amount`, `payment.method` ("cash", "Visa ••4242"), `payment.date`, `payment.collected_by_line` (" to Mike" for cash/check, else ""), `receipt.link` (`/i/{token}?receipt={payment_id}`, §M23) |
| deposit | `deposit.amount`, `deposit.link`, `deposit.policy_short` |
| review | `review.link` (always `/r/{token}`) |
| booking | `booking.link` (hosted form `/f/{publicKey}` for the default website source) |
| history | `last_job.service`, `last_job.date_short`, `months_since_last_job` |
| staff-only | `user.first_name`, `lead.sla_minutes`, `count`, `amount`, `vehicle.nickname`, `task`, `days`, `entity.url` |

Formatting uses `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })` and `Intl.DateTimeFormat` in the recipient's time zone.

---

## 8. API surface & server-action conventions

### 8.1 Route handlers (`src/app/api/**/route.ts`)

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /api/v1/leads` | `X-Site-Key: pk_…` (+ Origin allowlist) **or** `Authorization: Bearer sk_…` | JSON lead intake. Returns `201 {id, status:'created'\|'merged', customer_id}`, `400 {errors}`, `429`, or a fake `200` for spam |
| `OPTIONS /api/v1/leads` | — | CORS preflight: echo the allowed origin, `Vary: Origin`, `POST, OPTIONS`, no credentials |
| `POST /api/v1/leads/f/[publicKey]` | public key + honeypot/ts/Turnstile | Form-encoded intake. Responds `303` to a whitelisted `redirect` or the hosted thank-you page |
| `POST /api/v1/hooks/[preset]/[secret]` | secret in path (hashed compare) | Presets: `generic`, `zapier`, `make`, `thumbtack`, `angi`, `google_ads_leadform` (also verifies `google_key`; returns `200 {}`) |
| `POST /api/v1/inbound-email/[secret]` | path secret | (Later) parsed marketplace emails from a Cloudflare Email Worker |
| `GET /api/v1/leads/schema` | public | JSON Schema of accepted fields and aliases (for integrators) |
| `GET\|POST /api/cron/tick` | `Authorization: Bearer ${CRON_SECRET}` | Runs the scheduler (§3.1). Idempotent; protected by an advisory lock |
| `POST /api/webhooks/stripe` | Stripe signature (HMAC, 5-min tolerance) | Payments, refunds, disputes, EFW. Raw body; idempotent via `webhook_events` |
| `POST /api/webhooks/square` | (Later) | — |
| `POST /api/inbound/sms/[driver]` | driver `verifyWebhook` | (Later) inbound SMS and status callbacks |
| `POST /api/uploads/presign` | session + `photos.upload` (or a context perm) | Body `{files:[{name,mime,bytes,sha256,kind,tag}], entity}` → `[{upload_url, key, thumb_upload_url?, original_upload_url?}]`. Content-type allowlist: `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `application/pdf`. ≤ 15 MB |
| `POST /api/uploads/complete` | session | Body: metadata (§M11) → creates `media`, emits `photo.uploaded`. Idempotent on `client_id` |
| `POST /api/uploads/public/presign` | public token (estimate/ownership) | Customer-side uploads, e.g. ID photo during remote signing |
| `POST /api/location` | session + `location.share`, clocked in | `{lat,lng,accuracy,heading,speed,ts}` → upsert `tech_locations`. Rate-limited to 1 per 30 s per user |
| `POST /api/push/subscribe` / `DELETE` | session | Web Push subscription |
| `GET /api/export/[id]` | session + `data.export` | 302 to a signed download URL |
| `GET /api/health` | — | `{ok, db, version}` |
| `GET /embed.js` | — | Static and cached. Built file with `Cache-Control: public, max-age=3600` |
| `GET /sw.js` | — | Service worker. `Cache-Control: no-cache` |

**Public pages** (`(public)` group) are Server Components. They resolve tokens via `resolvePublicToken(kind, token)`, which checks the hash, expiry and revocation, increments use, and logs to `portal_access_log`. Mutations from public pages (sign, approve, confirm, rate) are Server Actions that **re-validate the token** and take no session.

### 8.2 Server-action conventions (MUST)
```ts
// src/features/jobs/actions.ts
'use server';
import { action } from '@/lib/action';
export const markEnRoute = action({
  perm: 'jobs.status_own',            // checked + row-scoped (assignee) in handler via assertJobAccess
  input: z.object({ jobId: z.uuid(), etaMinutes: z.number().int().min(5).max(240),
                    geo: GeoSchema.optional(), clientId: z.uuid(), clientTs: z.iso.datetime() }),
  feature: undefined,                 // or 'vehicles' etc.; rejects when flag off
  audit: 'job.en_route',              // writes audit_log with before/after when provided
  async run({ input, user, tx }) { /* domain logic; emit(tx,'job.en_route',…) */ return { ok: true }; },
  tags: ({ input }) => [`job:${input.jobId}`, `schedule`],   // updateTag after commit
});
```
- `action()` (in `src/lib/action.ts`):
  1. `requireUser(perm)`
  2. feature-flag check
  3. zod parse (errors → `{ ok:false, fieldErrors }`)
  4. **idempotency** on `clientId` (returns the stored result if seen; via an `action_receipts` row or the entity's `client_id unique`)
  5. a DB transaction around `run`
  6. `audit_log`
  7. `updateTag` per tag
  8. `after(processEvents)`
- **Return shape:** always `{ ok: true, data? } | { ok: false, error: string, fieldErrors?: Record<string,string[]> }`. Never throw to the client except on auth failure (redirect to `/login`).
- **Row-level access** lives in helper asserts (`assertJobAccess(user, jobId, 'write')`) inside `run`, not in the UI.
- **Forms** use `<form action={…}>` with `useActionState` for progressive enhancement. Offline-capable actions are called through `src/client/outbox.ts`, which queues them when offline and replays them with the same `clientId`.
- **Body limit:** 2 MB. Never send files through actions.
- **Read side:** `queries.ts` functions are `async` and call `requireUser()` first. Use `'use cache: private'` for user-scoped data, or unexported `'use cache'` functions keyed by `(userId|role, params)` with `cacheTag(...)` and `cacheLife({ stale: 30 })`. **No DB reads at build time**: every cached function takes a session-derived argument or sits behind `await connection()`.
- **Cache tags:** `job:{id}`, `jobs`, `schedule`, `customer:{id}`, `customers`, `leads`, `invoice:{id}`, `payments`, `settings`, `perm:{userId}`, `dashboard`, `outbox:{userId}`, `vehicles`, `tools`, `payroll:{userId}`.

### 8.3 Lead intake processing (normative order)
1. Body size ≤ 32 KB, then rate limit (`rate_limits` key `lead:{ip}:{key}`, 10/min; daily cap per source).
2. Authenticate the key or secret. Check `Origin`/`Referer` against `allowed_origins` for `pk_` keys.
3. Spam checks: honeypot, `_ts` HMAC age ≥ 3 s and ≤ 24 h (**only when `_ts` is present or `lead_sources.require_ts`**; a missing `_ts` on a plain-form source is not spam), Turnstile `siteverify` if required. On hard failure (honeypot filled, bad/too-fast `_ts`, Turnstile fail): store `status=spam` and return a fake success (`200` JSON, or `303` to the thank-you page for form posts). Soft signals only raise `spam_score` (§M04) and never drop the lead.
4. Map the payload: apply the preset mapping, then the source JSON-path mapping, then aliases. Validate with zod. Normalize phone (libphonenumber-js, default region US), email, price and date.
5. Idempotency: `(source_id, external_id)` → existing lead returns `200 {status:'merged'}`. A `dedupe_hash` within 10 min → merged.
6. Match the customer by phone, then email. If an open lead exists for the same customer + service within 14 days → add a `touch` event, `is_returning=true`, return merged. A manual entry where the office chose "Start a new one" (M04 Repeat callers) skips this touch and the step 5 hash, and still links the matched customer.
7. Insert the lead, `lead_events(received, raw)`, and `consent_events` if consented. Emit `lead.created`. Respond in < 300 ms (all other work happens in `after()`).

### 8.4 Stripe webhook handling
- Verify the signature, then insert into `webhook_events` (unique; a duplicate returns 200). Then handle:
  - `checkout.session.completed` / `payment_intent.succeeded` → upsert `payments`. Fetch the charge's `balance_transaction` for `fee_cents` (queued). Snapshot `payment_method_details.card` (brand, funding, last4, fingerprint, checks, 3DS, wallet). Emit `payment.succeeded`.
  - `payment_intent.amount_capturable_updated` → `authorized` with `capture_before`.
  - `charge.refunded` → refunds.
  - `charge.dispute.created|updated|closed|funds_withdrawn|funds_reinstated` → disputes. `radar.early_fraud_warning.created` → emit `efw.created`.
- Unknown types are stored and ignored. Always return 200 after storage; processing errors are retried by cron from `webhook_events where processed_at is null`.

### 8.5 Lead integration snippets (generated in `/settings/lead-sources` with the real key)

**Level 1: plain HTML form** (any static site, no JavaScript, works on GitHub Pages / Wix HTML block / old WordPress themes). Source `integration_kind = plain_form`, `require_ts = false`.
```html
<form method="post" action="https://crm.example.com/api/v1/leads/f/pk_live_ab12cd34">
  <input name="name" required placeholder="Full name">
  <input name="phone" type="tel" required placeholder="Phone">
  <input name="email" type="email" placeholder="Email">
  <input name="address" placeholder="Service address">
  <select name="service_type"><option>Lockout</option><option>Rekey</option><option>Other</option></select>
  <input name="price" placeholder="Quoted price (optional)">
  <input name="preferred_date" type="date">
  <textarea name="notes" placeholder="What do you need?"></textarea>
  <!-- honeypot: must stay empty; hidden from humans -->
  <input name="company_website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px">
  <label><input type="checkbox" name="sms_consent" value="yes"> I agree to receive text messages from ACME about my request,
    appointments and invoices. Msg frequency varies. Msg &amp; data rates may apply. Reply STOP to opt out, HELP for help.</label>
  <input type="hidden" name="redirect" value="https://acme.example/thanks.html">
  <button>Request service</button>
</form>
```
The endpoint answers `303` to `redirect` (if its origin is allowed) or to the hosted thank-you page. The consent box is unchecked and not `required`.

**Level 2: same form + snippet** (adds UTM/click-ID attribution, `_ts`, inline success, consent box if missing, Turnstile if enabled). Add `data-crm-lead` to the `<form>` and:
```html
<script src="https://crm.example.com/embed.js" data-key="pk_live_ab12cd34" defer></script>
```

**Level 3: JSON API** (server-to-server, Zapier/Make "Webhooks" step, or browser fetch with the public key):
```bash
curl -X POST https://crm.example.com/api/v1/leads \
  -H "Authorization: Bearer sk_live_…" -H "Content-Type: application/json" \
  -d '{"name":"Dana Lee","phone":"(555) 201-7788","address":"12 Oak St, Austin, TX 78701",
       "service_type":"Rekey","price":"$149","preferred_date":"2026-10-20","preferred_window":"morning",
       "notes":"3 locks","external_id":"site-4411","sms_consent":true}'
# 201 {"id":"…","status":"created","customer_id":"…"}  |  200 {"status":"merged"}  |  400 {"errors":{…}}
```
`GET /api/v1/leads/schema` returns the accepted fields and aliases. The test console in settings shows the last 20 payloads with the mapping result, so a non-technical owner can confirm a site is connected.

---

## 9. Adapter interfaces

All adapters live in `src/adapters/<concern>/` with `index.ts` (registry + `getX()` factory reading env/settings), `types.ts` (interface), and one file per driver. Drivers self-register: `registerSmsDriver('telnyx', () => import('./telnyx'))`. Every adapter file imports `server-only` except the client helpers noted.

### 9.1 Messaging (SMS / WhatsApp / email / push share one shape)
```ts
// src/adapters/messaging/types.ts
export type Channel = 'sms' | 'whatsapp' | 'email' | 'push';
export type Purpose = 'transactional' | 'marketing' | 'review' | 'internal';
export interface OutboundMessage {
  id: string;                 // scheduled_messages.id or messages.id
  to: string;                 // E.164 | email | user id (push)
  channel: Channel; purpose: Purpose;
  body: string; subject?: string; html?: string;
  mediaUrls?: string[]; expiresAt?: Date;
  meta?: Record<string, string>;   // job_id, customer_id for provider tagging
}
export type SendResult =
  | { status: 'sent'; providerId?: string }
  | { status: 'needs_human'; href: string }        // link drivers → outbox pending_tap
  | { status: 'failed'; error: string; retryable: boolean };
export interface InboundMessage { from: string; to?: string; body: string; media?: string[]; providerId?: string; receivedAt: Date }
export interface StatusUpdate { providerId: string; status: 'sent'|'delivered'|'failed'|'undelivered'; error?: string }
export interface MessagingDriver {
  name: 'link' | 'whatsapp_link' | 'console' | 'android_gateway' | 'twilio' | 'telnyx' | 'resend' | 'smtp' | 'webpush';
  channel: Channel;
  caps: { autoSend: boolean; inbound: boolean; mms: boolean; receipts: boolean };
  send(m: OutboundMessage): Promise<SendResult>;
  parseInbound?(req: Request): Promise<InboundMessage | null>;
  parseStatus?(req: Request): Promise<StatusUpdate | null>;
  verifyWebhook?(req: Request, rawBody: string): Promise<boolean>;
}
export type SmsProvider = MessagingDriver & { channel: 'sms' };
export type EmailProvider = MessagingDriver & { channel: 'email' };
```
- **Defaults:**
  - SMS: `link` (`send` returns `needs_human` with `smsHref(to, body)`, computed client-side for UA accuracy; the server stores body and recipient).
  - WhatsApp: `whatsapp_link`.
  - Email: `console` in dev, `resend` when `RESEND_API_KEY` is set (plain fetch to `https://api.resend.com/emails`).
  - Push: `webpush`.
- **Client helper** (`src/client/sms-href.ts`, not server-only):
  ```ts
  export function smsHref(e164: string, body: string, ua = navigator.userAgent, override?: '?'|'&'|'?&') {
    const sep = override ?? (/iPhone|iPad|iPod|Macintosh/.test(ua) ? '&' : '?');
    return `sms:${e164}${sep}body=${encodeURIComponent(body)}`;
  }
  export const waHref = (e164: string, body: string) => `https://wa.me/${e164.replace(/\D/g, '')}?text=${encodeURIComponent(body)}`;
  ```

### 9.2 Payments
```ts
// src/adapters/payments/types.ts
export type EntryMode = 'tap'|'chip'|'swipe'|'keyed'|'online'|'wallet'|'cash'|'check'|'p2p';
export interface PayLine { name: string; description?: string; amountCents: number; qty: number }
export interface PaymentSnapshot {
  ref: string; status: 'authorized'|'succeeded'|'failed'|'canceled';
  amountCents: number; tipCents?: number; feeCents?: number; entryMode: EntryMode;
  brand?: string; funding?: string; last4?: string; fingerprint?: string;
  avs?: string; cvc?: string; threeDS?: string; wallet?: string; ip?: string;
  captureBefore?: Date; capturedAt?: Date; raw?: unknown;
}
export interface RefundSnapshot { ref: string; status: 'pending'|'succeeded'|'failed'; amountCents: number }
export type NormalizedEvent =
  | { type: 'payment.succeeded'|'payment.authorized'|'payment.failed'|'payment.canceled'; payment: PaymentSnapshot; invoiceId?: string; depositRequestId?: string }
  | { type: 'refund.updated'; refund: RefundSnapshot; paymentRef: string }
  | { type: 'dispute.created'|'dispute.updated'|'dispute.closed'|'dispute.funds_withdrawn'|'dispute.funds_reinstated';
      dispute: { ref: string; paymentRef: string; category: string; networkCode?: string; amountCents: number; status: string; dueBy?: Date; outcome?: string } }
  | { type: 'efw.created'; paymentRef: string; amountCents: number; fraudType?: string };
export interface NormalizedEvidence {   // Stripe field names are canonical
  customer_name?: string; customer_email_address?: string; customer_purchase_ip?: string; billing_address?: string;
  product_description?: string; service_date?: string; cancellation_policy_disclosure?: string;
  cancellation_rebuttal?: string; refund_policy_disclosure?: string; refund_refusal_explanation?: string;
  duplicate_charge_id?: string; duplicate_charge_explanation?: string; uncategorized_text?: string;
  files?: Partial<Record<'customer_signature'|'service_documentation'|'customer_communication'|'receipt'|
    'refund_policy'|'cancellation_policy'|'duplicate_charge_documentation'|'access_activity_log'|'uncategorized_file',
    { bytes: Uint8Array; filename: string; mime: 'application/pdf'|'image/jpeg'|'image/png' }>>;
}
export interface PaymentProvider {
  id: 'stripe' | 'square' | 'manual';
  caps: { links: boolean; authHold: boolean; cardPresent: 'none'|'reader'|'app-switch';
          savedCards: boolean; ach: boolean; disputesApi: boolean; tips: boolean };
  createPayLink?(i: { invoiceId?: string; depositRequestId?: string; lines: PayLine[]; amountCents: number;
    customer: { name: string; email?: string; phone?: string };
    serviceAddress: { line1: string; city: string; state: string; postal_code: string };
    descriptorSuffix: string; mode: 'capture'|'hold'|'save'; require3DS?: boolean; allowTip?: boolean;
    successUrl: string; cancelUrl: string; expiresInMinutes: number; idempotencyKey: string;
    metadata: Record<string, string> }): Promise<{ url: string; ref: string; expiresAt: Date }>;
  startCardPresent?(i: { amountCents: number; invoiceId: string }): Promise<{ launchUrl?: string; ref: string }>;
  capture?(ref: string, amountCents?: number): Promise<PaymentSnapshot>;
  cancelHold?(ref: string): Promise<void>;
  chargeSaved?(customerRef: string, amountCents: number, idem: string): Promise<PaymentSnapshot>;
  refund(ref: string, amountCents: number, reason: string, idem: string): Promise<RefundSnapshot>;
  fetchFee?(ref: string): Promise<number>;
  verifyWebhook?(rawBody: string, headers: Headers): Promise<NormalizedEvent[]>;
  disputes?: { stage(disputeRef: string, ev: NormalizedEvidence): Promise<void>;
               submit(disputeRef: string): Promise<void>; accept(disputeRef: string): Promise<void> };
}
```
- **`manual` driver:** `refund` records the refund only, with no money movement and a note to pay back by the original method. No links. Snapshots come from the form input.
- **`stripe` driver:** ~250 LOC of `fetch` with `application/x-www-form-urlencoded` (a small `toForm()` handles nested keys), `Stripe-Version` pinned, and an `Idempotency-Key` header. No SDK.

### 9.3 Storage
```ts
export interface StorageProvider {
  id: 'local' | 's3';
  presignPut(key: string, mime: string, bytes: number, expiresSec?: number): Promise<{ url: string; headers: Record<string,string> }>;
  signedGetUrl(key: string, expiresSec?: number, downloadName?: string): Promise<string>;
  put(key: string, body: Uint8Array | ReadableStream, mime: string): Promise<void>;   // server-side writes (exports, PDFs)
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  head?(key: string): Promise<{ bytes: number; mime: string } | null>;
}
```
- **`local`:** files in `./.data/uploads`. `presignPut` returns an HMAC-signed URL served by `PUT /api/uploads/local/[...key]` (dev only).
- **`s3`:** `aws4fetch` `AwsClient.sign` with `signQuery: true` for presigned URLs.
- **Key layout:** `media/{yyyy}/{mm}/{uuid}.{ext}`, `media/.../{uuid}_thumb.webp`, `media/.../{uuid}_orig.{ext}`, `exports/…`, `backups/{date}/…`, `nacha/…`.

### 9.4 AI
```ts
export interface AiProvider {
  id: 'none' | 'gemini';
  tier: 'free' | 'paid';
  extract<T>(i: { schema: z.ZodType<T>; jsonSchema: object; prompt: string;
    images: { mime: string; base64: string }[]; kind: AiTaskKind }): Promise<{ data: T; model: string } | { error: string; retryable: boolean }>;
  text?(i: { prompt: string; kind: AiTaskKind }): Promise<{ text: string } | { error: string; retryable: boolean }>;
}
export type AiTaskKind = 'odometer'|'receipt'|'shop_invoice'|'tool_label'|'maintenance_suggest'|'explain_flags';
```
- **Policy layer** (`src/adapters/ai/policy.ts`, wraps every call):
  - `AI_TIER=free` allows only `odometer`, `receipt` (parts/fuel/vehicle/tool categories), `shop_invoice` (vehicle service invoices), `tool_label`, and the text kinds `maintenance_suggest` / `explain_flags` (prompt built from vehicle data only: VIN-decoded specs, mileage, service history; **no names, addresses or customer data**). Documents (registration/insurance) are refused (`skipped_policy`).
  - Daily budget from `ai_usage` (`AI_DAILY_BUDGET`, default 20); over budget → `skipped_budget`.
  - Cache by `input_hash`.
  - 429 → exponential backoff + jitter via `job_queue`.
  - Images downscaled to ≤ 1024 px on the client before upload of the AI copy (or server-side from the 1600 px derivative).
  - **Never blocks a workflow.** Results are always validated in code (sums, monotonic odometer, dates) and are only "suggestions" until approved.
- **Gemini driver:**
  - `POST https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL_OCR}:generateContent` with header `x-goog-api-key`.
  - Body: `generationConfig.responseMimeType='application/json'` and `responseSchema`. **Do not send** `temperature`/`top_p`/`top_k`.
  - Model ID pinned via env (default `gemini-3.5-flash-lite`).

### 9.5 Maps, geocoding, VIN
```ts
export interface MapProvider {              // client-side config only
  tileUrl: string; attribution: string; maxZoom: number;
}
export interface GeocodeProvider {
  id: 'census' | 'nominatim' | 'none';
  geocode(a: { street: string; city: string; state: string; zip: string }): Promise<{ lat: number; lng: number; matched: string } | null>;
}
export interface VinDecoder { decode(vin: string, modelYear?: number): Promise<VehicleDecoded | null>;
  recalls(make: string, model: string, year: number): Promise<Recall[]> }   // NHTSA vPIC + recalls API
```
- **`census`:** `https://geocoding.geo.census.gov/geocoder/locations/address?street=…&city=…&state=…&zip=…&benchmark=Public_AR_Current&format=json`. Free, US only. Calls run through `job_queue` (geocode on property save) with a 1 req/s throttle. Verify the endpoint during the build (not re-checked in research).
- **ZIP → time zone:** a static table (`src/lib/zip-tz.ts`, ZIP3 prefixes, ~4 KB, server-only).

### 9.6 Push & PDF
```ts
export interface PushProvider { send(sub: PushSubscriptionRow, payload: { title: string; body?: string; url?: string; tag?: string; badge?: number }): Promise<'ok'|'gone'|'retry'> }
export interface PdfRenderer {
  id: 'none' | 'pdflib' | 'chrome';
  render(i: { html?: string; url?: string; kind: 'evidence_pack'|'invoice'|'statement'; maxBytes?: number }): Promise<Uint8Array>;
}
```
`PdfRenderer` defaults to `none`, which means printable HTML only. The disputes UI then shows "Print → Save as PDF" plus a field copy panel.

### 9.7 Adding a provider (rule)
1. Create `src/adapters/<concern>/<name>.ts` implementing the interface.
2. Register it in `src/adapters/<concern>/index.ts`.
3. Add env vars to `.env.example` and the integrations settings schema.
4. Add a contract test in `tests/adapters/<concern>.<name>.test.ts` using recorded fixtures.

No feature code changes are needed.

---

## 10. Commission & settlement engine

All of it lives in `src/features/payroll/engine/` as **pure functions** with no DB access. Golden tests cover every worked example in §10.4. The engine runs on integer cents and bps. `roundHalfAway(x)` is applied at each line.

### 10.1 Plan config (zod: `CompPlanSchema`, stored in `comp_plans.config`)
```ts
type CompPlan = {
  basis: 'revenue' | 'net_after_deductions' | 'gross_profit' | 'flat_per_job' | 'hourly' | 'hourly_plus_commission';
  rate_bps: number;                                  // 2500 = 25%
  flat_per_job_cents?: number; hourly_cents?: number;
  tiers?: { period_revenue_gte_cents: number; rate_bps: number; mode: 'marginal' | 'retro' }[];
  overrides: { by_service_type?: Record<string, number> };   // service_type_id -> bps (tech-level overrides live in tech_comp)
  deductions_before_split: {                          // applied in this order
    company_parts: boolean;                           // default true
    tech_parts: boolean;                              // default true
    processing_fees: 'none' | 'actual' | { pct_bps_by_method: Partial<Record<PaymentMethod, number>> }; // default 'actual'
    lead_cost: boolean;                               // default false (source_cost_cents)
    subcontract_cost: boolean;                        // default false
  };
  fee_methods: PaymentMethod[];                       // methods whose fee is deducted; default ['card','ach','venmo'] (Zelle/cash/check fee = 0)
  tips: { pct_to_tech_bps: 10000; deduct_card_fee_on_tip: false };   // ⚖️ keep false (CA)
  tech_parts_reimburse_bps: 10000;
  cash: { tech_keeps_cash: boolean; settlement: 'net_in_payout' | 'separate_remittance';
          max_cash_held_cents: 150000; remit_within_days: 3;
          methods: ('cash'|'check')[] };   // methods NETTED against pay; default ['cash'] (checks are payable to the
                                           // company and always remitted). tech_keeps_cash=false forces 'separate_remittance'.
                                           // Per-tech overrides: tech_comp.overrides.tech_keeps_cash / cash_settlement.
  deposits: { counts_toward_revenue: true; forfeited_deposit_commission_bps: 0 };
  recalls: { window_days: 30; policy: 'none' | 'no_commission_on_recall' | 'clawback_pct'; clawback_bps?: number };   // ⚖️
  chargebacks: { window_days: 120; on_open: 'none' | 'hold'; on_lost: 'none' | 'clawback_100' | 'clawback_pct';
                 clawback_bps?: number; dispute_fee_to_tech: false };
  spiffs: { match: { service_type_id?: string; pricebook_item_id?: string; kind?: 'review_bonus' };
            amount: { flat_cents?: number; pct_bps?: number }; credit: 'sold_by' | 'worked_by' }[];
  splits: { default: 'primary_100' | 'even' };      // splits apply to commission + spiffs + tips, never to reimbursements/cash
  earned_on: 'job_done' | 'paid_in_full';            // default 'paid_in_full'
  guarantee?: { daily_min_cents: number; recoverable_draw: boolean };
  negative_balance: 'carry_forward' | 'request_remittance';
  max_deduction_per_period_bps?: number;             // ⚖️ cap on deductions taken from a period
  w2_floor_check: boolean;                           // auto true when worker_type = w2
  min_wage_cents_per_hour: number;                   // admin-editable (state/local)
};
```
**Seeded default plan `partner_25` v1** (the owner's model):
- `basis: 'net_after_deductions'`, `rate_bps: 2500`
- Company parts, tech parts and actual processing fees are deducted. Tips are 100% to the tech.
- `tech_keeps_cash: true`. `settlement: 'net_in_payout'` (it is forced to `separate_remittance` for W-2 techs).
- `earned_on: 'paid_in_full'`, `negative_balance: 'carry_forward'`
- `chargebacks.on_open: 'hold'`, `on_lost: 'clawback_100'`
- `recalls.policy: 'no_commission_on_recall'`

### 10.2 Inputs and pipeline
`computeJob(fin: JobFinancialInputs, plan: CompPlan, techs: TechInput[]) → JobResult`.

**Inputs** (gathered by `loadJobFinancialInputs(jobId)`):
- `revenue` = Σ invoice line `total_cents` for non-tax lines, minus discount lines. Excludes tax and tips. Includes service-fee lines. A deposit is a payment, not extra revenue.
- `tax`, `tip` = Σ `payments.tip_cents` (succeeded, net of refunds).
- `company_parts` = Σ(qty × unit_cost) for part/material lines with `part_source ∈ {company_stock, company_po}`.
- `tech_parts_by_user` = Σ approved `part_purchases.total_cents` where `paid_by='tech'` and `job_id = job`, grouped by `purchaser_user_id`. If any are pending at compute time, `trace.pending_reimbursements` is set and the job recomputes on approval.
- `fees`:
  - `'actual'`: for each succeeded payment whose method ∈ `fee_methods`, `fee_on_base = round(fee_cents × amount/(amount+tip))` and `fee_on_tip = fee_cents − fee_on_base`.
  - Configured: `fee_on_base = round(amount × pct_bps/10000)` and `fee_on_tip = round(tip × pct_bps/10000)`.
- `cash_by_user` = Σ `amount + tip` of succeeded payments with method ∈ `cash.methods`, grouped by `collected_by_user_id`.
- `lead_cost`, `subcontract_cost` if enabled.
- `is_callback`, `callback_of`, `service_type_id`, `assignees[{user_id, split_bps, role}]`.

**Pipeline** (each step appends `{step, label, amount_cents, running_cents}` to `trace`):
1. `R = revenue`
2. `D = Σ enabled deductions`, applied in order: company_parts, tech_parts (total), fees_on_base, lead_cost, subcontract_cost
3. `base = max(0, R − D)` (for `revenue` basis, `base = R`; for `gross_profit`, also subtract the labor cost recorded on lines)
4. **Rate resolution** (snapshotted): job custom rate (`jobs.custom_rate_bps`, set with `jobs.set_custom_rate`) → `tech_comp.overrides.by_service_type[svc]` → `tech_comp.overrides.rate_bps` → `plan.overrides.by_service_type[svc]` → role default (settings) → `plan.rate_bps`. Tiers adjust at settlement (§10.3).
5. **Recall rule:** if `is_callback` and policy = `no_commission_on_recall`, the rate = 0. For `clawback_pct`, post a `recall_clawback` against the **original** job's tech: `−round(original_commission × bps)`, `needs_review` for W-2.
6. `commission_total = roundHalfAway(base × rate_bps / 10000)`. For `flat_per_job`, it is the flat amount. Hourly bases come from time entries at settlement.
7. `spiffs_total` from matching rules.
8. **Split:** for each assignee `share = round(x × split_bps/10000)`. The **last** assignee absorbs the rounding remainder, applied separately to commission, spiffs and tips.
9. `tip_share = split(tip × pct_to_tech_bps/10000)`. If `deduct_card_fee_on_tip`, subtract `fee_on_tip` first (blocked for W-2).
10. `reimbursement_u = round(tech_parts_by_user[u] × tech_parts_reimburse_bps/10000)`. The money goes to the **purchaser**, not by split.
11. `cash_held_u = cash_by_user[u]` (only if the **effective** `tech_keeps_cash` for that tech is true: `tech_comp.overrides` first, then the plan). `settlement` is likewise resolved per tech (W-2 always `separate_remittance`).
12. `net_u = commission_u + spiffs_u + tip_u + reimbursement_u − (settlement === 'net_in_payout' ? cash_held_u : 0)`
13. `company_net = R + tip − fees_total − company_parts − Σ reimbursements − Σ commission − Σ spiffs − Σ tip_shares − lead_cost − subcontract_cost`

**Ledger posting.** This happens when earned (`job_done` → on `job.completed`; `paid_in_full` → on `invoice.paid`, or immediately if already paid):
- Post `commission`, `spiff`, `tip`, `reimbursement_parts` (wage_class `reimbursement`) and `cash_held` (wage_class `custody`; for `separate_remittance` the line is informational, amount 0, and custody is tracked in `cash_remittances` balance).
- Every line carries `job_id`, `effective_date = completed_at::date` (company TZ) and a memo.
- **Recompute before lock:** reverse all prior unsettled entries for the job (`reverses_id`), then post the new ones. Locked jobs are never recomputed; changes become `adjustment` entries in the open period.
- **Chargebacks:**
  - `dispute.created` with `on_open: hold` → `chargeback_hold = −commission_u` (and spiffs) for each tech.
  - Won → `chargeback_release` (+).
  - Lost with `clawback_100` → `chargeback_release` (+hold) and `chargeback_clawback` (−commission_u). `needs_review = true` for W-2.
  - The dispute fee is **never** charged to the tech unless `dispute_fee_to_tech`.

### 10.3 Settlement
For each tech and each closed pay period:
- `opening_balance` = previous settlement's `closing_balance` when `negative_balance='carry_forward'` and it was negative (a positive balance is assumed paid out; any unpaid positive remainder is also carried).
- `period_net` = Σ unsettled ledger entries with `effective_date ≤ period.ends_on` (all entry types except `payout`).
- **Tiers** (if configured): compute period revenue (Σ revenue of the tech's earned jobs, split-weighted).
  - `retro`: post `adjustment` = Σ(base × (tier_rate − applied_rate)) on those jobs.
  - `marginal`: apply only above the threshold.
- **W-2 floor check** (`w2_floor_check`):
  - `hours` = Σ time_entries in the week.
  - `wages` = Σ commission + spiffs + tips(+ hourly) (wage_class `wage`).
  - If `wages < hours × min_wage`, post `guarantee_topup` for the difference.
  - `regular_rate = (wages + topup) / hours`.
  - `ot_topup = round(0.5 × regular_rate × max(0, hours − 40))` (weekly; daily-OT states are a Later setting).
- `closing_balance = opening + period_net`
- **Deduction cap:** if `max_deduction_per_period_bps` is set, any deduction beyond `cap × gross earnings` is deferred to the next period as `carry_forward`.
- **Status flow:** `draft` → (`tech_review`, 48 h) → `approved` → payout recorded (`payout` entry of −amount, linking `payout_settlements`) → `paid` → `locked`. On lock, the jobs' `job_financials.locked_settlement_id` and `jobs.settlement_locked_at` are set.
- **Negative closing balance** with `request_remittance` → push to the tech: "You owe $118.50 — remit by {date}", tracked as a `cash_remittances` request.

### 10.4 Worked examples (golden tests; 25% partner plan, card fee 3% configured, company absorbs fee on tips)

| Case | Inputs | Computation | Result |
|---|---|---|---|
| **A** card | subtotal $400.00, tip $20.00 (card charge $420.00), company parts $40.00, tech parts $25.00 | fee_on_base 3%×400 = 12.00, fee_on_tip 0.60; base = 400 − 40 − 25 − 12 = 323.00; commission = 80.75 | tech line **+125.75** (80.75 + 20 + 25); company_net = 420 − 12.60 − 40 − 25 − 80.75 − 20 = **241.65** |
| **B** cash kept | $300.00 cash, tech parts $30.00 | base 270.00; commission 67.50; +30 reimb | **−202.50** (97.50 − 300.00) |
| **C** override 50% | $250.00 card, tech parts $20.00, service type "after-hours lockout" override 5000 bps | base = 250 − 20 − 7.50 = 222.50; commission 111.25 | **+131.25** |
| **D** clawback | job 6 wks ago lost dispute: $600.00, parts $50.00, fee $18.00 | base 532.00; commission 133.00 | `chargeback_clawback` **−133.00** (plus release of hold if held) |
| **E** split + rounding | $333.33 card, no parts, fee 3% = 10.00, 2 techs 50/50, tip $5.01 | base 323.33; commission 80.83 (8083.25¢ → 8083¢); split: first = round(8083×5000/10000) = 4041.5 → 4042¢, last = 8083 − 4042 = 4041¢; tips 501¢ → 251¢ / 250¢ | tech1 +42.93, tech2 +42.91 |
| **F** weekly 1099 | A + B + C + D + prior carry −40.00 | 125.75 − 202.50 + 131.25 − 133.00 − 40.00 | **−118.50** → carry forward or remittance request |
| **G** same week W-2 | as F, `separate_remittance` | wages = 80.75 + 20 + 67.50 + 111.25 = **279.50**; reimbursements 75.00 (separate wage_class); $300 cash → remittance ledger (not netted); clawback posted `needs_review`; floor check with 45 h → min-wage top-up and OT top-up lines per §10.3 | export shows wages vs reimbursements separately |

Note on case F and holds: F counts D as a single −133.00 line, which holds when the plan's `chargebacks.on_open` is `none`, or when the dispute opened and was lost inside the same period (hold −133.00 + release +133.00 + clawback −133.00 = −133.00). With the seeded `on_open: 'hold'` and a dispute opened in an **earlier** period, that earlier settlement already carried the −133.00 hold, and in the loss period D nets to 0.00 (release +133.00, clawback −133.00), so the loss week's total would be −118.50 + 133.00 = +14.50. Golden tests MUST include both variants (F-same-period, F-hold-earlier).

Verification of the arithmetic (checked by the critic pass): A 400−40−25−12 = 323 × 25% = 80.75; company 420−12.60−40−25−80.75−20 = 241.65. B 300−30 = 270 × 25% = 67.50 + 30 − 300 = −202.50. C 250−20−7.50 = 222.50 × 50% = 111.25 + 20 = 131.25. D 600−50−18 = 532 × 25% = 133.00. E 333.33 × 3% = 10.00; 323.33 × 25% = 80.8325 → 80.83; 40.42 + 2.51 = 42.93 and 40.41 + 2.50 = 42.91. F 125.75 − 202.50 + 131.25 − 133.00 − 40.00 = −118.50. G 80.75 + 20 + 67.50 + 111.25 = 279.50; reimbursements 25 + 30 + 20 = 75.00.

Note on case E: rounding uses `roundHalfAway` per line. The first assignee gets `round(x × bps/10000)`, and the last gets `x − Σ others`, so the shares always sum exactly to the total.

### 10.5 Explainability
`trace` renders as "Why is my commission $80.75?" on the tech's job earnings row:
```
Job total (before tax & tip)      $400.00
− Company parts                    −$40.00
− Parts you bought                 −$25.00
− Card processing fee (3%)         −$12.00
= Commission base                  $323.00
× Your rate (25%, plan Partner 25 v1)
= Commission                        $80.75
+ Tip (100%)                        $20.00
+ Reimbursement for parts           $25.00
= Your earnings on this job        $125.75
```

---

## 11. Chargeback risk & readiness scores

### 11.1 Job Risk Score (pre-job)
`score = clamp(0, 100, Σ points of active signals)`. Weights and thresholds are admin-editable (`settings.risk.weights`, `settings.risk.bands`). The function is pure (`src/features/disputes/risk.ts`) and golden-tested. It is recomputed on `estimate.*`, `change_order.*`, `payment.*`, `job.scheduled/rescheduled` and `customer.updated`, and stored in `risk_assessments` with `jobs.risk_score/band`.

| Signal key | Condition | Pts |
|---|---|---|
| `keyed_card` | any payment or intended method on the job with `entry_mode = keyed` (MOTO, no CVC/AVS) | +25 |
| `payer_mismatch` | payer name (card or entered) ≠ customer name and ≠ site contact (normalized, token match) | +15 |
| `ticket_1000` / `ticket_3000` | ticket = max(approved estimate option, invoice total, quoted price) > $1,000 / > $3,000 (take higher only) | +15 / +25 |
| `no_signed_estimate` | no signed estimate/work authorization **and** ticket ≥ `settings.risk.no_estimate_min_ticket_cents` (default $250) | +30 |
| `overage_unsigned` | invoice total > signed total × (1 + `change_order_threshold_pct`) without a signed change order | +25 |
| `after_hours` | `after_hours` or priority `emergency` with premium line | +10 |
| `upsell` | any `is_upsell` line (⚖️ cooling-off applies) | +10 |
| `new_customer` / `unknown_source` | no prior completed job / lead source null or `other` | +10 / +5 |
| `avs_or_foreign` | AVS/ZIP check failed, or card country ≠ US | +15 |
| `prior_dispute` | `customer.dispute_history` or card fingerprint in any disputed payment | +40 |
| `complaint` | job tagged `complaint`, internal rating ≤ 2, or staff "customer unhappy" flag | +20 |
| `far_future_deposit` | deposit taken and `scheduled_start` > 30 days out | +5 |
| `strong_auth` | a succeeded payment with entry_mode tap/chip, or 3DS authenticated | −15 |
| `repeat_customer` | ≥ 2 prior paid, undisputed jobs | −10 |

> Deviation from research: `no_signed_estimate` is gated by a minimum ticket, so routine small service calls are not all forced into Medium. This is admin-editable.

**Bands → controls** (enforced by the job transition guards in M05 and the payment UI):

| Band | Score | Controls |
|---|---|---|
| Low | 0–24 | Standard flow |
| Medium | 25–49 | Signed estimate + min photo set (≥ 1 before, ≥ 1 after) before Complete |
| High | 50–74 | Medium controls + deposit or auth hold; card-present or 3DS link only (no keyed); completion signature required |
| Critical | ≥ 75 | High controls + admin approval to start, **or** prepayment, **or** cash/ACH only |

### 11.2 Readiness Score (post-job)
`readiness = round(100 × Σ earned / Σ applicable)`. An item that isn't applicable earns full credit (e.g. no change order was needed; a cash-only job gets the strong-auth item).

| Item | Weight | Earned when |
|---|---|---|
| Signed estimate with policies | 25 | signature on estimate/work auth with policy versions |
| Completion acknowledgment signed | 20 | `signatures.doc_type = completion` |
| Before/after photos | 15 | ≥ 2 before and ≥ 2 after (geo or server-time stamped) |
| Arrival & departure geostamps | 10 | `arrived` and `completed` status events with lat/lng |
| Change orders signed | 10 | every change order approved with a signature |
| Receipt delivered | 10 | a receipt message sent/sent_manual/delivered for each payment |
| Communications log | 5 | ≥ 1 logged customer message on the job |
| Strong auth | 5 | tap/chip/3DS, or AVS+CVC pass |

The ring color is red < 50, amber 50–79, green ≥ 80. Techs see the missing items in the Complete sheet.

When the `photos` or `before_after` flag is off (§M11), the photo item is not applicable (full credit) and every band control that asks for photos asks for the completion signature instead, so a company that doesn't use photos is never blocked.

---

## 12. iOS design system

### 12.1 Tokens (`src/app/globals.css`)
```css
@import "tailwindcss";
:root{color-scheme:light dark;
 --sys-blue:#0088FF;--sys-green:#34C759;--sys-red:#FF383C;--sys-orange:#FF8D28;--sys-yellow:#FFCC00;
 --sys-teal:#00C3D0;--sys-indigo:#6155F5;--sys-purple:#CB30E0;--sys-pink:#FF2D55;--sys-brown:#AC7F5E;--sys-gray:#8E8E93;
 --bg:#F2F2F7;--card:#FFFFFF;--card-2:#F2F2F7;--fill:rgb(120 120 128/.2);--fill-2:rgb(120 120 128/.12);
 --label:#000;--label-2:rgb(60 60 67/.6);--label-3:rgb(60 60 67/.3);--sep:rgb(60 60 67/.29);
 --bar:rgb(249 249 249/.78);--accent:var(--sys-blue);--accent-text:#0066E0;--on-accent:#fff;
 --shadow-card:0 1px 2px rgb(0 0 0/.04);--shadow-float:0 8px 32px rgb(0 0 0/.12),0 2px 8px rgb(0 0 0/.06);
 --scrim:rgb(0 0 0/.4);}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){
 --sys-blue:#0091FF;--sys-green:#30D158;--sys-red:#FF4245;--sys-orange:#FF9230;--sys-yellow:#FFD600;
 --sys-teal:#00D2E0;--sys-indigo:#6D7CFF;--sys-purple:#DB34F2;--sys-pink:#FF375F;--sys-brown:#B78A66;
 --bg:#000;--card:#1C1C1E;--card-2:#2C2C2E;--fill:rgb(120 120 128/.36);--fill-2:rgb(120 120 128/.24);
 --label:#FFF;--label-2:rgb(235 235 245/.6);--label-3:rgb(235 235 245/.3);--sep:rgb(84 84 88/.6);
 --bar:rgb(29 29 31/.72);--accent-text:#0091FF;--shadow-card:none;--shadow-float:0 8px 32px rgb(0 0 0/.5);--scrim:rgb(0 0 0/.6);}}
:root[data-theme=dark]{ /* same values as the dark block above (theme override) */ }
@theme inline{
 --color-accent:var(--accent);--color-success:var(--sys-green);--color-danger:var(--sys-red);--color-warning:var(--sys-orange);
 --color-bg:var(--bg);--color-card:var(--card);--color-card-2:var(--card-2);--color-fill:var(--fill);
 --color-label:var(--label);--color-label-2:var(--label-2);--color-label-3:var(--label-3);--color-sep:var(--sep);
 --font-sans:-apple-system,BlinkMacSystemFont,system-ui,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
 --font-rounded:ui-rounded,system-ui,sans-serif;
 --text-large-title:34px;--text-large-title--line-height:41px;--text-title1:28px;--text-title1--line-height:34px;
 --text-title2:22px;--text-title2--line-height:28px;--text-title3:20px;--text-title3--line-height:25px;
 --text-headline:17px;--text-headline--line-height:22px;--text-body:17px;--text-body--line-height:22px;
 --text-callout:16px;--text-callout--line-height:21px;--text-subhead:15px;--text-subhead--line-height:20px;
 --text-footnote:13px;--text-footnote--line-height:18px;--text-caption:12px;--text-caption--line-height:16px;
 --radius-control:10px;--radius-card:12px;--radius-tile:16px;--radius-sheet:28px;--radius-pill:9999px;
 --spacing:4px;          /* Tailwind scale = 4px grid: p-2=8, p-4=16, p-11=44 */
}
.material{background:var(--bar);-webkit-backdrop-filter:saturate(180%) blur(20px);backdrop-filter:saturate(180%) blur(20px)}
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){.material{background:var(--card)}}
.num{font-variant-numeric:tabular-nums}
```
- **Brand accent.** If the company sets a brand color, it overrides `--accent` and `--sys-blue` at runtime (a style tag in the root layout, server-rendered). `--accent-text` is auto-darkened until it reaches ≥ 4.5:1 on white. `systemBlue` (#0088FF/#0091FF) is the default. Never use the accent for small text on light backgrounds; use `--accent-text`.
- **Typography.** Use the system font stack (no webfont). Headline is 17/22 semibold; Large Title is 34/41 bold; inline nav title is 17/22 semibold. Money and numbers use `.num`.
- **Spacing.** A 4 px grid. Page side gutter is 16 px (20 px ≥ 744 px wide). Section gap is 35 px (iOS grouped spacing). Row min-height is 44 px. Hairline separators are inset 16 px (or 60 px when the row has an icon).
- **Radii.** Controls 10, cards/grouped lists 12, tiles 16, sheets 28 (top corners), pills full.
- **Materials.** `.material` only on the tab bar, nav bar, sheets and toasts. Do not use SVG "liquid glass" refraction.
- **Z-index scale.** content 0, sticky headers 10, nav/tab bar 40, sheet 50 (top layer via `<dialog>`), toast 60.
- **Dark mode** follows the system, with an override in Settings → Appearance (`data-theme`). The theme-color meta updates accordingly.

### 12.2 Motion tokens
```css
:root{
 --ease-spring:linear(0,.003 1%,.019 2.5%,.08 5.5%,.163 8.5%,.45 18%,.543 21.5%,.625 25%,.695 28.5%,.753 32%,.802 35.5%,.847 39.5%,.886 44%,.919 49%,.944 54.5%,.965 61%,.988 75.5%,1);
 --ease-spring-snappy:linear(0,.007 1.5%,.026 3%,.054 4.5%,.102 6.5%,.19 9.5%,.511 19.5%,.609 23%,.683 26%,.747 29%,.809 32.5%,.86 36%,.901 39.5%,.936 43.5%,.963 48%,.984 53%,.997 58.5%,1.006 72%,1);
 --ease-spring-bouncy:linear(0,.009 1.5%,.033 3%,.07 4.5%,.116 6%,.227 9%,.476 15%,.594 18%,.699 21%,.776 23.5%,.841 26%,.905 29%,.955 32%,.992 35%,1.031 40.5%,1.046 47.5%,1.004 77%,1);
 --dur-press:340ms;--dur-snappy:515ms;--dur-push:675ms;--dur-bouncy:730ms;
}
.pressable{transition:transform var(--dur-press) var(--ease-spring);-webkit-tap-highlight-color:transparent;touch-action:manipulation;user-select:none}
.pressable:active{transform:scale(.97);transition:transform 90ms ease-out}
::view-transition{pointer-events:none}
::view-transition-old(.push){animation:var(--dur-push) var(--ease-spring) both push-out}
::view-transition-new(.push){animation:var(--dur-push) var(--ease-spring) both push-in}
::view-transition-old(.pop){animation:var(--dur-push) var(--ease-spring) both pop-out;z-index:1}
::view-transition-new(.pop){animation:var(--dur-push) var(--ease-spring) both pop-in}
@keyframes push-out{to{translate:-30% 0;filter:brightness(.92)}} @keyframes push-in{from{translate:100% 0}}
@keyframes pop-out{to{translate:100% 0}} @keyframes pop-in{from{translate:-30% 0;filter:brightness(.92)}}
::view-transition-group(tabbar),::view-transition-new(tabbar){animation:none;z-index:100}
::view-transition-old(tabbar){display:none}
@media (prefers-reduced-motion:reduce){
 ::view-transition-old(*),::view-transition-new(*){animation:150ms ease both vt-fade!important}
 ::view-transition-old(*){animation-direction:reverse!important}
 .pressable:active{transform:none;opacity:.6}}
@keyframes vt-fade{from{opacity:0}}
```
```ts
// src/ui/motion/springs.ts — Apple WWDC23 conversion (mass 1)
export const ios = (d: number, b = 0) => ({ type: 'spring' as const, mass: 1,
  stiffness: (2 * Math.PI / d) ** 2, damping: (1 - b) * 4 * Math.PI / d });
export const spring = {
  press:  ios(0.25),        // buttons, rows
  snappy: ios(0.4, 0.15),   // toggles, segmented thumb, tab indicator
  smooth: ios(0.5),         // page push, list reorder
  sheet:  ios(0.45, 0.05),  // sheet detents
  bouncy: ios(0.5, 0.3),    // success check, FAB appear (max bounce 0.3)
};
// sheet release projection: projected = offset + (v/1000) * 0.998 / (1 - 0.998); dismiss if projected > 50% height
```
**Rules**
- CSS springs first. Motion `m` + `LazyMotion(domAnimation)` second. `domMax` is lazy-loaded on the first sheet open. Never import full `motion`.
- Wrap the app in `<MotionConfig reducedMotion="user">`.
- Add one passive `touchstart` listener on `document`, so `:active` fires on iOS.
- Push/pop: `<Link transitionTypes={['nav-forward']}>`, and in **each page** `<ViewTransition enter={{'nav-forward':'push','nav-back':'pop',default:'none'}} exit={…} default="none">`. Back buttons use `transitionTypes={['nav-back']}`. Browser back and swipe play no animation.
- Animate only `transform`, `opacity` and `filter`. Never animate layout properties in lists.
- Haptics: iOS has no `navigator.vibrate`. The optional hidden `<input type=checkbox switch>` trick sits behind `settings.ui.haptics_hack` (default off). Android uses `navigator.vibrate(10)` on toggles and success.

### 12.3 PWA & platform
- **`app/manifest.ts`:** `display: 'standalone'`, `start_url: '/today'`, `id: '/'`, theme/background colors, icons 192/512 + maskable, `apple-icon.png` 180.
- **Viewport:** `viewportFit: 'cover'`, `themeColor` light `#F2F2F7` / dark `#000000`. `appleWebApp: { capable: true, statusBarStyle: 'black-translucent' }`. Pad bars with `env(safe-area-inset-*)`.
- **Inputs** ≥ 16 px (17 px body), so iOS doesn't zoom. Use `100dvh`. Set `overscroll-behavior: contain` on scrollers. Use `visualViewport` for keyboard-aware sheets.
- **`sw.js`** (hand-written, ~3 KB):
  - precaches the app shell and offline page;
  - uses network-first for navigations with an offline fallback;
  - handles `push` and `notificationclick`.
  - Served with `Cache-Control: no-cache` and a CSP.
  - No Workbox.
- Always render a visible back button. Standalone iOS PWAs may lack edge-swipe-back.

### 12.4 Layout patterns
- **LargeTitleHeader:** a 34 px title collapses into a 17 px inline nav title on scroll. Primary: CSS `animation-timeline: scroll()` with `animation-range: 0 52px`. Fallback: an IntersectionObserver sentinel sets `data-scrolled`. The bar gains `.material` and a hairline when scrolled.
- **Grouped list:** `--bg` page, `--card` sections, radius 12, rows ≥ 44 px, section header (13 px uppercase `--label-2`) and footer text.
- **Desktop (≥ 1024 px):**
  - A 260 px sidebar with grouped nav (sticky, `.material`).
  - Content max-width 1100 px (except schedule board and map at full width).
  - Sheets become centered modals (max 560 px) or right-side panels for detail views.
  - The list–detail split view on Customers/Jobs/Leads uses a 360 px list column.

### 12.5 Print styles (invoices, receipts, estimates, statements, evidence pack)
`@page { size: Letter; margin: 12mm }`. Under `@media print`:
- hide app chrome;
- `thead { display: table-header-group }`;
- `tr, figure { break-inside: avoid }`;
- `print-color-adjust: exact`;
- 12 pt minimum;
- a 2-up photo grid with captions;
- no reliance on color (use bold or boxes);
- the evidence pack adds page-break-before on each section.

### 12.6 Component inventory (`src/ui/components/`)
Each is server-renderable unless marked (client).

| Component | Props / behavior |
|---|---|
| `Button` | `variant: 'filled'\|'tinted'\|'gray'\|'plain'\|'destructive'`, `size: 'sm'\|'md'\|'lg'(50px)`, `loading`, `icon`; `.pressable`; full-width option; min 44 px |
| `IconButton` | 44 px hit target, `label` (aria) |
| `ListGroup` / `ListSection` | `header`, `footer`, inset grouped card |
| `ListRow` | `icon` (rounded-square tinted), `title`, `subtitle`, `detail` (right, `--label-2`), `accessory: 'chevron'\|'check'\|'toggle'\|'badge'\|ReactNode`, `href` (Link with push transition), `destructive` |
| `SwipeActions` (client) | Row wrapper; CSS scroll-snap leading/trailing actions; actions duplicated in `ContextMenu` for a11y |
| `ContextMenu` (client) | Long-press 450 ms → `popover`; also right-click on desktop |
| `Sheet` (client) | `<dialog>.showModal()`; detents `['medium','large']` or custom; grabber (tap cycles); drag-to-dismiss with Motion (`domMax` lazy); confirm-on-dirty; one at a time; focus trap from dialog; Esc closes |
| `ActionSheet` (client) | iOS-style options list + Cancel; built on `Sheet` |
| `Alert` (client) | Centered modal with 1–2 actions (`<dialog>`) |
| `SegmentedControl` (client) | Radio group; sliding thumb via `translate` + `--ease-spring-snappy`; 2–5 segments |
| `Toggle` (client) | `appearance:none` switch 51×31, green on; label row integration |
| `Stepper` (client) | −/+ with tabular nums |
| `TextField` / `TextArea` / `Select` / `DateField` / `TimeField` / `MoneyField` / `PhoneField` | 17 px text; inline label or floating; error text; `MoneyField` parses to cents; `PhoneField` formats as you type (client, tiny formatter, no libphonenumber client-side) |
| `SearchField` | iOS search bar with cancel; debounced 200 ms |
| `LargeTitleHeader` | `title`, `subtitle`, `trailing` actions, `searchable` |
| `NavBar` | Inline title, back button (`nav-back` transition), trailing actions; `.material`; `viewTransitionName: 'tabbar'` group with tab bar |
| `TabBar` (client) | Floating capsule, ≤ 5 tabs, filled icons for active, badge (red only for critical counts), safe-area padding; never hides |
| `Sidebar` | Desktop nav with sections and badges |
| `Badge` | Count/dot; `tone` |
| `StatusPill` | Job/lead/invoice status colors (mapping in `src/ui/status.ts`) |
| `Chip` / `TagChip` | Filter chips; tag color |
| `Avatar` | Image or initials with deterministic color; size 24–64; status ring |
| `TechCard` | Photo, first name, license #, rating — used in portal and on-my-way page |
| `EmptyState` | Icon, title, message, primary action |
| `Skeleton` | Shimmer-free pulse (respects reduced motion); row/card/stat variants |
| `Toast` (client) | Top capsule `.material`, auto-dismiss 3 s, undo action; queue max 3 |
| `Banner` | Inline info/warn/error (offline, ⚖️ compliance warnings) |
| `StatCard` | Label, value (`.num`), delta vs previous (▲/▼ with color + sign; never color alone), sparkline slot, `href` |
| `Sparkline`, `BarChart`, `LineChart`, `DonutChart`, `ProgressRing` | Hand-rolled SVG in Server Components; `<title>` tooltips; tabular nums; colors from tokens; accessible `<desc>` + data table fallback |
| `ReadinessRing` / `RiskChip` | Specialized ring/chip with "why" sheet |
| `Timeline` | Activity feed with icons per kind, grouped by day |
| `MessageBubble` / `Composer` (client) | Thread UI; template picker; segment counter |
| `OutboxCard` (client) | Pending tap card with Send/Copy/Skip, expiry countdown |
| `SignaturePad` (client) | Canvas, pointer events, PNG export, clear; ~3 KB |
| `PhotoGrid` / `PhotoCompare` (client compare) | Thumbnails with tags, viewer, before/after slider |
| `CameraButton` (client) | File input capture, multi-shot, compression, queued upload progress |
| `MapView` (client, dynamic) | Leaflet wrapper; `markers`, `onSelect`; cleans up `map.remove()` |
| `CalendarDay` / `CalendarWeek` / `ScheduleBoard` (client) | Time grid, tech columns, drag to assign on desktop |
| `MoneyText` | Formats cents with `Intl`; negative in parentheses on statements |
| `KeyValueList` | Label/value rows for detail views |
| `ConfirmTyped` (client) | Type-to-confirm for bulk/dangerous actions |
| `FeatureGate` | Server component that renders children only when flag on + perm |
| `InstallPrompt` (client) | iOS instructions sheet / `beforeinstallprompt` |
| `OfflineBanner` (client) | Shows pending outbox count and sync state |

---

## 13. Navigation & information architecture

### 13.1 Mobile tab bars (defaults per role; items hidden when permission or flag is missing)

| Role | Tab 1 | Tab 2 | Tab 3 | Tab 4 | Tab 5 |
|---|---|---|---|---|---|
| **Tech** | **Today** (`/today`): my day | **Jobs** (`/jobs?mine`): upcoming/past | **Inbox** (`/messages/outbox`): outbox + threads | **Pay** (`/pay`): earnings, cash, statements | **More** |
| **Office** | **Today** (`/today`): ops dashboard | **Schedule** (`/schedule`) | **Leads** (`/leads`) | **Customers** (`/customers`) | **More** |
| **Admin** | **Home** (`/insights`): admin dashboard | **Schedule** | **Customers** | **Money** (`/payments`: invoices, payments, AR, disputes, payroll) | **More** |

**More** is a grouped list. Each item is shown only when the user has the permission/flag:
- **Work:** Leads (admin), Assign (badge: needs a tech; the More tab carries it), Estimates, Invoices, Payments, Messages, Reviews, Approvals (badge), Tasks (badge)
- **Team:** Team, Map, Payroll, Time clock
- **Fleet:** Vehicles, Tools, Parts & Receipts, Inventory
- **Insights:** Insights (office/tech variants)
- **Account:** Notifications, Profile, Appearance, Install app, Sign out
- **Admin:** Settings, Audit log, Data

**Global elements**
- **Named create buttons** in the nav bar instead of a "+" menu: **New lead, New job, New customer**, the page's own first. Phones: small labeled icons; tablet and desktop: pills, the page's main one in the accent (only on its own list page). A page with a create action of its own puts it first: New estimate (Estimates), Upload receipt (Parts, Pay), New tool (Tools), New vehicle (Vehicles).
- **Global search** (customers, jobs, invoices, phone numbers) via the search field on list pages and ⌘K on desktop.
- A notification bell in the nav bar.

### 13.2 Desktop sidebar (≥ 1024 px)
Sections:
- **Overview:** Home/Today, Insights
- **Work:** Schedule, Assign, Leads, Jobs, Estimates, Invoices
- **Customers:** Customers, Messages, Reviews
- **Money:** Payments, Disputes, Payroll
- **Operations:** Map, Team, Vehicles, Tools, Parts, Inventory, Approvals
- **Settings**

Badge counts: new leads, needs a tech (Assign), outbox pending, approvals, overdue.

### 13.3 Route map (authenticated)
| Route | Screen |
|---|---|
| `/today` | Role-specific Today (tech: My Day; office: Ops) |
| `/schedule` | Calendar/board (day/3-day/week; tech filter) + unscheduled queue |
| `/leads`, `/leads/[id]` | Inbox (grid of lead boxes, status chips, the lead map, the lead card sheet `?lead=`); the lead page (the same card for links and printing, intake log, raw payload for admins) |
| `/leads/new`, `/leads/new/schedule`, `/leads/new/done` | Booking: Who (New lead, the caller form) → What (job type) → When (week strip, 2-hour arrival windows) → Done (Assign a tech, Next lead) |
| `/dispatch` | Assign hub: the Needs a tech queue, every tech's route on a map, ranked techs for a job |
| `/customers`, `/customers/[id]` | List/search; detail with timeline, properties, jobs, money, tags, flags |
| `/jobs`, `/jobs/[id]` | List (filters); detail (tech action bar / office view tabs: Overview · Photos · Estimate · Invoice · Parts · Messages · History) |
| `/jobs/[id]/evidence` | Evidence pack (print) |
| `/jobs/[id]/print` | Work order print |
| `/estimates`, `/estimates/[id]` | Board (unsold by value) + builder |
| `/invoices`, `/invoices/[id]`, `/invoices/[id]/print` | List with aging filter; detail; print |
| `/payments` | Payments, unverified manual, reconciliation, refunds |
| `/disputes`, `/disputes/[id]` | List with countdowns; evidence editor |
| `/messages`, `/messages/outbox`, `/messages/[customerId]` | Threads, outbox, thread |
| `/reviews` | Requests, clicks, ratings, leaderboard |
| `/parts` | Receipts (mine / approvals), unbilled flags |
| `/inventory` | Stock by location, restock requests, counts |
| `/pay`, `/pay/statements/[id]` | Tech: earnings, cash, statements; Admin: `/pay/settlements` periods, approvals, payouts, NACHA |
| `/vehicles`, `/vehicles/[id]`, `/vehicles/approvals` | Fleet, vehicle detail tabs (Overview · Logs · Service · Docs · Issues · Trips), approvals queue |
| `/tools`, `/tools/[id]`, `/tools/audits/[id]` | Tools, detail/history, audit flow |
| `/map` | Live map |
| `/approvals` | Unified approvals queue (vehicle logs/documents, tech-paid receipts, after-arrival cancels, Critical-job start requests, settlement flags), filtered to what the viewer may decide |
| `/tasks` | Tasks (mine; all with `tasks.view_all`) |
| `/time` | Own time entries; others' with `time.manage` |
| `/pay/bank` | Tech direct-deposit details (`payroll.bank_edit_own`) |
| `/settings/audit` | Audit log viewer (`audit.view`) |
| `/insights` | Dashboards (role variant) |
| `/team`, `/team/[id]` | Team list, profile (comp, permissions overrides, time, agreements; a tech's working hours and time off) |
| `/notifications` | Notification center |
| `/settings/*` | §M21 pages |
| `/more` | More menu |

---

## 14. Performance budget & lightweight rules

| Budget | Limit | How it's checked |
|---|---|---|
| Shell route JS (framework + app shell) | ≤ 150 KB gzipped | `pnpm analyze` (`next analyze`) in CI; fail on regression > 5% |
| Route-specific client JS | ≤ 30 KB gzipped per route (map route excluded: Leaflet 43 KB lazy) | same |
| CSS | ≤ 25 KB gzipped | build output check |
| `embed.js` | ≤ 3 KB gzipped | script size check |
| LCP | < 2.5 s on mid-range Android over 4G | Lighthouse CI on `/today`, `/jobs/[id]`, `/i/[token]` |
| INP | < 200 ms | Lighthouse + manual |
| Server action p95 | < 300 ms (excluding provider calls, which go in `after()`/queue) | logs |
| Lead intake p95 | < 300 ms | logs |
| Photo | 1600 px ≈ 200–400 KB; thumb 320 px ≈ 20 KB | client pipeline |

**Rules**
1. Server Components by default. Client components only for: forms with interactivity, sheets, camera, signature, map, schedule drag, tab bar, toasts, outbox. Charts are SVG on the server.
2. Lazy-load: Motion `domMax`, Leaflet + CSS, `SignaturePad`, `PhotoCompare`, `ScheduleBoard` drag, pull-to-refresh, push setup, `InstallPrompt`.
3. No dependency over 5 KB gzipped on the client without an entry in `docs/budget.md` (name, size, reason, alternative considered).
4. Banned: UI kits, chart libraries, date libraries, moment, lodash, AWS SDK, Stripe/Twilio SDKs, `@react-pdf`, full `motion`, Vaul, MapLibre, `browser-image-compression`, libphonenumber on the client.
5. Use `Intl` for all number, currency and date formatting.
6. `<Link prefetch>` only on the primary list → detail flows (jobs, customers). Keep the default elsewhere.
7. Use `images.unoptimized: true` and pre-sized user photos via signed URLs. Use `loading="lazy"` and `decoding="async"` on all thumbnails.
8. Lists over 100 rows paginate with a server cursor (no virtualized-list library). Infinite scroll uses IntersectionObserver.
9. DB: every list query has a supporting index (§6). No N+1: queries use joins or `IN` batches. `EXPLAIN` documented for dashboard queries.
10. `after()` for non-critical work (events, emails, geocode, AI, fee fetch).

---

## 15. Extensibility conventions (for future Claude sessions)

### 15.1 Module folder layout (every module identical)
```
src/features/<module>/
  manifest.ts      # ModuleManifest (below) — the single registration point
  permissions.ts   # export const perms = ['jobs.view_all', …] as const + DEFAULT_GRANTS fragment
  schema.ts        # re-export of src/db/schema/<module>.ts tables (Drizzle)
  queries.ts       # read DAL ('server-only'), requireUser first, cached + tagged
  actions.ts       # 'use server' actions via action()
  events.ts        # event payload types emitted + handlers subscribed (registerHandler)
  automations.ts   # built-in automations + templates seeds for this module
  settings.ts      # zod schema fragment merged into CompanySettings + defaults
  engine/          # pure logic (golden-tested), optional
  components/      # module UI (server first)
  nav.ts           # nav items {href, label, icon, perm, flag, roles, tabPriority}
  seed.ts          # seed data for this module (idempotent)
  README.md        # what it does, key flows, extension points
```
```ts
// src/features/registry.ts
export interface ModuleManifest {
  key: string; name: string; description: string;
  flag?: { key: string; default: boolean };           // feature flag
  permissions: readonly string[];
  defaultGrants: Partial<Record<'admin'|'office'|'tech', readonly string[]>>;
  nav?: NavItem[];
  settings?: { schema: z.ZodTypeAny; defaults: unknown; page?: string };
  events?: { emits: readonly string[]; handlers?: Record<string, EventHandler> };
  automations?: AutomationSeed[]; templates?: TemplateSeed[];
  customFieldEntities?: string[];
  seed?: (db: DB) => Promise<void>;
  dependsOn?: string[];
}
export const modules: ModuleManifest[] = [auth, team, customers, leads, jobs, tech, estimates, invoices,
  payments, disputes, media, messaging, automations, reviews, parts, payroll, vehicles, tools, map,
  insights, settings, notify, portal, data];
```
The permission union type, nav, settings schema, event handlers, seeds and the feature-flags page are all **derived from `modules`**. Adding a module = adding a folder + one line in the registry.

### 15.2 How to add a module (checklist for Claude)
1. Scaffold `src/features/<key>/` per §15.1. Copy `src/features/_template/`, which ships with the repo.
2. Add tables in `src/db/schema/<key>.ts` following §6.1 conventions. Run `pnpm db:generate`. Never edit applied migrations.
3. Declare permissions + default grants; they appear automatically in `/settings/permissions`.
4. Add the flag (default off for new optional modules) and nav items.
5. Write queries/actions through `requireUser` and `action()`. Emit events for every meaningful change.
6. Add automations/templates seeds if the module messages anyone.
7. Add golden tests for any money, time or rule logic.
8. Update `docs/MODULES.md` (one paragraph) and `docs/CHANGELOG.md`.
9. Check `pnpm lint && pnpm typecheck && pnpm test && pnpm analyze` against the budgets.

### 15.3 Seeds and vertical presets
- `src/db/seed/base.ts` contains:
  - roles
  - default permission grants
  - counters
  - policies (v1 texts)
  - templates and automations from all manifests
  - the default comp plan `partner_25`
  - a 2026 mileage rate
  - vehicle reminder templates
  - the three generic job types ("Free estimate", "Service call", "Project"; M05). "Repair" and "Maintenance" are retired: migration `0006_job_kinds_data` archives them on older databases.
  - default deposit rules (special-order parts → `parts_plus_percent` 10%; risk ≥ High → 25%)
  - a tax-rate placeholder
- **Presets:** `src/presets/<vertical>.ts` exports `{ serviceTypes, checklists, customFields, pricebook, tags, automationsOverrides }`. MVP ships `generic`. Adding `locksmith`, `garage_door`, `hvac`, `plumbing`, `chimney` or `appliance` is **data only** (Later). Signup's trade picker lists available presets.

### 15.4 Feature flags
- These live in `company.settings.features` (`Record<string, boolean>`), with defaults from manifests.
- Check with `isEnabled('tools')`: server-side in `action()` and `FeatureGate`, and client-side via the root layout context.
- Turning a flag off never deletes data.

### 15.5 `CLAUDE.md` outline (ship in repo root)
1. **What this is:** a single-tenant home-service CRM boilerplate. Read `docs/SPEC.md` §1 principles.
2. **Commands:** `pnpm dev`, `db:generate`, `db:migrate`, `seed:demo`, `test`, `lint`, `typecheck`, `analyze`, `build`.
3. **Architecture map:** request flow (§3.1), folder layout (§3.2), the module manifest (§15.1).
4. **Hard rules:**
   - Every DB read goes through `features/*/queries.ts` with `requireUser()` first. No DB reads at build time.
   - Every mutation goes through `action()` (perm + zod + transaction + audit + events + `updateTag`).
   - Money is integer cents; rates are bps; `roundHalfAway`. Balances are derived; ledgers are append-only with reversals.
   - Issued invoices, signatures, consent and audit are immutable.
   - PG16-compatible SQL only. No `uuidv7()`. No extensions. Enums are text + zod.
   - Providers only via `src/adapters/*`. Never import a vendor SDK in features.
   - Client bundle: no dependency over 5 KB without `docs/budget.md`. Banned list in §14.
   - Animations: CSS spring tokens first, Motion `m` second, never full `motion`.
   - Photos upload direct-to-storage via presign. Never through actions.
   - Messages always pass consent, quiet hours and caps through the automation sender. Never call a driver directly from features.
   - ⚖️ features default OFF or conservative. Never remove warnings.
   - No AI on the money path. No PII to free-tier AI.
   - Don't run `drizzle-kit push/studio` against PGlite while `next dev` is running.
5. **How to add a module / adapter / automation / template / custom field / preset** (§15.2, §9.7).
6. **Testing:** golden tests location, fixtures, how to add a case.
7. **Next.js 16 notes:** async request APIs, `proxy.ts`, Cache Components rules, `updateTag` vs `revalidateTag(tag,'max')`, `after()`. Keep the `AGENTS.md` docs pointer.
8. **Design system:** tokens, the components list, and "use existing components before creating new ones".
9. **Glossary:** job states, payment status, settlement states, ledger types, risk/readiness.

---

## 16. Out of scope for v1 (Later)
- **Telephony & SMS:**
  - Twilio/Telnyx drivers with inbound SMS, delivery receipts and MMS
  - the "Go live with SMS" 10DLC wizard
  - Android gateway driver
  - missed-call text-back
  - call masking / call recording
  - shared team inbox assignment
- **Lead intake:** inbound-email parser (Cloudflare Email Worker), Google LSA API polling, Yelp native integration.
- **Booking & customer accounts:** online booking with live capacity slots; customer portal login accounts; memberships/maintenance plans with recurring billing.
- **Payments:**
  - Square adapter
  - Stripe Terminal (S700)
  - Tap to Pay (needs a native wrapper)
  - ACH via Stripe
  - consumer financing
  - card-on-file auto-charge of balances
  - Stripe Connect payouts
  - Gusto/ADP API integrations
  - **any payroll tax withholding or filing (never)**
- **Disputes:** server-side PDF rendering as the default, Square disputes mapping, Visa CE3.0 auto-assembly, Verifi RDR/Ethoca.
- **Field & fleet:**
  - native wrapper (Capacitor) for background GPS
  - OBD/telematics trackers
  - route optimization and real routing ETAs
  - geofence auto-arrive
  - route playback
- **Inventory & warranty:** purchase orders to suppliers, supplier price history, barcode scanning for parts, core returns, warranty claim submission integrations.
- **Accounting & migration:** QuickBooks/Xero sync; importers for Jobber/HCP/Workiz exports.
- **AI & reviews:** AI fleet summaries; AI message drafting; Google Business Profile review import/reply.
- **Tenancy & platform:**
  - multi-location / multi-company tenancy
  - i18n (English only in v1)
  - passkeys, 2FA, SSO
  - daily-OT state rules
  - subcontractor job link
  - visual automation flow builder with branches
  - A/B testing
  - custom report builder
  - vertical presets beyond `generic`

---

## 17. Open questions & unverified items
1. **`sms:` body delimiter on current iOS** is not re-verified. Test on real iOS 26 and Android devices. The per-device override mitigates this.
2. **IRS mid-2026 mileage revision to 76¢** is not confirmed with the IRS. 72.5¢ is seeded and admin-editable.
3. **Surcharge rules** (Visa debit prohibition and 3% wording, Maine, NY details, final status of the Visa/MC settlement) are not re-verified. Surcharge mode is off by default and shows warnings only.
4. **Maryland HB 1499** (deposit cap ½) passage is unverified. The MD warning uses ⅓ until confirmed.
5. **State wage-deduction rules for clawbacks** are summarized only. W-2 deductions are always `needs_review`. Counsel must review the comp agreement template before production use.
6. **Gemini free-tier limits** are unpublished. The design assumes about 20 requests/day. Model IDs change often, so pin them via env.
7. **US Census geocoder endpoint** has not been re-checked this session. Verify it during the build; Nominatim is the fallback (respect 1 req/s).
8. **TypeScript 7 + Biome toolchain maturity.** If `next build` type-checking or editor tooling breaks, fall back to TS 6.0.3 (and optionally ESLint). The decision is recorded in `docs/budget.md`.
9. **PGlite 0.5.10** was published on the research day. Pin 0.5.8 if 0.5.10 shows regressions.
10. **Visa VAMP 1.5% threshold** comes from vendor sources. Stripe's 0.75% is the alert line we use.
11. **Hosting:** Vercel Hobby can't be used commercially. The owner must choose between Vercel Pro and a VPS (Docker standalone). Both are documented.
12. **Owner's model clarifications:**
    - Is "credit fee" deducted for Zelle/Venmo? Default: card, ACH and Venmo yes; Zelle no.
    - Is "25% after parts" on company parts only, or also on tech parts? Default: both.
    - Do tips go 100% to the tech? Default: yes.

    All three are configurable in the plan.
13. **Owner decisions added by the critic pass** (all have safe defaults; none block the build):
    - **Cash:** should techs keep cash and have it netted from pay (default for 1099 partners), or hand all cash in daily? Should checks ever be netted? (Default: never, because checks are payable to the company.)
    - **Text sender identity in free mode:** is it OK that on-my-way texts come from the tech's personal phone (default), or should they route through an office phone / company-issued phones?
    - **Chargeback hold:** keep the seeded `on_open: 'hold'` (commission frozen while a dispute is open, which can push a tech's week negative), or `none` (claw back only on loss)?
    - **Vehicle log defaults:** keep "documents and service always reviewed, odometer/fuel auto when evidence is clean", or require review for everything at first?
    - **Review consent basis:** send review requests to all customers with transactional SMS consent (default), or only to marketing-consented customers?

---

## Critic Log

Completeness and consistency pass against the owner's verbatim requirements and `RESEARCH.md` (2026-10-15). Patches only; no sections rewritten.

**Requirement gaps closed**
- **Lead intake from static HTML:** `_ts` was mandatory, but a plain HTML form can't sign it, so every static-site lead would have been marked spam and silently dropped. `_ts` is now enforced only when present or when `lead_sources.require_ts` is set. Soft `spam_score` sends doubtful leads to a "Check" filter. Added `integration_kind` and §8.5 with ready-to-paste snippets for the plain form, `embed.js` and JSON/curl. Consent is never required to submit, and marketing consent is a separate box.
- **Cash kept by the tech:** specified `tech_keeps_cash = false`, per-tech overrides (`tech_comp.overrides`) and one custody-balance formula. `cash.methods` now defaults to `['cash']`, so checks are never netted.
- **Parts, two work trees:** added `company_card` as a company-paid source (receipt required) and a normative two-tree → payroll diagram. Non-job purchases post the new `reimbursement_expense`.
- **Vehicle approval:** added the resolution order (permission AND policy, approver self-log, new `vehicles.log_trusted` per-user override, anomalies always force review), the review screen and seeded defaults. Inspections gained `approval_status`.
- **Tools maintenance:** added maintenance intervals, `tool_maintenance_logs`, a due event and a Gemini `tool_label` read. Spelled out how the module stays optional.
- **Photos optional:** removed the duplicate `media.before_after_enabled` and made the `before_after` flag the single switch. Defined the knock-on rules for readiness and risk, plus a company → service type → invoice embedding cascade that covers invoices and receipts.
- **Paycheck deposit:** added tech bank entry (`/pay/bank`), anti-diversion payout hold, and a payout notification.
- **Tech flow:** added start of day, the "Finish my day" sheet, an `on_hold → scheduled` return visit, and a Critical-job start approval. Removed the tech "Request review" button, which conflicted with permissions and Google policy. Added the `tech_texts_from` anti-poaching setting.
- **Automations for customer, tech and admin:** added 30 missing built-in rows, including reschedule/cancel/refund notices, tech agenda/changes, and low-rating, flagged-receipt, EFW and vehicle-issue alerts.

**Consistency fixes**
- Added 13 permission keys: `jobs.approve_start`, `jobs.review_cancellations`, `jobs.set_custom_rate`, `tasks.view_all`, `payments.keyed_entry`, `inventory.request_restock`, `payroll.bank_edit_own`, `vehicles.log_trusted`, `tools.report_incident`, `tools.maintenance_log`, `tags.manage`, `reminders.manage`, `custom_fields.manage`. Added a settings-page → permission map and a two-key rule. The undeclared `payments.allow_keyed` is now a setting plus a permission.
- Added the `tasks` table, which several modules referenced but which didn't exist. Moved the per-job rate from `custom` jsonb to the `jobs.custom_rate_bps` column. Added `visit_count`. Synced the ledger types between M16 and §6.10.
- Added 14 missing events (`invoice.voided`, `dispute.evidence_submitted`, `payment.customer_flagged`, …). Defined the automation audiences (`perm:<key>`, `assigned_techs`, `subject_user`, …) and anchors (`job.window_end`, `dispute.due_by`, …) that §7.3 already used. Defined `receipt.link`.
- Added the missing `/approvals`, `/tasks`, `/time`, `/pay/bank` and `/settings/audit` routes. The AI policy now covers `shop_invoice`, `tool_label` and the text kinds.
- **Commission:** re-verified examples A–G (all correct). Added a note that case F assumes the hold and the loss fall in one period, and required golden tests for both variants.
