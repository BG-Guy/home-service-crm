# BUILD_PLAN.md: parallel build plan and cross-module contracts

**Status:** normative for the parallel build. Written 2026-10-15 against `docs/SPEC.md` v1.0 and the existing scaffold (`src/db/schema/*.ts`, 12 files).
**Audience:** the foundation builder (F), the eight feature builders (B1 to B8) working in the same tree at the same time, and the final integrator.

**Precedence.** Lead-engineer amendments come first. This plan comes next for ownership, cross-group contracts, events and seeds. `SPEC.md` comes last, and it still governs all product behavior. Where this plan adds something (a route, an event, a template key or an API), it fills a gap in the spec and does not contradict it.

**Amendments recap (binding on every group)**
1. Use npm only (`npm run <script>`). Never use pnpm.
2. Install nothing. Only F changes `package.json`.
3. Don't use `cacheComponents`, `'use cache'`, `cacheTag`/`updateTag`, PPR or `partialPrefetching`.
   - Authenticated routes render dynamically.
   - Use React `cache()` for per-request dedupe.
   - After a mutation, call `revalidatePath()`. The installed Next (16.4.1) also ships `refresh()` from `next/cache` for Server Actions; `action()` calls it.
   - Read every SPEC mention of tags or `'use cache'` as a future optimization.
4. Use `<ViewTransition>` only if the installed React exports it as stable. Otherwise use CSS plus `document.startViewTransition` as progressive enhancement. Animation code must never break the build.
5. The session cookie is `__Host-sid` in production and `sid` on http://localhost.
6. Keep everything lightweight: follow SPEC §14 and add no new runtime dependencies.

---

## 0. How to read this document

| You are | Read |
|---|---|
| F (foundation) | §2 (core names you must export), §3.6 (frozen files), §4 (extension files you aggregate), §5 and §6 (create every contract as a stub with the exact signature and the stub level shown), §7.1 (event additions), §10.1 (seed helpers and the demo plan file) |
| A builder Bn | §1 (your group), §3 (exactly what you own), §5 and §6 (what you produce and consume), §7 and §8 (events and cron you emit and handle), §9 (your scope checklist), §10 (your seed fragment), §11 (rules) |
| Integrator | §11.4 (change-request intake) and §12 (checklist) |

Glossary:
- **Producer:** the group that owns and implements a contract.
- **Consumer:** a group that imports it.
- **Stub level:** what F ships before the producer replaces it.
  - **F (full):** F implements it completely. It is usually trivial.
  - **M (minimal):** a working but simplified behavior, described inline.
  - **T (throws):** throws `NotImplementedError`. Consumers must tolerate the throw.

---

## 1. Groups at a glance

| Group | Modules (manifest keys) | Satellite dirs (no manifest) | Summary |
|---|---|---|---|
| **F** Foundation | `auth` (M01) | `src/lib`, `src/db`, `src/ui`, `src/adapters`, shell | Scaffold, all tables, core libs, adapters, UI kit, shell, auth pages, PWA, all 24 manifests, contract stubs. **Frozen after hand-off** (§3.6). |
| **B1** Customers, leads, data | `customers` (M03), `leads` (M04), `data` (M24) | — | Customers and properties, global search, call log, lead intake (API, embed.js, hosted form), leads inbox, lead sources and API keys, import/export/backup. |
| **B2** Jobs and the tech app | `jobs` (M05), `tech` (M06) | `tasks`, `time` | Status machine and guards, schedule board, dispatch, the job detail shell, Today (tech), Finish my day, offline outbox and drafts, notes, tasks, time clock. |
| **B3** Documents and portal | `estimates` (M07), `invoices` (M08), `portal` (M23) | `pricebook`, `signatures` | Price book, estimates (good/better/best, e-sign), change orders, invoices, revisions, credit notes, receipts, print pages, magic-link pages `/j` `/e` `/i`. |
| **B4** Money and evidence | `payments` (M09), `disputes` (M10), `media` (M11) | — | Ledger, manual and Stripe REST payments, webhooks, refunds, deposits, risk and readiness engines plus transition controls, disputes, evidence pack, photos (gallery, compare, embedding). |
| **B5** Communications | `messaging` (M12), `automations` (M13), `reviews` (M14), `notify` (M22 minus tasks) | — | `enqueueMessage` (the only send path), outbox, threads, consent, automation engine and editor, templates, reminders, reviews, notifications, push, activity timeline UI, audit viewer. |
| **B6** Parts and pay | `parts` (M15), `payroll` (M16) | `approvals` | Parts (both money trees), receipts, inventory, commission engine, ledger, settlements, payouts, NACHA, bank details, the cash custody, the unified `/approvals` page. |
| **B7** Fleet and field | `vehicles` (M17), `tools` (M18), `map` (M19) | — | Vehicles, logs, approvals policy, Gemini assist, tools, audits, maintenance, location pings, live map, tracking page `/t`. |
| **B8** Team, settings, insights | `team` (M02 minus time clock), `settings` (M21), `insights` (M20) | — | Team and invites UI, profiles, permission grid and overrides, settings shell and general pages, dashboards (admin, office Ops Today, tech), anomaly report. |

**How this refines the proposed split.** Every move gives a contract exactly one owner.
- The price book goes to B3. It is used by estimates and parts, and edited at `/settings/pricebook`.
- `notes` goes to B2 (§6.4 table) and is exposed to others as a slot.
- The `signatures` library goes to B3. Other groups capture signatures through its API.
- The `calls` log goes to B1.
- `consent_events` goes to B5.
- The tracking page `/t/[token]` goes to B7.
- The evidence pack `/jobs/[id]/evidence` goes to B4.
- The audit viewer goes to B5.
- The office "Ops Today" goes to B8 and is mounted by B2's `/today`.
- Property geocoding is triggered by B1 through the geocode adapter, which B7 stewards.

---

## 2. Foundation core this plan relies on (F must export these names)

If F ships a different name, the shipped code wins for core libraries, and the integrator adds an alias. Builders code against what F shipped and report the mismatch. Cross-group contracts (§5 and §6) do **not** follow this rule: this plan is authoritative for them.

```ts
// src/db/index.ts
export const db: DB;                         // Drizzle (pg Pool or PGlite)
export type DB = …; export type Tx = DB | DbTransaction;   // every api fn accepts Tx
export function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
// src/db/enums.ts: zod enums and TS unions for every text enum in §6 (JobStatus, PaymentStatus, RiskBand,
//   MediaTag, MediaKind, LineType, PartSource, PaymentMethod, PaymentKind, LedgerType, TaskKind,
//   SignatureDocType, ApprovalEntityType, EntityType, Channel, Purpose, ScheduledStatus, …)

// src/lib/types.ts
export type Actor = { kind: 'user'|'system'|'api'|'webhook'|'public_token'; userId: string|null;
                      ip?: string|null; userAgent?: string|null; tokenId?: string|null };
export const SYSTEM_ACTOR: Actor;
export type EntityRef = { type: EntityType; id: string };
export type Geo = { lat: number; lng: number; accuracyM?: number|null; at?: string /* device ISO ts */ };
export type ActionResult<T = undefined> =
  | { ok: true; data?: T } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };
export interface SessionUser {
  id: string; email: string; name: string; firstName: string; role: string;
  baseRole: 'admin'|'office'|'tech'; status: string; workerType: 'w2'|'1099';
  usesCompanyTools: boolean; usesCompanyVehicle: boolean; monitoringNoticeAckAt: Date|null;
  perms: ReadonlySet<Perm>; sessionId: string;
}

// src/lib/auth/*  (React cache() per request; no 'use cache')
export function getCurrentUser(): Promise<SessionUser|null>;
export function requireUser(perm?: Perm | Perm[]): Promise<SessionUser>;   // redirects to /login; ForbiddenError on perm
export function can(user: SessionUser, perm: Perm): boolean;
export function actorOf(user: SessionUser): Actor;

// src/lib/permissions.ts
export type Perm = …;                         // union derived from all manifests
export function effective(user, perm): boolean;   // §4.1 resolver (golden-tested by F)
export function listUsersWithPerm(perm: Perm): Promise<string[]>;  // active users, effective perm

// src/lib/action.ts  (§8.2 minus cache tags)
export function action<I, O>(cfg: {
  perm?: Perm | Perm[]; feature?: FeatureFlag; input: ZodType<I>; audit?: string;
  run(a: { input: I; user: SessionUser; tx: Tx; actor: Actor }): Promise<O>;
  revalidate?: (a: { input: I; data: O }) => string[];   // paths; refresh() is always called
}): (input: I | FormData) => Promise<ActionResult<O>>;
// Idempotency: when input has clientId, the stored action_receipts result is returned on replay.

// src/lib/errors.ts
NotImplementedError, ForbiddenError, NotFoundError, ConflictError(code), ValidationError(fieldErrors), FeatureDisabledError

// src/lib/events.ts
export type EventType = keyof EventMap;  export type DomainEvent<E> = { id: number; type: E; entity: EntityRef|null; payload: EventMap[E]; actorUserId: string|null; createdAt: Date };
export function emit<E extends EventType>(tx: Tx, type: E, entity: EntityRef|null, payload: EventMap[E]): Promise<void>;
export function processEvents(): Promise<void>;   // after() + cron; dispatches to registered handlers (§4)

// src/lib/audit.ts, src/lib/activity.ts
export function writeAudit(tx: Tx, a: { actor: Actor; action: string; entity?: EntityRef; before?: unknown; after?: unknown }): Promise<void>;
export function writeActivity(tx: Tx, a: { entity: EntityRef; customerId?: string|null; jobId?: string|null;
  kind: string /* event type or '<entity>.<verb>' (Appendix C) */; summary: string; data?: unknown; actorUserId?: string|null }): Promise<void>;

// src/lib/settings.ts
export type CompanySettings = …;  // merged zod fragments of all manifests
export function getSettings(): Promise<CompanySettings>;     // React cache()
export function isEnabled(flag: FeatureFlag): Promise<boolean>;
export function updateSettings(tx: Tx, patch: DeepPartial<CompanySettings>, actor: Actor): Promise<void>;  // audited
export function getCompany(): Promise<CompanyRow>;

// src/lib/tokens.ts  (public magic links, §M23)
export const TOKEN_TTL: Record<'job'|'estimate'|'invoice'|'pay'|'review'|'tracking'|'sub_job', number /* ms */>;
export function mintPublicToken(tx: Tx, i: { kind; entity: EntityRef; customerId?: string|null; jobId?: string|null;
  expiresAt?: Date }): Promise<{ token: string; tokenId: string; url: string }>;
export function resolvePublicToken(kind, token: string, log: { path: string; action: PortalAction; ip?: string; userAgent?: string })
  : Promise<PublicTokenRow|null>;            // checks hash/expiry/revocation, increments use, logs portal_access_log
export function logPortalAccess(tokenId: string, a: { path; action: PortalAction; ip?; userAgent? }): Promise<void>;
export function revokePublicTokens(tx: Tx, q: { kind?; entity?: EntityRef; jobId?: string }): Promise<number>;

// misc libs: money.ts (roundHalfAway, formatCents, parseMoneyToCents), time.ts (company-TZ helpers, Intl),
// phone.ts (toE164, server-only), counters → nextNumber(tx, key), crypto.ts (encrypt/decrypt v1:…),
// hash.ts (sha256, canonicalJson), template.ts (render, §7.4 syntax), quiet-hours.ts, ratelimit.ts,
// zip-tz.ts, policies.ts (getCurrentPolicy(kind), publishPolicyVersion(tx, {kind,title,body}, actor)),
// secrets.ts (getSecret(key) — env wins, setSecret(tx, key, value, actor) — encrypted, last4),
// queue.ts (enqueueJob(tx|null, kind, payload, {runAt?, dedupeKey?})),
// adapters/ai: queueAiTask(tx, { kind, mediaIds, ref: { module, entityType, entityId } }) → { aiTaskId, status }
// src/features/auth/api.ts (F):
//   createInvite(tx, {name, email?, phone?, role, workerType}, actor) → {inviteId, url, expiresAt}
//   revokeInvite(tx, inviteId, actor); createPasswordResetLink(tx, userId, actor) → {url, expiresAt}
//   revokeAllSessions(tx, userId, opts?: {exceptSessionId?: string}) → number
```

**UI kit (`src/ui/components/*`, F).** Every component in SPEC §12.6. A slot placeholder (`SlotPlaceholder`) is the default body of every stubbed slot. It renders `null` in production and a dashed label in development.

---

## 3. File ownership

**Rule:** each path has exactly one owner, and only the owner creates or edits it. A **satellite dir** is a feature folder without its own manifest. Its permissions, nav items and settings live in the parent module's manifest, which is owned by the same group.

### 3.1 Feature directories (`src/features/**`)

| Group | Owns (everything below each dir) |
|---|---|
| F | `src/features/auth/**`, `src/features/registry.ts`, `src/features/_template/**`, `src/features/approvals/registry.ts` (created by F, then **owned by B6**) |
| B1 | `src/features/customers/**`, `src/features/leads/**`, `src/features/data/**` |
| B2 | `src/features/jobs/**`, `src/features/tech/**`, `src/features/tasks/**`, `src/features/time/**` |
| B3 | `src/features/estimates/**`, `src/features/invoices/**`, `src/features/portal/**`, `src/features/pricebook/**`, `src/features/signatures/**` |
| B4 | `src/features/payments/**`, `src/features/disputes/**`, `src/features/media/**` |
| B5 | `src/features/messaging/**`, `src/features/automations/**`, `src/features/reviews/**`, `src/features/notify/**` |
| B6 | `src/features/parts/**`, `src/features/payroll/**`, `src/features/approvals/**` |
| B7 | `src/features/vehicles/**`, `src/features/tools/**`, `src/features/map/**` |
| B8 | `src/features/team/**`, `src/features/settings/**`, `src/features/insights/**` |

F creates every one of these dirs with the stub files listed in §4, §5 and §6. From then on the owner may rewrite anything inside, **except** that exported contract signatures (§5, §6) and permission or flag keys are frozen (§11.3).

### 3.2 Database tables: write ownership

All schema files are **F-owned and frozen** (`src/db/schema/*.ts`, `drizzle/**`); see §11.3 for schema change requests.
- The "write owner" is the only group whose code issues INSERT, UPDATE or DELETE on a table.
- Everyone else writes through the owner's API (§6).
- **Reads are open:** any group may SELECT any table in its own `queries.ts`. Insights and handlers need this.

| Schema file | Table | Write owner | Notes / column exceptions |
|---|---|---|---|
| `company.ts` | `company` | B8 (profile) via F `updateSettings` | F seeds it. The settings JSON is written only through `updateSettings`. |
| | `roles`, `role_permissions`, `user_permission_overrides` | B8 | F seeds the defaults. |
| | `users` | F (create, password, sessions, invite accept, `monitoring_notice_ack_at`, `esign_consent_at`) and B8 (profile, role, status, deactivate) | Column exceptions: B6 writes the `bank_*` columns; B5 writes `notification_prefs`. |
| | `sessions`, `login_attempts`, `invites`, `password_resets` | F | |
| | `secrets` | B8 (`/settings/integrations`) | Written via F `setSecret()`. |
| | `api_keys` | B1 | |
| | `counters` | F (`nextNumber`) | Prefix and next value are edited by B3 (`invoice`, `estimate`, `change_order`, `credit_note`) and B2 (`job`). |
| | `time_entries` | B2 | |
| | `service_types`, `checklist_templates`, `tags`, `entity_tags`, `custom_field_defs`, `tax_rates` | B8 | Others write `entity_tags` via `setEntityTags`. |
| | `policy_versions` | F lib (`publishPolicyVersion`) | Callers: B3, B4, B6, B7, B8. |
| | `pricebook_items` | B3 | Column exception: B6 maintains `avg_cost_cents` (stock moves). |
| | `deposit_rules` | B4 | |
| `customers.ts` | `customers`, `properties` | B1 | `sms_status` is written only by B1's setter, which B5 calls. B1 merge/anonymize exceptions are in §11.2. |
| | `consent_events` | B5 | |
| | `lead_sources`, `source_spend`, `leads`, `lead_events`, `calls` | B1 | |
| `jobs.ts` | `jobs`, `job_assignments`, `job_status_events`, `notes` | B2 | These cache columns are written only via B2 setters: `payment_status`, `risk_score/band`, `readiness_score`, `estimate_id`, `settlement_locked_at`. |
| `documents.ts` | `estimates`, `estimate_options`, `change_orders`, `invoices`, `line_items`, `invoice_revisions`, `credit_notes`, `signatures`; view `invoice_balances` | B3 | Others add job lines via `addJobLine`. |
| `payments.ts` | `payments`, `refunds`, `deposit_requests`, `checkout_sessions`, `webhook_events`, `disputes`, `risk_assessments` | B4 | |
| `media.ts` | `media` | B4 | Rows are **created** by F's upload routes and F's seed helper. B4 owns all later updates (star, delete, lock, attach). |
| `messaging.ts` | `message_templates`, `automations`, `scheduled_messages`, `messages`, `reminders`, `notifications`, `push_subscriptions`, `review_requests` | B5 | |
| | `events` | F (outbox lib and processor) | Everyone emits via `emit()`. |
| | `public_tokens`, `portal_access_log` | F (`tokens.ts`) | Everyone mints and resolves via the lib. |
| `parts.ts` | `part_purchases`, `stock_locations`, `inventory_levels`, `stock_moves` | B6 | |
| `payroll.ts` | every table in the file | B6 | Others post the allowed ledger types via `postLedgerEntry`. |
| `vehicles.ts` | every table in the file | B7 | |
| `tools.ts` | every table in the file | B7 | |
| `system.ts` | `tech_locations`, `location_breadcrumbs` | B7 | |
| | `activity`, `audit_log` | F (writers) | Everyone calls `writeActivity` and `writeAudit`. |
| | `job_queue`, `scheduler_state`, `action_receipts`, `rate_limits`, `ai_tasks`, `ai_usage` | F | |
| | `tasks` | B2 | Others create via `createTask`. |
| | `exports` | B1 | |
| | `approvals` | B6 | B2, B6 and B7 create rows via `createApproval`. |

### 3.3 Routes (every route has exactly one owner)

Paths are under `src/app/`. Page-level files (`page.tsx`, `loading.tsx`, `error.tsx`, `layout.tsx`, `route.ts`) belong to the route owner.

**Rules for nested layouts:**
- Never add chrome that prints. App-shell chrome carries `print:hidden`.
- **B2 must not create** `(app)/jobs/[id]/layout.tsx`, because B4's evidence pack lives under it. Job tabs are a `?tab=` param on the page.
- The same applies to `(app)/customers/[id]/` and `(app)/invoices/[id]/`.

**F (frozen)**
- `layout.tsx`, `globals.css`, `manifest.ts`, `apple-icon.png`
- `(app)/layout.tsx` (shell: TabBar, Sidebar, NavBar, the + button, ⌘K search, bell slot, `LocationSharer` slot for techs)
- `(app)/page.tsx` (redirects to `/today`), `(app)/more/page.tsx`
- `(auth)/login`, `(auth)/signup`, `(auth)/invite/[token]`, `(auth)/reset` (request form), `(auth)/reset/[token]`
- `(public)/layout.tsx`, `offline/page.tsx`
- `api/cron/tick`, `api/uploads/presign`, `api/uploads/complete`, `api/uploads/local/[...key]` (dev local storage), `api/health`
- `public/sw.js`, `public/icons/**`

**B1**
- `(app)/customers`, `(app)/customers/new`, `(app)/customers/[id]`, `(app)/customers/[id]/merge`
- `(app)/leads`, `(app)/leads/new`, `(app)/leads/[id]`
- `(app)/settings/lead-sources` (+ `[id]`), `(app)/settings/api-keys`, `(app)/settings/data`
- `(public)/f/[publicKey]`, `(public)/f/[publicKey]/thanks`
- `api/v1/leads` (POST, OPTIONS), `api/v1/leads/f/[publicKey]`, `api/v1/hooks/[preset]/[secret]`, `api/v1/leads/schema`, `api/v1/inbound-email/[secret]` (Later: returns 501), `api/export/[id]`
- `public/embed.js` (generated)

**B2**
- `(app)/today`, `(app)/today/finish` ("Finish my day", page styled as a sheet)
- `(app)/schedule`
- `(app)/jobs`, `(app)/jobs/new`, `(app)/jobs/[id]`, `(app)/jobs/[id]/print`
- `(app)/tasks`, `(app)/time`, `(app)/settings/jobs`
- `(public)/s/[token]` (**Later**: not built; do not create)

**B3**
- `(app)/estimates`, `(app)/estimates/new`, `(app)/estimates/[id]`, `(app)/estimates/[id]/print`, `(app)/estimates/co/[id]` (change order)
- `(app)/invoices`, `(app)/invoices/[id]`, `(app)/invoices/[id]/print`, `(app)/invoices/statement/[customerId]`
- `(app)/settings/pricebook`, `(app)/settings/invoices` ("Invoices & estimates")
- `(public)/j/[token]`, `(public)/e/[token]`, `(public)/i/[token]` (handles `?receipt=`)
- `api/uploads/public/presign`

**B4**
- `(app)/payments`, `(app)/disputes`, `(app)/disputes/[id]`, `(app)/jobs/[id]/evidence`
- `(app)/settings/payments`, `(app)/settings/deposits`, `(app)/settings/chargebacks` ("Chargeback protection", including the photo and evidence media settings)
- `(public)/p/[token]` (handles `?status=success|cancel`)
- `api/webhooks/stripe`, `api/webhooks/square` (Later: 501)

**B5**
- `(app)/messages`, `(app)/messages/outbox`, `(app)/messages/[customerId]`, `(app)/reviews`, `(app)/notifications`
- `(app)/settings/messaging`, `(app)/settings/templates`, `(app)/settings/automations`, `(app)/settings/reviews`, `(app)/settings/reminders`, `(app)/settings/audit`
- `(public)/r/[token]`, `(public)/sms-terms`, `(public)/privacy`
- `api/push/subscribe` (POST, DELETE), `api/inbound/sms/[driver]` (Later; may accept the `console` driver in dev)

**B6**
- `(app)/parts`, `(app)/inventory`, `(app)/approvals`
- `(app)/pay`, `(app)/pay/statements`, `(app)/pay/statements/[id]`, `(app)/pay/settlements`, `(app)/pay/settlements/[id]`, `(app)/pay/bank`, `(app)/pay/agreement`
- `(app)/settings/commission`, `(app)/settings/parts`

**B7**
- `(app)/vehicles`, `(app)/vehicles/[id]`, `(app)/vehicles/approvals`
- `(app)/tools`, `(app)/tools/[id]`, `(app)/tools/[id]/theft-report`, `(app)/tools/audits/[id]`, `(app)/tools/labels`
- `(app)/map`
- `(app)/settings/vehicles`, `(app)/settings/tools`, `(app)/settings/map`
- `(public)/t/[token]`
- `api/location`

**B8**
- `(app)/insights`, `(app)/team`, `(app)/team/[id]`
- `(app)/settings` (index and `layout.tsx`), plus these settings pages: `company`, `branding`, `services`, `taxes`, `compliance`, `tags`, `custom-fields`, `checklists`, `features`, `permissions`, `permissions/users/[id]`, `integrations`, `profile` (own profile, password, sign out other devices, appearance, notification prefs slot, push enable, install app)

Notes:
- Settings pages added by this plan (not in the §3.2 folder list): `jobs` (B2), `invoices` and `chargebacks` (B3, B4; both are named in M21), `parts` (B6), `map` (B7), `profile` (B8).
- The `/more` menu and the settings index are derived from manifests' `nav` entries. Owners add their own settings pages to their manifest's `nav` with `section: 'settings'`.

### 3.4 Settings namespaces (`company.settings.*`)

Each zod fragment lives in a module's `settings.ts`, which belongs to the module owner. The owner may **add** keys with defaults and must never rename or remove them. A page may edit keys outside its own namespace only where this table says so.

| Namespace | Fragment owner | Edited on | Main readers |
|---|---|---|---|
| `features` | F (derived from manifests) | `/settings/features` (B8) | all |
| `auth` (`open_signup`) | F | `/settings/company` (B8) | F |
| `company` (business hours, after-hours, `service_zips`, `emergency_phone`, `lead_response_minutes`) | B8 (`settings`) | `/settings/company` | all |
| `branding`, `ui` | B8 | `/settings/branding`, `/settings/profile` | F layout, B3, B5 |
| `compliance` (state flags, quiet hours, frequency caps, consent and monitoring texts, wage-deduction rules) | B8 | `/settings/compliance` | B4, B5, B6, B7 |
| `limits` (`max_discount_pct` by role, `max_refund_cents` by role, `auto_approve_under_cents`) | B8 | discount on `/settings/invoices` (B3); refund on `/settings/payments` (B4); auto-approve on `/settings/parts` (B6) | B3, B4, B6 |
| `insights` (`show_tech_rank`) | B8 | `/settings/company` | B8 |
| `leads` | B1 | `/settings/lead-sources` | B1, B5, B8 |
| `data` | B1 | `/settings/data` | B1 |
| `jobs` (`arrival_radius_m`, window lengths, `unconfirmed_flag_time`, cancellation-fee policy) | B2 | `/settings/jobs` | B2, B4, B5 |
| `estimates`, `invoices`, `portal` | B3 | `/settings/invoices` | B3, B4, B5 |
| `payments`, `deposits` (rules are a table), `disputes`, `risk`, `media` | B4 | `/settings/payments`, `/settings/deposits`, `/settings/chargebacks` | B3, B4, B6, F uploads |
| `messaging`, `reviews`, `notify` | B5 | `/settings/messaging`, `/settings/reviews` | B2 (`tech_texts_from`), B5 |
| `parts` (`markup_tiers`, receipt and AI thresholds), `inventory` | B6 | `markup_tiers` on `/settings/pricebook` (B3); the rest on `/settings/parts` | B3, B6 |
| `payroll` | B6 | `/settings/commission` | B6 |
| `vehicles`, `tools`, `map` | B7 | `/settings/vehicles`, `/settings/tools`, `/settings/map` | B2 (`require_odometer_on_clock`), B7 |

### 3.5 Other files

| Path | Owner |
|---|---|
| `scripts/build-embed.ts`, `scripts/export.ts`, `scripts/import-csv.ts`, `scripts/restore.ts`, `src/features/leads/embed/**` | B1 |
| `scripts/gen-vapid.ts`, `src/client/sms-href.ts`, `src/client/push.ts` | B5 |
| `src/client/outbox.ts`, `src/client/drafts.ts` | B2 (F creates the stubs, §6.11) |
| `src/client/offline-registry.ts`, `src/client/image.ts`, `src/client/geo.ts`, `src/client/install-prompt.ts` | F |
| `scripts/seed.ts`, `src/db/seed/**` (base seed, `demo-ids.ts`, `demo-plan.ts`, `helpers.ts`, `demo.ts` runner) | F |
| **Adapter stewardship.** F writes them; afterwards only the steward edits them, and only to complete drivers. Interfaces in §9 are frozen. | `adapters/payments/**`, `adapters/pdf/**` → B4. `adapters/messaging/**`, `adapters/email/**`, `adapters/push/**` → B5. `adapters/ai/**` (except F's `policy.ts` and queue), `adapters/vin/**`, `adapters/geocode/**`, `adapters/maps/**` → B7. `adapters/storage/**` → F (frozen). |
| `tests/golden/leads*.test.ts` | B1 |
| `tests/golden/risk*.test.ts`, `readiness*`, `deposit-rules*` | B4 |
| `tests/golden/conditions*`, `quiet-hours*`, `gsm*`, `review-lint*` | B5 |
| `tests/golden/commission*.test.ts`, `nacha*`, `aba*`, `custody*` | B6 |
| `tests/golden/vehicle-policy*`, `vehicle-anomaly*` | B7 |
| `tests/golden/template*`, `permissions*` | F |
| Other tests | `tests/<module>/**` or colocated `*.test.ts` inside owned dirs |
| `src/features/<m>/README.md` | the module owner |
| `CLAUDE.md`, `docs/MODULES.md`, `docs/CHANGELOG.md`, `docs/budget.md`, `docs/DEPLOY.md` | integrator; builders put their text in their final report |

### 3.6 Frozen files (F-owned; never edit, request changes per §11.4)

- `package.json` and the lockfile; `next.config.ts`, `tsconfig.json`, `biome.json`, `drizzle.config.ts`, `vitest.config.*`
- `src/lib/**`, `src/db/**` (incl. schema, enums, seed), `drizzle/**`, `src/ui/**`
- `src/app/layout.tsx`, `src/app/globals.css`, `(app)/layout.tsx`, `(public)/layout.tsx`, `(auth)/**`, `proxy.ts`
- `src/features/registry.ts` and every aggregator listed in §4
- `src/adapters/storage/**`; for other adapters see the stewards above
- `public/sw.js`

**F must ship these npm scripts:** `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `db:generate`, `db:migrate`, `seed:demo`, `build:embed` (`tsx scripts/build-embed.ts`), `export`, `import:csv`, `restore`, `gen:vapid`, `analyze`.

**F must add these headers in `next.config.ts`:** `/embed.js` → `Cache-Control: public, max-age=3600`; `/sw.js` → `no-cache` plus the CSP.

---

## 4. Extension points (fixed-path files)

These files let a group plug into shared machinery **without editing a shared file**.
- F creates each file below as a stub with an empty export, and writes the aggregator that imports it from these exact paths.
- The owner fills the export in.
- A file that doesn't apply to a module is still created, empty.

| File (in each owned feature dir) | Export | Aggregated by (F) | Meaning |
|---|---|---|---|
| `manifest.ts` | `manifest: ModuleManifest` | `src/features/registry.ts` | §15.1 of the spec. Owner may edit nav labels and order, `events`, `automations` refs and `dependsOn`. Never rename `permissions` or `flag`. |
| `permissions.ts`, `settings.ts`, `nav.ts` | per §15.1 | registry | See §3.4 for settings. |
| `events.ts` | `handlers: HandlerReg[]` | `src/lib/events.ts` processor | `interface HandlerReg { event: EventType \| '*'; name: string /* '<module>.<what>', unique */; run(e: DomainEvent<any>, ctx: { tx: Tx }): Promise<void> }`. Each handler runs in its own transaction. **Handlers must be idempotent**, because an event is retried until every handler succeeds. |
| `cron.ts` | `cronHooks: CronHook[]` | `api/cron/tick` | `interface CronHook { key: string; schedule: { everyMinutes: number } \| { dailyAt: 'HH:MM' } \| { weeklyAt: { day: 0-6; time: 'HH:MM' } } \| { monthlyAt: { day: 1-28; time: 'HH:MM' } }; run(ctx: { now: Date; lastRunAt: Date \| null }): Promise<void> }`. Times are in the company TZ. F guarantees at most one run per window using `scheduler_state` `cron:<key>`. |
| `workers.ts` | `workers: Partial<Record<JobQueueKind, (payload: any, ctx: { attempt: number }) => Promise<void>>>` | `job_queue` runner | Kinds are listed in §8.2. |
| `ai.ts` | `aiHandlers: Partial<Record<AiTaskKind, (task: AiTaskRow, output: unknown) => Promise<void>>>` | AI queue | Results are routed by `ai_tasks` ref `module` (parts, vehicles, tools). |
| `offline.ts` (client-safe) | `offlineActions: Record<string, (input: any) => Promise<ActionResult<any>>>` | `src/client/offline-registry.ts` | Present only in: jobs, time, payments, parts, payroll, vehicles, tools. Keys are `'<module>.<action>'`. |
| `badges.ts` | `badges: Record<string, (u: SessionUser) => Promise<number>>` | nav (TabBar, Sidebar, More) | Keys are in Appendix D. |
| `approval-kinds.tsx` | `approvalKinds: ApprovalKindDef[]` (§6.10) | `src/features/approvals/registry.ts` (B6) | Present only in jobs, parts, payroll, vehicles. |
| `seed.ts` | `seedDemo(db: DB, ctx: DemoSeedCtx): Promise<void>` | `src/db/seed/demo.ts` | Order is in §10. |
| `contracts.ts` | types only (no runtime) | — | Props and DTO types of §5 and §6. Importable from client code. |
| `api.ts` | server functions (§6) | — | Has `import 'server-only'`. **Never `'use server'`.** These functions take a `tx` and skip perm checks, so they must never be exposed as actions. |
| `slots.tsx` / `slots.client.tsx` | UI slots (§5) | — | F stubs return `<SlotPlaceholder name="…"/>`. |
| `src/features/automations/builtin/index.ts` (B5) | `builtinAutomations: AutomationSeed[]`, `builtinTemplates: TemplateSeed[]` | F base seed | All of §7.3 plus Appendix B. Stub: `[]`. |
| `src/features/customers/search.ts` (B1) | `globalSearch(q, viewer, limit?)` | F shell ⌘K and search fields | Stub: `[]`. |
| `src/features/settings/api.ts#getBrandingStyle` (B8) | `() => Promise<string>` | root layout | Stub: `''`. |

Satellite dirs (`tasks`, `time`, `pricebook`, `signatures`, `approvals`) may have `events.ts`, `cron.ts`, `workers.ts`, `badges.ts`, `seed.ts`, `offline.ts` (time only), `contracts.ts`, `api.ts` and `slots*.tsx`. F's aggregators include them explicitly.


---

## 5. Cross-module UI slot contracts

### 5.0 Conventions (all slots)
- **Server slots** live in `src/features/<m>/slots.tsx`. Each is an `async` Server Component that:
  - takes ids, never pre-fetched objects;
  - calls `getCurrentUser()` itself;
  - checks its own permission, row scope and feature flag, and returns `null` when the viewer may not see it or the flag is off.
  - The consumer never has to gate a slot.
- **Client slots** live in `src/features/<m>/slots.client.tsx` (`'use client'`). They:
  - take serializable props;
  - call only the **producer's own** server actions;
  - lazy-load heavy parts (sheets, the signature pad, compare).
- **Props types** are exported from the producer's `contracts.ts` with the exact names below. A producer may add **optional** props, never required ones.
- **Slots never navigate the host page.** After a mutation they rely on `refresh()` inside the producer's action. The producer's action also revalidates the consumer paths it knows about: `/jobs/[id]`, `/customers/[id]`, `/today`, `/invoices/[id]`.
- **List-row widgets** (chips or rings on many rows) must not use per-row server slots. Consumers render the UI-kit presentational component (`RiskChip`, `ReadinessRing`, `StatusPill`, `MoneyText`) from columns they already selected, or use the producer's batch API (§6).

### 5.1 Slot catalog

| # | Export | File | S/C | Producer | Consumers | Behavior |
|---|---|---|---|---|---|---|
| S1 | `CustomerCard` | `customers/slots.tsx` | S | B1 | B2 job overview and Today hero, B3 estimate/invoice detail, B4 dispute detail, B5 thread header, B1 lead detail | Name, type, flag chips (do-not-service, prepay, dispute history, VIP, tax-exempt, do-not-text), returning badge, and balance (if `invoices.view`). Contact is masked for techs outside the active window (§4.2). Call is logged then `tel:`; Text links to `/messages/[id]`. Writes the `customer.viewed` audit for tech views. |
| S2 | `PropertyCard` | `customers/slots.tsx` | S | B1 | B2 job overview and Today hero | Address, Navigate deep link (Apple or Google by UA), access notes, pets, site contact, equipment custom fields. The gate code is decrypted only inside the window. |
| S3 | `CustomerPicker` | `customers/slots.client.tsx` | C | B1 | B2 `/jobs/new`, B3 `/estimates/new`, B5 new message, B1 lead convert | Search plus select customer and property. Optional inline quick-create (B1 action `quickCreateCustomer`) with duplicate prompt. Emits hidden inputs `${name}.customerId` and `${name}.propertyId`. |
| S4 | `CustomerJobsPanel` | `jobs/slots.tsx` | S | B2 | B1 customer detail | Upcoming and past jobs, status pills, "New job" link `/jobs/new?customerId=`. |
| S5 | `NotesPanel` | `jobs/slots.tsx` | S | B2 | B1 customer and lead detail, B2 job | Pinned first. An add-note form (internal or customer-visible) works offline through the outbox. |
| S6 | `TimeEntriesSection` | `time/slots.tsx` | S | B2 | B8 `/team/[id]` | Recent entries. Edit with reason when the viewer has `time.manage`. |
| S7 | `ReassignJobsList` | `jobs/slots.tsx` | S | B2 | B8 deactivate flow | The user's open jobs with an inline reassign (uses `AssignJobButton`). |
| S8 | `PortalJobActions` | `jobs/slots.client.tsx` | C | B2 | B3 `/j/[token]` | Confirm and Request reschedule (with note). B2 public actions re-validate the token and call `confirmJob` or `requestReschedule`. |
| S9 | `AssignJobButton` | `jobs/slots.client.tsx` | C | B2 | B7 map job sheet, B8 Ops Today unassigned list, S7 | Assign sheet: techs with conflict hints, window, split. Calls the B2 `assignJob` action. |
| S10 | `JobEstimatePanel` | `estimates/slots.tsx` | S | B3 | B2 job **Estimate** tab | Estimates and change orders for the job with status, "New estimate" and "Change order" (shown when `getChangeOrderStatus().thresholdExceeded`). Opens the builder route. |
| S11 | `JobInvoicePanel` | `invoices/slots.tsx` | S | B3 | B2 job **Invoice** tab | Invoice summary, lines, totals, status, and Issue, Revise, Send, Print. A photos toggle hosts S25. |
| S12 | `CustomerEstimatesPanel` | `estimates/slots.tsx` | S | B3 | B1 customer detail | Open and unsold estimates. |
| S13 | `CustomerInvoicesPanel` | `invoices/slots.tsx` | S | B3 | B1 customer detail | Open invoices, balance, and a statement link `/invoices/statement/[customerId]`. |
| S14 | `PricebookPicker` | `pricebook/slots.client.tsx` | C | B3 | B6 AddPart sheet, B3 builders | Searchable sheet. Calls `onPick(PricebookPick)`. |
| S15 | `SignatureSheet` | `signatures/slots.client.tsx` | C | B3 | B2 completion and ownership, B6 statement ack and comp agreement, B7 tool agreement and handoff, B3 own | ESIGN consent checkbox, typed name, and the UI-kit `SignaturePad`. Uploads the PNG via `queueUpload` (kind `signature`), then calls the **consumer's** server action passed as the `action` prop. |
| S16 | `JobPaymentsPanel` | `payments/slots.tsx` | S | B4 | B2 job **Invoice** tab (under S11) | Payments, deposits, refunds, verify state, and a Collect button. |
| S17 | `CustomerPaymentsPanel` | `payments/slots.tsx` | S | B4 | B1 customer detail | Payments history and a Record payment button. |
| S18 | `DepositChip` | `payments/slots.tsx` | S | B4 | B2 job header | "Deposit required $X" or "Deposit $X paid {date}". |
| S19 | `CollectPaymentButton` | `payments/slots.client.tsx` | C | B4 | B2 action bar (completed), B3 invoice detail, S16 | Collect-payment sheet: balance and prior deposit, method tiles (Card: pay-link QR or send link; Cash, Check, Zelle, Venmo), tip presets, split payments, check photo and reference rules, overpayment guard, risk-based card restrictions. Offline-capable for manual methods. |
| S20 | `RecordPaymentButton` | `payments/slots.client.tsx` | C | B4 | B1 customer detail | Pick an open invoice, then the same sheet. |
| S21 | `JobRiskChip` | `disputes/slots.tsx` | S | B4 | B2 job header | Band chip plus a "why" sheet listing signals (§11.1). |
| S22 | `JobReadinessRing` | `disputes/slots.tsx` | S | B4 | B2 job header and Complete sheet | Ring plus missing items (§11.2). |
| S23 | `JobPhotosPanel` | `media/slots.tsx` | S | B4 | B2 job **Photos** tab | Grid by tag, viewer, captions, star `include_in_invoice`, before/after compare slider (lazy), soft delete (`photos.delete`, blocked when evidence-locked), flags. Contains S24. |
| S24 | `CameraCaptureButton` | `media/slots.client.tsx` | C | B4 | B2 action bar (Before or After photos, cancel-after-arrival photo), S23 | Wraps the UI-kit `CameraButton` with job context and allowed tags. The before/after segments are hidden when the `before_after` flag is off. Upload goes through `queueUpload`. |
| S25 | `PhotoPicker` | `media/slots.client.tsx` | C | B4 | B3 invoice photo selection, estimate "photos of the problem" | Choose and order job photos. Emits hidden inputs `${name}[]`. |
| S26 | `InvoicePhotoGrid` | `media/slots.tsx` | S | B4 | B3 invoice print, `/i/[token]`, receipt view | Applies `selectInvoicePhotos` (cascade, §M11). The invoice variant is a 2-up grid of up to 8 with Before/After captions and a stamped CSS overlay; the receipt variant is a strip of up to 4; the portal variant shows all starred photos. Works on public pages via the `tokenId` prop (no session). |
| S27 | `PortalPhotoGallery` | `media/slots.tsx` | S | B4 | B3 `/j/[token]` | Starred photos full-size; validated by `tokenId`. |
| S28 | `ReceiptFlagButton` | `payments/slots.client.tsx` | C | B4 | B3 `/i/[token]?receipt=` | "Wrong amount? / I didn't pay this". The B4 public action emits `payment.customer_flagged`. |
| S29 | `MessageComposer` | `messaging/slots.client.tsx` | C | B5 | B1 customer and lead detail, B2 job **Messages** tab, B5 thread | Channel picker, template picker with variable preview, GSM segment counter, consent warning with manual override. Calls `enqueueMessage`; in link mode it hands off to the outbox card. |
| S30 | `JobMessagesPanel` | `messaging/slots.tsx` | S | B5 | B2 job **Messages** tab | Thread filtered to the job, scheduled sends for the job (with cancel), and the composer. |
| S31 | `ConsentPanel` | `messaging/slots.tsx` | S | B5 | B1 customer detail | SMS status, ledger history, and a one-tap "Customer asked us to stop texting". |
| S32 | `OutboxCountBadge` | `messaging/slots.tsx` | S | B5 | B2 Today shortcuts, B8 Ops Today | "Outbox (n)" linking to `/messages/outbox`. |
| S33 | `ActivityTimeline` | `notify/slots.tsx` | S | B5 | B1 customer timeline and lead history, B2 job **History** tab, B7 vehicle and tool history, B8 team profile | Uses the UI-kit `Timeline`, grouped by day, with cursor pagination. Filter chips All, Messages, Jobs, Money, Notes (Appendix C). |
| S34 | `NotificationBell` | `notify/slots.tsx` | S | B5 | F shell nav bar | Unread count linking to `/notifications`. |
| S35 | `NotificationPreferences` | `notify/slots.tsx` | S | B5 | B8 `/settings/profile` | Push, email or off per notification type. |
| S36 | `PushEnableButton` | `notify/slots.client.tsx` | C | B5 | B8 profile and setup checklist, F install prompt | Subscribes from a user gesture (iOS standalone only). |
| S37 | `RequestReviewButton` | `reviews/slots.client.tsx` | C | B5 | B1 customer detail, B2 job (office view only; **never rendered for `baseRole === 'tech'`**) | Needs `reviews.send_manual`. Enforces the two-ask limit and eligibility. |
| S38 | `JobPartsPanel` | `parts/slots.tsx` | S | B6 | B2 job **Parts** tab | Part lines with source badge, tech-paid receipt status, unbilled flags, AddPart. |
| S39 | `AddPartButton` | `parts/slots.client.tsx` | C | B6 | B2 action bar (`in_progress` Parts; `on_hold` "Order part" with `mode='special_order'`) | Sheet: truck stock (inventory on), price book (S14), "bought it now" (tech-paid, receipt photo), company card (receipt required). Adds the line via B3 `addJobLine`; special order calls B4 `ensureDepositRequest` and `markSpecialOrderPo`. |
| S40 | `JobEarningsPanel` | `payroll/slots.tsx` | S | B6 | B2 job overview | Financials with `jobs.view_financials`, or the viewer's own earnings line with the "Why this amount?" trace (§10.5). |
| S41 | `CashOnHandPill` | `payroll/slots.tsx` | S | B6 | B2 Today header | Custody amount, links to the remit flow on `/pay`. |
| S42 | `MyEarningsCard` | `payroll/slots.tsx` | S | B6 | B8 tech insights, B2 Today (optional) | Live period earnings, pending reimbursements, statement to acknowledge. |
| S43 | `TechCompSection` | `payroll/slots.tsx` | S | B6 | B8 `/team/[id]` | Plan assignment, overrides including cash settlement, agreement status, bank status (last 4 only for `payroll.payout`). |
| S44 | `CashCheckSection` | `payroll/slots.tsx` | S | B6 | B2 `/today/finish` | System cash and checks held vs a declared count. A discrepancy note emits `cash.discrepancy_declared`. |
| S45 | `UnreceiptedPartsSection` | `parts/slots.tsx` | S | B6 | B2 `/today/finish` | Today's tech-purchased lines without a receipt, each with an upload CTA. |
| S46 | `TodayVehicleCard` | `vehicles/slots.tsx` | S | B7 | B2 Today | Assigned vehicle, Log odometer shortcut, inspection due (start of day), reminders and issues. Returns null when the flag is off or `!usesCompanyVehicle` with no vehicle. |
| S47 | `TodayToolCard` | `tools/slots.tsx` | S | B7 | B2 Today | "Tool check" when an audit is due, plus maintenance due. Returns null when the flag is off or `!usesCompanyTools`. |
| S48 | `OdometerCaptureButton` | `vehicles/slots.client.tsx` | C | B7 | B2 clock in and out | Photo plus typed value; creates `odometer_readings` (source `clock`). `onRecorded(odometerReadingId)` lets B2 store `time_entries.in/out_odometer_id`. |
| S49 | `EndOdometerSection` | `vehicles/slots.tsx` | S | B7 | B2 `/today/finish` | End-of-day odometer prompt (wraps S48). |
| S50 | `AssignedVehicleRow` | `vehicles/slots.tsx` | S | B7 | B8 `/team/[id]` | Assigned vehicle and due items. |
| S51 | `ToolCustodyRow` | `tools/slots.tsx` | S | B7 | B8 `/team/[id]` | Tools in custody and audit status. |
| S52 | `FleetSummaryCard` | `vehicles/slots.tsx` | S | B7 | B8 admin insights | Cost per mile, fuel spend, overdue, open issues. |
| S53 | `LocationSharer` | `map/slots.client.tsx` | C | B7 | F `(app)/layout.tsx` (techs only) | While clocked in and visible: `watchPosition`, POST `/api/location` at most every 60 s, and the "Sharing location" pill. Never runs off shift. |
| S54 | `OpsToday` | `insights/slots.tsx` | S | B8 | B2 `/today` for office and admin | Office dashboard (§M20) plus the setup checklist card for admins. |
| S55 | `TagEditor` | `settings/slots.client.tsx` | C | B8 | B1 customer and lead, B2 job, B3 estimate and invoice, B7 vehicle and tool | Chips plus picker. The B8 action checks the entity's edit permission (map in §6.8). |
| S56 | `CustomFieldsFields` | `settings/slots.client.tsx` | C | B8 | B1 customer, property and lead forms; B2 job form; B7 vehicle and tool forms | Renders inputs for defs (passed in by the consumer from `getCustomFieldDefs`) inside the **consumer's** `<form>` as `custom.<key>`. The consumer validates with `validateCustomValues`. |

### 5.2 Props types (`contracts.ts` of each producer)

```ts
// B1 src/features/customers/contracts.ts
export type CustomerCardProps = { customerId: string; jobId?: string; variant?: 'full'|'compact'|'header'; showActions?: boolean };
export type PropertyCardProps = { propertyId: string; jobId?: string; variant?: 'full'|'compact' };
export type CustomerPickerProps = { name?: string /* default 'customer' */; defaultCustomerId?: string; defaultPropertyId?: string;
  allowCreate?: boolean; requireProperty?: boolean; onChange?: (v: { customerId: string; propertyId: string|null }) => void };

// B2 src/features/jobs/contracts.ts (+ time/contracts.ts)
export type CustomerJobsPanelProps = { customerId: string; limit?: number };
export type NotesPanelProps = { entity: EntityRef; customerId?: string; jobId?: string; allowCustomerVisible?: boolean };
export type TimeEntriesSectionProps = { userId: string; days?: number };
export type ReassignJobsListProps = { userId: string };
export type PortalJobActionsProps = { token: string; jobId: string; status: JobStatus; confirmedAt: string|null };
export type AssignJobButtonProps = { jobId: string; label?: string; variant?: 'filled'|'tinted'|'gray'|'plain' };

// B3 estimates/contracts.ts, invoices/contracts.ts, pricebook/contracts.ts, signatures/contracts.ts
export type JobEstimatePanelProps = { jobId: string };
export type JobInvoicePanelProps = { jobId: string };
export type CustomerEstimatesPanelProps = { customerId: string };
export type CustomerInvoicesPanelProps = { customerId: string };
export type PricebookPick = { id: string; kind: 'service'|'labor'|'part'|'material'|'fee'; sku: string|null; name: string;
  description: string|null; unitPriceCents: number; unitCostCents: number|null; taxable: boolean; isSpecialOrder: boolean;
  warrantyDays: number|null; manufacturerWarrantyMonths: number|null };
export type PricebookPickerProps = { kinds?: PricebookPick['kind'][]; onPick: (item: PricebookPick) => void; triggerLabel?: string };
export type SignatureSubmit = { signerName: string; esignConsent: true; signatureMediaId: string; geo?: Geo|null; deviceTs: string; clientId: string };
export type SignatureSheetProps = { title: string; docType: SignatureDocType; consentText: string; summaryLines?: string[];
  signerNameDefault?: string; publicToken?: string /* remote signing: upload via /api/uploads/public/presign */;
  action: (input: SignatureSubmit) => Promise<ActionResult<{ signatureId: string }>>; triggerLabel?: string; doneHref?: string };

// B4 payments/contracts.ts, disputes/contracts.ts, media/contracts.ts
export type JobPaymentsPanelProps = { jobId: string };
export type CustomerPaymentsPanelProps = { customerId: string };
export type DepositChipProps = { jobId: string };
export type CollectPaymentButtonProps = { jobId?: string; invoiceId?: string; label?: string; variant?: 'filled'|'tinted'|'gray';
  size?: 'md'|'lg'; fullWidth?: boolean; allowDeposit?: boolean };
export type RecordPaymentButtonProps = { customerId: string; invoiceId?: string };
export type JobRiskChipProps = { jobId: string; showWhy?: boolean };
export type JobReadinessRingProps = { jobId: string; size?: number; showWhy?: boolean };
export type JobPhotosPanelProps = { jobId: string; canCapture?: boolean };
export type CameraCaptureButtonProps = { jobId?: string; entity?: EntityRef; kind?: MediaKind; defaultTag?: MediaTag;
  allowedTags?: MediaTag[]; label?: string; multiple?: boolean; onQueued?: (m: { clientId: string }) => void };
export type PhotoPickerProps = { jobId: string; name: string; selected: string[]; max?: number; tags?: MediaTag[] };
export type InvoicePhotoGridProps = { invoiceId: string; variant: 'invoice'|'receipt'|'portal'; tokenId?: string };
export type PortalPhotoGalleryProps = { jobId: string; tokenId: string };
export type ReceiptFlagButtonProps = { token: string; paymentId: string };

// B5 messaging/contracts.ts, notify/contracts.ts, reviews/contracts.ts
export type MessageComposerProps = { customerId: string; jobId?: string; leadId?: string;
  defaultChannel?: 'sms'|'whatsapp'|'email'; templateKeys?: string[]; compact?: boolean };
export type JobMessagesPanelProps = { jobId: string };
export type ConsentPanelProps = { customerId: string };
export type OutboxCountBadgeProps = { scope?: 'mine'|'all' };
export type TimelineFilter = 'all'|'messages'|'jobs'|'money'|'notes';
export type ActivityTimelineProps = { customerId?: string; jobId?: string; entity?: EntityRef; filter?: TimelineFilter;
  showFilterChips?: boolean; limit?: number };
export type NotificationPreferencesProps = { userId: string };
export type RequestReviewButtonProps = { jobId?: string; customerId?: string /* → latest completed job */ };

// B6 parts/contracts.ts, payroll/contracts.ts
export type JobPartsPanelProps = { jobId: string };
export type AddPartButtonProps = { jobId: string; mode?: 'any'|'stock'|'pricebook'|'tech_paid'|'company_card'|'special_order'; label?: string };
export type JobEarningsPanelProps = { jobId: string };
export type CashOnHandPillProps = { userId: string };
export type MyEarningsCardProps = { userId: string };
export type TechCompSectionProps = { userId: string };
export type CashCheckSectionProps = { userId: string };
export type UnreceiptedPartsSectionProps = { userId: string; date?: string };

// B7 vehicles/contracts.ts, tools/contracts.ts, map/contracts.ts
export type TodayVehicleCardProps = { userId: string };
export type TodayToolCardProps = { userId: string };
export type OdometerCaptureButtonProps = { vehicleId: string; source: 'clock'|'manual'; label?: string;
  onRecorded?: (odometerReadingId: string) => void };
export type EndOdometerSectionProps = { userId: string };
export type AssignedVehicleRowProps = { userId: string };
export type ToolCustodyRowProps = { userId: string };
export type FleetSummaryCardProps = { from: string; to: string /* YYYY-MM-DD company TZ */ };
export type LocationSharerProps = Record<string, never>;

// B8 insights/contracts.ts, settings/contracts.ts
export type OpsTodayProps = Record<string, never>;
export type TagTarget = 'customer'|'job'|'lead'|'estimate'|'invoice'|'vehicle'|'tool';
export type TagEditorProps = { entityType: TagTarget; entityId: string; initial?: { id: string; name: string; color: string }[] };
export type CustomFieldDef = { key: string; label: string; type: 'text'|'number'|'money'|'date'|'select'|'multiselect'|'boolean'|'photo';
  options?: string[]; required: boolean; showOnInvoice: boolean };
export type CustomFieldsFieldsProps = { defs: CustomFieldDef[]; values: Record<string, unknown>; namePrefix?: string /* default 'custom' */;
  jobId?: string /* for photo fields */ };
```

### 5.3 Composition maps (who renders what where)

**`/jobs/[id]` (B2).** Tabs come from `?tab=overview|photos|estimate|invoice|parts|messages|history`. The office view shows tabs. The tech view is a single scroll with a sticky action bar, plus links to the same sections.

| Region | Content |
|---|---|
| Header | Status pill (B2), S21 `JobRiskChip`, S22 `JobReadinessRing`, S18 `DepositChip`, payment status (B2 column), window, assignees, evidence-pack link `/jobs/[id]/evidence` (if `evidence.view`) |
| Overview | S1 `CustomerCard` (`jobId`), S2 `PropertyCard`, checklist (B2), S5 `NotesPanel`, S56 custom fields, S55 tags, callback and warranty info (B2), S40 `JobEarningsPanel`, S37 `RequestReviewButton` (office only) |
| Photos | S23 `JobPhotosPanel` |
| Estimate | S10 `JobEstimatePanel` |
| Invoice | S11 `JobInvoicePanel`, then S16 `JobPaymentsPanel` |
| Parts | S38 `JobPartsPanel` |
| Messages | S30 `JobMessagesPanel` |
| History | S33 `ActivityTimeline` (`jobId`), plus B2's own geostamped status-event list |

**Tech action bar (B2) → producers.**
- `scheduled`/`confirmed`: On my way (B2, ETA chips), Call (logged via B1 `logCall`), Text (S29), Navigate.
- `en_route`: Arrived (B2), Running late (B2).
- `arrived`: Start job (B2 guards plus B4 `evaluateTransitionControls`), Before photos (S24), Estimate (`/estimates/new?jobId=`).
- `in_progress`: Complete (a B2 sheet showing S22 items, B4 control misses, the checklist, and S15 for the completion signature), Photos (S24), Parts (S39), Estimate or change order (B3 routes), Checklist, Notes, Hold.
- `completed`: Collect payment (S19), Invoice (tab), Send receipt (B4 action), Next job.
- `on_hold`: Schedule return visit (B2), Order part (S39 `special_order`), Notes, Photos.

**`/customers/[id]` (B1).**
- Header: S1 (`variant='header'`) with quick actions:
  - New job → `/jobs/new?customerId=`
  - New estimate → `/estimates/new?customerId=`
  - Text → `/messages/[id]`
  - Call (B1)
  - Email (`mailto:`, logged by B1)
  - S37 request review
  - Add note (S5)
  - Add property (B1)
  - S20 record payment
  - Statement → `/invoices/statement/[id]`
- Then B1's properties list, S33 timeline (customer, with chips), S4 jobs, S12 estimates, S13 invoices, S17 payments, S31 consent, S55 tags, S56 custom fields.
- Flags, merge and anonymize (B1).

**`/today` (B2).**
- `baseRole === 'tech'`: My Day, built by B2:
  - greeting, clock toggle (S48 when `vehicles.require_odometer_on_clock`), S41 cash pill
  - next-job hero (S1 compact plus S2 compact plus Navigate and On my way)
  - remaining timeline, own tasks
  - shortcuts: S46, S47, S32, Upload receipt → `/parts?new=receipt`
  - a "Finish my day" link to `/today/finish`
- Otherwise B2 renders S54 `<OpsToday/>`.
- `/today/finish` (B2) runs in order:
  1. unsynced offline items (B2 outbox state)
  2. unsent outbox cards (S32 with count)
  3. jobs left `in_progress`/`en_route` (B2)
  4. S44 `CashCheckSection`
  5. S45 `UnreceiptedPartsSection`
  6. S49 `EndOdometerSection`
  7. Clock out (B2, emits `time.clocked_out`)

**`/j/[token]` (B3).** Tech card (UI-kit `TechCard` fed by B8 `getUserBriefs`), status and window, S8 `PortalJobActions`, estimate link (B3), invoice and pay button (B3 mints a `pay` token, then `/p/`), S27 `PortalPhotoGallery`, contact footer.

**`/team/[id]` (B8).** Profile, role and status, overrides (B8), S43 `TechCompSection`, S6 `TimeEntriesSection`, S50 `AssignedVehicleRow`, S51 `ToolCustodyRow`, S33 timeline (entity user, optional), and on deactivate, S7 `ReassignJobsList`.

**`/approvals` (B6).** It renders each pending row with the `Row` and `Detail` components of the matching `ApprovalKindDef`, which comes from the four `approval-kinds.tsx` files (§6.10). It shows only kinds whose `perm` the viewer holds.

**Shell (F).** It mounts S34 `NotificationBell`, S53 `LocationSharer` (techs), badges (§4, Appendix D) and ⌘K `globalSearch` (B1).

---

## 6. Cross-module server API contracts

### 6.0 Conventions (all api.ts)
- Each lives at `src/features/<m>/api.ts` with `import 'server-only'`. **Never `'use server'`.** Types are re-exported from `contracts.ts`.
- **Writes take `tx: Tx` first and `actor: Actor` last.** They run inside the **caller's** transaction. They must not open their own transaction or call `after()`.
- **Reads take no tx.** They use `db`, or an optional trailing `{ tx }`.
- **No permission checks**, unless the function takes a `viewer`/`user: SessionUser` or is named `assert*`. The caller has already called `requireUser(perm)` in its `action()`.
- **A producer's write function emits the producer's own events and writes its own activity and audit rows.** The caller must not emit them again.
- Errors are thrown from `src/lib/errors.ts`. Callers inside `action()` let them propagate, and `action()` maps them to `{ ok:false }`.
- Every function has a **stub level** (§0). F creates all of them with the exact signatures below, and the producer replaces the bodies.

### 6.1 B1: customers, leads

```ts
// src/features/customers/api.ts
export type CustomerType = 'residential'|'commercial'|'property_manager'|'home_warranty';
export type SmsStatus = 'unknown'|'transactional'|'marketing'|'opted_out';
export interface AddressInput { street: string; unit?: string|null; city: string; state: string; zip: string;
  lat?: number|null; lng?: number|null; label?: string|null }
export interface FindOrCreateCustomerInput {
  displayName?: string|null; firstName?: string|null; lastName?: string|null; companyName?: string|null;
  phone?: string|null;   // any format → E.164 (region US); invalid → null + warning
  email?: string|null;   // lower-cased
  type?: CustomerType; address?: AddressInput|null;
  leadSourceId?: string|null; source?: string|null; firstTouch?: Record<string, unknown>|null; isTest?: boolean;
}
export interface FindOrCreateCustomerResult { customerId: string; created: boolean; matchedBy: 'phone'|'email'|null;
  propertyId: string|null; propertyCreated: boolean; warnings: string[] }
/** Match by E.164 (phone or phone_alt), then email. Never merges, never overwrites non-empty fields (fills blanks).
 *  Property matched by normalized street+zip else created; new properties get timezone from zip-tz and a 'geocode'
 *  job. Emits customer.created on create. Consumers: B1 intake/import/manual, B3 portal (none), B2 none. stub M */
export function findOrCreateCustomer(tx: Tx, input: FindOrCreateCustomerInput, actor: Actor): Promise<FindOrCreateCustomerResult>;
export function findCustomerMatch(q: { phone?: string|null; email?: string|null }):
  Promise<{ customerId: string; matchedBy: 'phone'|'email' }|null>;                                      // stub F
export function ensureProperty(tx: Tx, customerId: string, address: AddressInput, actor: Actor):
  Promise<{ propertyId: string; created: boolean }>;                                                       // stub M
/** customers.view_all, or a tech with an assigned job for the customer. Throws ForbiddenError. */
export function assertCustomerAccess(user: SessionUser, customerId: string, mode: 'read'|'write'): Promise<void>; // stub M
export interface CustomerBrief { id: string; displayName: string; firstName: string|null; type: CustomerType;
  phone: string|null; phoneMasked: string|null; email: string|null; contactRevealed: boolean;
  preferredChannel: 'sms'|'whatsapp'|'email'|'call'; smsStatus: SmsStatus;
  flags: { doNotService: boolean; prepayRequired: boolean; disputeHistory: boolean; vip: boolean; taxExempt: boolean;
           doNotText: boolean; doNotContact: boolean }; balanceCents: number|null; tags: { id: string; name: string; color: string }[] }
/** Viewer-aware (masking §4.2 via B2 getContactWindowJob). null when not visible. */
export function getCustomerBrief(customerId: string, viewer: SessionUser, opts?: { jobId?: string }): Promise<CustomerBrief|null>; // stub M (no masking)
export interface PropertyBrief { id: string; customerId: string; label: string|null; street: string; unit: string|null;
  city: string; state: string; zip: string; addressShort: string; lat: number|null; lng: number|null; timezone: string|null;
  accessNotes: string|null; gateCode: string|null /* only when revealed */; pets: string|null;
  siteContactName: string|null; siteContactPhone: string|null }
export function getPropertyBrief(propertyId: string, viewer: SessionUser, opts?: { jobId?: string }): Promise<PropertyBrief|null>; // stub M
/** System setters (caller checked perms). Audited; emit customer.updated. */
export function setCustomerFlags(tx: Tx, customerId: string, patch: Partial<{ doNotService: boolean; prepayRequired: boolean;
  disputeHistory: boolean; vip: boolean; taxExempt: boolean; doNotText: boolean; doNotContact: boolean }>,
  actor: Actor, reason?: string): Promise<void>;                                                           // stub F; B4 (dispute), B5 (do_not_text)
export function addCardFingerprint(tx: Tx, customerId: string, fingerprint: string): Promise<void>;        // stub F; B4
export function setCustomerSmsStatus(tx: Tx, customerId: string, status: SmsStatus): Promise<void>;       // stub F; ONLY B5 recordConsent
export function incrementWaivedFeeCount(tx: Tx, customerId: string, actor: Actor): Promise<void>;     // added at integration; B2 cancel flow
export function contactRevealedFor(viewer: SessionUser, customerId: string): Promise<{ revealed: boolean; windowJobId: string|null }>; // added at integration (B1 export); B5 masking + texting window
export function logCall(tx: Tx, input: { customerId?: string|null; leadId?: string|null; jobId?: string|null; userId: string;
  direction: 'out'|'in'; outcome: 'connected'|'no_answer'|'voicemail'|'wrong_number'|'busy'; notes?: string|null },
  actor: Actor): Promise<{ callId: string }>;            // stub F; activity 'call.logged'; B2 action bar, B1 cards

// src/features/customers/search.ts
export type SearchHit = { type: 'customer'|'job'|'invoice'|'estimate'|'lead'; id: string; title: string; subtitle: string; href: string };
export function globalSearch(q: string, viewer: SessionUser, limit?: number): Promise<SearchHit[]>; // stub F ([]); F shell ⌘K
// Matches name/phone (any format → E.164)/email/address/job #/invoice #; row-scoped for techs; < 150 ms @ 50k customers.

// src/features/leads/api.ts
export interface LeadPrefill { leadId: string; customerId: string|null; propertyId: string|null; serviceTypeId: string|null;
  serviceText: string|null; quotedPriceCents: number|null; preferredDate: string|null; preferredWindow: string|null;
  notes: string|null; leadSourceId: string|null;
  kind: JobKind|null; priority: 'normal'|'urgent'|'emergency'|null; afterHours: boolean } // leads flow: typed on the call (leads.extra._booking)
export function getLeadPrefill(leadId: string, viewer: SessionUser): Promise<LeadPrefill|null>;        // stub M; B2 /jobs/new, B3 /estimates/new, booking
/** status → booked, converted_job_id / converted_estimate_id; emits lead.converted + lead.status_changed. Idempotent.
 *  Leads flow: also writes the status lead_event ({from, to, prev}), so Reopen and Undo can go back. */
export function markLeadConverted(tx: Tx, leadId: string, to: { jobId?: string; estimateId?: string }, actor: Actor): Promise<void>; // stub M; B2, B3
/** Sets first_response_at/by once; emits lead.responded. Idempotent. (B1 also calls it from its message.sent handler.) */
export function markLeadResponded(tx: Tx, leadId: string, by: { userId: string; channel: 'call'|'sms'|'whatsapp'|'email' },
  actor: Actor): Promise<void>;                                                                           // stub M
export function getDefaultBookingLink(): Promise<string|null>;  // `${APP_URL}/f/<pk>` of the default website source; stub F (null); B5 booking.link

// src/features/leads/ensure-customer.ts (leads flow redesign; a plain server module, never a server action)
/** The customer (+ property) for a lead that has none yet: Looks legit, Not spam, convert, bookLead. */
export function ensureLeadCustomer(tx: Tx, lead: LeadRow|string, actor: Actor): Promise<{ customerId: string|null; propertyId: string|null }>;
// src/features/customers/api.ts (leads flow redesign)
/** Edit lead's phone/email fix: changes the customer only where it still has the lead's old value. */
export function updateContactFromLead(tx: Tx, customerId: string, change: { oldPhone?: string|null; newPhone?: string|null;
  oldEmail?: string|null; newEmail?: string|null }, actor: Actor): Promise<{ fields: ('phone'|'email')[] }>;
```

### 6.2 B2: jobs, tasks, time, notes

```ts
// src/features/jobs/api.ts
export type JobStatus = 'unscheduled'|'scheduled'|'confirmed'|'en_route'|'arrived'|'in_progress'|'on_hold'|'completed'|'closed'|'cancelled';
export type PaymentStatus = 'none'|'deposit_paid'|'partial'|'paid'|'refunded'|'disputed';
export type RiskBand = 'low'|'medium'|'high'|'critical';
export interface CreateJobInput { customerId: string; propertyId: string; serviceTypeId?: string|null; title: string;
  description?: string|null; customerNotes?: string|null; priority?: 'normal'|'urgent'|'emergency'; afterHours?: boolean;
  leadId?: string|null; estimateId?: string|null; windowStart?: Date|null; windowEnd?: Date|null;
  scheduledStart?: Date|null; scheduledEnd?: Date|null;
  assignees?: { userId: string; role: 'primary'|'helper'; splitBps: number }[];
  callbackOfJobId?: string|null; callbackReason?: 'workmanship'|'part'|'customer'|'other'|null;
  recurrence?: { every: 'weeks'|'months'; n: number; until?: string }|null; custom?: Record<string, unknown> }
/** Number via counters('job'); snapshots cancellation policy + service-fee disclosure; status 'scheduled' when
 *  window + ≥1 assignee, else 'unscheduled'. Emits job.created (+ job.scheduled, job.assigned, job.callback_created).
 *  If leadId: calls B1 markLeadConverted. Consumers: B1 lead convert (via /jobs/new), B3 estimate approval w/o job. */
export function createJob(tx: Tx, input: CreateJobInput, actor: Actor): Promise<{ jobId: string; number: string; status: JobStatus }>; // stub M
/** Leads flow redesign (bookLead): one company-local arrival window, the job type (a trade job, else the kind's own row;
 *  must match `kind`), priority, after-hours, customer notes, custom.requested_date/_window, and NO assignees: the job
 *  stays 'unscheduled' with its window ("needs a tech") until the Assign hub sets a tech (job.scheduled). */
export function createBookedJob(tx: Tx, input: { leadId: string; customerId: string; propertyId: string; kind: JobKind;
  serviceTypeId: string|null; serviceText?: string|null; date: string; start: string; end: string;
  priority: 'normal'|'urgent'|'emergency'; afterHours: boolean; customerNotes: string|null;
  requestedDate?: string|null; requestedWindow?: string|null }, actor: Actor): Promise<{ jobId: string; number: string; status: JobStatus; title: string }>;
// src/features/jobs/service-types.ts (re-exported from queries.ts): job types for pickers; no auth inside, callers check access
export function listServiceTypeOptions(opts?: { includeInactive?: boolean; tx?: Tx }): Promise<ServiceTypeOption[]>;
// src/features/jobs/availability/index.ts: booking availability (rules in SPEC M05 "Booking availability")
export function getAvailability(input: AvailabilityInput): Promise<DayAvailability[]>;            // leads booking (week strip)
export function getDayAvailability(input: Omit<AvailabilityInput, 'from'|'to'|'withWindows'>, date: string): Promise<DayAvailability|null>;
export function getTechWorkDays(date: string): Promise<Record<string, { shifts: TimeSpan[]; blocks: TimeSpan[] }>>; // Assign hub ranking
export interface JobView { id: string; number: string; status: JobStatus; paymentStatus: PaymentStatus; customerId: string;
  propertyId: string; serviceTypeId: string|null; serviceTypeName: string|null; leadId: string|null; estimateId: string|null;
  title: string; priority: 'normal'|'urgent'|'emergency'; afterHours: boolean;
  scheduledStart: Date|null; scheduledEnd: Date|null; windowStart: Date|null; windowEnd: Date|null;
  enRouteAt: Date|null; arrivedAt: Date|null; startedAt: Date|null; completedAt: Date|null; cancelledAt: Date|null;
  riskScore: number|null; riskBand: RiskBand|null; readinessScore: number|null; isCallback: boolean; callbackOfJobId: string|null;
  visitCount: number; settlementLockedAt: Date|null;
  assignees: { userId: string; name: string; role: 'primary'|'helper'; splitBps: number }[]; viewerIsAssignee: boolean }
/** jobs.view_all, or assignee with jobs.view_own. null = not visible. */
export function getJobForUser(jobId: string, user: SessionUser): Promise<JobView|null>;                    // stub M
/** 'write' = jobs.edit/status_any, or assignee with jobs.status_own. Throws Forbidden/NotFound. All slot producers use it. */
export function assertJobAccess(user: SessionUser, jobId: string, mode: 'read'|'write'): Promise<JobView>; // stub M
export interface JobContext extends JobView { customer: { id: string; displayName: string; firstName: string|null; phone: string|null;
  email: string|null; preferredChannel: string; smsStatus: string }; property: PropertyBrief; primaryTechId: string|null }
/** System read, no perms: handlers, templates, engines. */
export function getJobContext(jobId: string): Promise<JobContext|null>;                                     // stub M
// Cache-column setters (owner-listed callers only). stub F.
export function setJobPaymentStatus(tx: Tx, jobId: string, status: PaymentStatus): Promise<void>;          // B4
export function setJobRisk(tx: Tx, jobId: string, r: { score: number; band: RiskBand }): Promise<void>;     // B4
export function setJobReadiness(tx: Tx, jobId: string, score: number): Promise<void>;                     // B4
export function setJobEstimate(tx: Tx, jobId: string, estimateId: string): Promise<void>;                 // B3
export function lockJobsForSettlement(tx: Tx, jobIds: string[], settlementId: string, at: Date): Promise<void>; // B6
/** completed + invoice balance 0 (B4 getJobMoney) + (settlement locked or force) → closed; emits job.closed. */
export function closeJobIfEligible(tx: Tx, jobId: string, actor: Actor, opts?: { force?: boolean }): Promise<boolean>; // stub M; B6, B2
/** Emit job.confirmed / job.reschedule_requested; activity. Idempotent. */
export function confirmJob(tx: Tx, jobId: string, via: 'portal'|'reply'|'manual', actor: Actor): Promise<void>;        // stub M; B2 portal slot, B5 inbound 'C'
export function requestReschedule(tx: Tx, jobId: string, via: 'portal'|'reply'|'manual', note: string|null, actor: Actor): Promise<void>; // stub M; B5 inbound 'R'
/** Active contact window (§4.2): scheduled_start−2h (or en_route_at) → completed_at+24h. */
export function getContactWindowJob(userId: string, customerId: string, at?: Date): Promise<{ jobId: string; from: Date; until: Date }|null>; // stub M; B1
export interface TechDayJob { jobId: string; number: string; status: JobStatus; propertyId: string; addressShort: string;
  lat: number|null; lng: number|null; serviceTypeName: string|null; windowStart: Date|null; arrivedAt: Date|null; completedAt: Date|null }
export function getTechDay(userId: string, date: string /* YYYY-MM-DD company TZ */): Promise<TechDayJob[]>;  // stub M; B7 trips, B7 map
export function addNote(tx: Tx, input: { entity: EntityRef; customerId?: string|null; jobId?: string|null; body: string;
  visibility?: 'internal'|'customer'; pinned?: boolean; clientId?: string|null }, actor: Actor): Promise<{ noteId: string }>; // stub F
export interface HistoricalJobRow { customerId: string; propertyId: string; serviceText: string; completedOn: string;
  totalCents: number; techUserId?: string|null; notes?: string|null; externalRef?: string|null }
/** Creates status 'closed' jobs with custom.imported_total_cents (LTV/history only; no invoices). */
export function importHistoricalJobs(tx: Tx, rows: HistoricalJobRow[], actor: Actor):
  Promise<{ created: number; skipped: number; errors: { row: number; error: string }[] }>;                  // stub T; B1 import

// src/features/tasks/api.ts
export type TaskKind = 'lead_retry'|'warranty_claim'|'restock'|'callback_customer'|'refund_due'|'follow_up'|'custom';
/** assigneeUserId null → office queue (visible with tasks.view_all). Emits task.created. */
export function createTask(tx: Tx, input: { kind: TaskKind; title: string; body?: string|null; payload?: Record<string, unknown>;
  assigneeUserId: string|null; entity?: EntityRef; customerId?: string|null; jobId?: string|null; dueAt?: Date|null },
  actor: Actor): Promise<{ taskId: string }>;                         // stub F; B1 lead_retry, B4 refund_due & callback_customer, B5 callback_customer, B6 warranty_claim & restock
export function closeTasksFor(tx: Tx, q: { kind?: TaskKind; entity: EntityRef }, status: 'done'|'dismissed', actor: Actor): Promise<number>; // stub F; B6 restock transfer, B4 refund done

// src/features/time/api.ts
export function getClockStatuses(userIds: string[]): Promise<Record<string, { clockedIn: boolean; since: Date|null; timeEntryId: string|null }>>; // stub F; B7 /api/location, B8 team
export function getHoursWorked(userId: string, from: Date, to: Date): Promise<{ minutes: number;
  entries: { id: string; clockInAt: Date; clockOutAt: Date|null; breakMinutes: number }[] }>;                 // stub F; B6 W-2 floor
```

### 6.3 B3: estimates, invoices, signatures, price book

```ts
// src/features/estimates/api.ts
export function createEstimateDraft(tx: Tx, input: { customerId: string; propertyId?: string|null; jobId?: string|null;
  leadId?: string|null; title?: string|null; prefill?: { serviceTypeId?: string|null; quotedPriceCents?: number|null; notes?: string|null } },
  actor: Actor): Promise<{ estimateId: string; number: string }>;    // stub M; calls B1 markLeadConverted when leadId
/** A signed estimate/work authorization (signatures doc_type estimate|change_order with esign) exists for the job;
 *  verbal approval counts only when allowVerbal. */
export function hasSignedAuthorization(jobId: string, opts?: { allowVerbal?: boolean }): Promise<boolean>; // stub F
export interface ChangeOrderStatus { signedTotalCents: number|null; currentTotalCents: number; thresholdExceeded: boolean;
  required: boolean /* thresholdExceeded && no approved+signed CO covering the delta */; pendingChangeOrderIds: string[] }
export function getChangeOrderStatus(jobId: string): Promise<ChangeOrderStatus>;                          // stub M (required:false); B4 controls, B2 UI
export interface EstimateBrief { id: string; number: string; status: 'draft'|'sent'|'viewed'|'approved'|'declined'|'expired';
  jobId: string|null; customerId: string; totalCents: number /* recommended or max option */; sentAt: Date|null; expiresAt: Date|null }
export function getEstimateBriefs(q: { jobId?: string; customerId?: string }): Promise<EstimateBrief[]>;   // stub F

// src/features/invoices/api.ts
export type LineType = 'service'|'labor'|'part'|'material'|'fee'|'discount';
export type PartSource = 'company_stock'|'company_po'|'company_card'|'tech_purchased';
export interface LineInput { type: LineType; pricebookItemId?: string|null; name: string; description?: string|null;
  qty: number; unitPriceCents: number; unitCostCents?: number|null; discountCents?: number; taxable?: boolean;
  partSource?: PartSource|null; partPurchaseId?: string|null; warrantyDays?: number|null;
  manufacturerWarrantyMonths?: number|null; serial?: string|null; isServiceFee?: boolean; isUpsell?: boolean }
/** On create also calls B4 linkDepositsToInvoice. */
export function getOrCreateDraftInvoice(tx: Tx, jobId: string, actor: Actor): Promise<{ invoiceId: string; created: boolean }>; // stub M
/** Adds to the job's DRAFT invoice (creating it); recomputes draft totals; activity 'invoice.line_added'.
 *  Throws ConflictError('invoice_issued') when the job's invoice is issued → caller tells user to Revise. */
export function addJobLine(tx: Tx, jobId: string, line: LineInput, actor: Actor): Promise<{ lineItemId: string; invoiceId: string }>; // stub M; B6 parts, B2 cancel fee / premium lines
export function removeJobLine(tx: Tx, lineItemId: string, actor: Actor): Promise<void>;                  // stub M (draft only); B6
export interface JobLine extends LineInput { id: string; invoiceId: string; totalCents: number; invoiceStatus: string }
export function listJobLines(jobId: string): Promise<JobLine[]>;                                           // stub F; B6 parts panel + financial inputs
/** Freezes totals, status issued, due_at by customer terms, $0 → paid, locks embedded photo media (B4 lockEvidenceMedia).
 *  Emits invoice.issued{via}. Returns null when via='job_completed' and settings.invoices.auto_issue_on_complete=false. */
export function issueInvoiceForJob(tx: Tx, jobId: string, via: 'job_completed'|'manual', actor: Actor):
  Promise<{ invoiceId: string; number: string; totalCents: number }|null>;                                // stub M; B2 completion
export type InvoiceStatus = 'draft'|'issued'|'partially_paid'|'paid'|'void'|'uncollectible';
export interface InvoiceSummary { id: string; number: string; jobId: string|null; customerId: string; status: InvoiceStatus;
  version: number; issuedAt: Date|null; dueAt: Date|null; subtotalCents: number; discountCents: number; taxCents: number;
  totalCents: number; balanceCents: number }
export function getInvoiceSummary(invoiceId: string): Promise<InvoiceSummary|null>;                       // stub F
export function getInvoiceForJob(jobId: string): Promise<InvoiceSummary|null>;                           // stub F (latest non-void)
/** Recomputes invoices.status cache from B4 getInvoiceBalance; emits invoice.paid on transition to paid. Idempotent. */
export function syncInvoicePaymentState(tx: Tx, invoiceId: string, actor: Actor): Promise<{ status: InvoiceStatus; balanceCents: number }>; // stub M; B4 after every payment/refund/dispute
export function assertInvoiceAccess(user: SessionUser, invoiceId: string, mode: 'read'|'write'): Promise<InvoiceSummary>; // stub M

// src/features/signatures/api.ts
export type SignatureDocType = 'estimate'|'change_order'|'completion'|'deposit_terms'|'ownership'|'comp_agreement'|
  'tool_agreement'|'monitoring_notice'|'card_on_file'|'cooling_off_waiver'|'statement_ack';
export interface CaptureSignatureInput { docType: SignatureDocType; docId: string; docSnapshot: unknown;
  policyVersionIds?: string[]; signerName: string; signerKind: 'customer'|'user'; signerUserId?: string|null;
  customerId?: string|null; signatureMediaId?: string|null; channel: 'in_person'|'remote_link'|'verbal';
  esignConsent: boolean; consentText?: string|null; ip?: string|null; userAgent?: string|null; geo?: Geo|null;
  deviceTs?: Date|null; tokenId?: string|null }
/** doc_sha256 = sha256(canonicalJson(docSnapshot)); append-only insert; locks signature media; emits signature.captured. */
export function captureSignature(tx: Tx, input: CaptureSignatureInput, actor: Actor): Promise<{ signatureId: string; docSha256: string }>; // stub M; B2, B4, B6, B7
export function hasSignature(docType: SignatureDocType, docId: string): Promise<boolean>;                // stub F; B4 controls/readiness
export interface SignatureBrief { id: string; docType: SignatureDocType; signerName: string; channel: string; signedAt: Date; docSha256: string }
export function getLatestSignature(docType: SignatureDocType, docId: string): Promise<SignatureBrief|null>; // stub F; B4 evidence, B6

// src/features/pricebook/api.ts
export function searchPricebook(q: string, opts?: { kinds?: PricebookPick['kind'][]; limit?: number }): Promise<PricebookPick[]>; // stub F
export function getPricebookItem(id: string): Promise<PricebookPick|null>;                                // stub F
export function priceFromMarkup(unitCostCents: number): Promise<number>;   // settings.parts.markup_tiers; stub M; B6
export interface PricebookUpsertRow { sku?: string|null; name: string; kind: PricebookPick['kind']; category?: string|null;
  unitCostCents?: number|null; unitPriceCents?: number|null; taxable?: boolean; isSpecialOrder?: boolean; vendor?: string|null }
export function upsertPricebookItems(tx: Tx, rows: PricebookUpsertRow[], actor: Actor): Promise<{ created: number; updated: number }>; // stub M; B1 CSV import (match by sku, else name)
```

### 6.4 B4: payments, deposits, risk and readiness, media

```ts
// src/features/payments/api.ts
export interface InvoiceBalance { invoiceId: string; totalCents: number; paidCents: number; refundedCents: number;
  creditedCents: number; balanceCents: number }
export function getInvoiceBalance(invoiceId: string): Promise<InvoiceBalance>;          // stub F (invoice_balances view); B3, B2
export interface PaymentBrief { id: string; kind: 'deposit'|'payment'|'tip_only'; method: string; provider: string; status: string;
  amountCents: number; tipCents: number; feeCents: number; succeededAt: Date|null; collectedByUserId: string|null;
  verifiedAt: Date|null; last4: string|null; entryMode: string|null; refundedCents: number }
export interface DepositBrief { id: string; jobId: string|null; estimateId: string|null; amountCents: number;
  mode: 'capture'|'hold'|'card_on_file'|'manual'; status: string; dueAt: Date|null; paidAt: Date|null;
  policyVersionId: string|null; capWarning: string|null }
export interface JobMoney { jobId: string; invoiceId: string|null; totalCents: number; balanceCents: number; paidCents: number;
  depositPaidCents: number; paymentStatus: PaymentStatus; deposits: DepositBrief[]; payments: PaymentBrief[] }
export function getJobMoney(jobId: string): Promise<JobMoney>;                           // stub M; B2 close/finish, B6, B8
export interface RecordPaymentInput { customerId: string; invoiceId?: string|null; jobId?: string|null; depositRequestId?: string|null;
  kind: 'deposit'|'payment'|'tip_only'; method: 'cash'|'check'|'zelle'|'venmo'|'ach'|'other'; amountCents: number; tipCents?: number;
  reference?: string|null; proofMediaId?: string|null; collectedByUserId?: string|null; payerName?: string|null;
  clientId?: string|null; clientTs?: Date|null }
/** Manual methods. Overpayment guard → ConflictError('overpayment'); reference/check-photo rules; status succeeded,
 *  unverified; in-tx: B2 setJobPaymentStatus + B3 syncInvoicePaymentState; emits payment.succeeded (+ deposit.paid).
 *  Idempotent on clientId. Consumers: B4 own sheet; B1 import (none in MVP). */
export function recordPayment(tx: Tx, input: RecordPaymentInput, actor: Actor): Promise<{ paymentId: string; balanceCents: number|null }>; // stub M
/** On invoice creation: link the job's succeeded deposit payments (invoice_id), deposit_requests → applied; audited. */
export function linkDepositsToInvoice(tx: Tx, jobId: string, invoiceId: string, actor: Actor): Promise<{ linkedPaymentIds: string[] }>; // stub M; B3
/** Evaluates deposit_rules (priority, first match). Creates deposit_requests (status 'required'→'requested' when a link
 *  is sent) and emits deposit.required; returns the open one if it exists; null if no rule / flag 'deposits' off.
 *  No processor → mode falls back to 'manual'. */
export function ensureDepositRequest(tx: Tx, input: { jobId?: string|null; estimateId?: string|null; optionId?: string|null;
  context: 'estimate_approved'|'job_scheduled'|'special_order'|'risk_changed'|'manual' }, actor: Actor): Promise<DepositBrief|null>; // stub M (null); B3, B6
export function previewDeposit(input: { estimateId: string; optionId?: string|null }):
  Promise<{ amountCents: number; mode: DepositBrief['mode']; ruleName: string; policyShort: string; capWarning: string|null }|null>; // stub M (null); B3 builder & /e/
export function markSpecialOrderPo(tx: Tx, jobId: string, at: Date, actor: Actor): Promise<void>;          // stub F; B6
export function getDepositFlags(jobIds: string[]): Promise<Record<string, { required: boolean; paid: boolean; amountCents: number }>>; // stub M ({}); B2 schedule board
export interface ReceiptData { paymentId: string; invoiceId: string|null; jobId: string|null; jobNumber: string|null; customerId: string;
  amountCents: number; tipCents: number; method: string; methodLabel: string /* "cash", "Visa ••4242" */; last4: string|null;
  entryMode: string|null; authCode: string|null; at: Date; collectedByName: string|null; remainingBalanceCents: number|null }
export function getPaymentReceiptData(paymentId: string): Promise<ReceiptData|null>;                     // stub M; B3 receipt view, B5 context

// src/features/disputes/api.ts
export interface RiskResult { score: number; band: RiskBand; signals: { key: string; points: number; detail: string }[]; computedAt: Date }
/** Loads inputs, runs pure engine (src/features/disputes/risk.ts), inserts risk_assessments, B2 setJobRisk. */
export function computeJobRisk(tx: Tx, jobId: string, trigger: 'estimate_changed'|'payer_changed'|'payment_method'|'schedule'|'manual'): Promise<RiskResult>; // stub M (0/low, no insert); B2 before start guard
export function getJobRisk(jobId: string): Promise<RiskResult|null>;                                       // stub F
export interface ReadinessItem { key: 'signed_estimate'|'completion_signed'|'before_after_photos'|'geostamps'|'change_orders_signed'|
  'receipt_delivered'|'comms_log'|'strong_auth'; label: string; weight: number; applicable: boolean; earned: boolean; hint: string }
export interface ReadinessResult { score: number; items: ReadinessItem[] }
export function computeReadiness(tx: Tx, jobId: string): Promise<ReadinessResult>;   // persists via B2 setJobReadiness; stub M (100, items all n/a)
export interface ControlCheck { ok: boolean; missing: { key: string; label: string; overridable: boolean;
  action?: 'sign_estimate'|'capture_photos'|'completion_signature'|'collect_deposit'|'request_start_approval'|'change_order'|'prepay' }[] }
/** Risk-band controls (§11.1), service-type requirements (requires_signed_estimate, photos_required_before/after with the
 *  photos/before_after flag knock-on rules), completion signature, deposit/hold, Critical start approval (approved
 *  approvals row entity job_start) or prepay, change order (B3 getChangeOrderStatus). B2 adds its own guards
 *  (assignee, window, geostamp, checklist, ownership template). overridable=true ⇒ jobs.override_requirements may bypass. */
export function evaluateTransitionControls(jobId: string, to: 'in_progress'|'completed'): Promise<ControlCheck>; // stub M ({ok:true,missing:[]}); B2
export function riskControls(band: RiskBand): { signedEstimate: boolean; minPhotos: boolean; depositOrHold: boolean; noKeyed: boolean;
  require3dsOrCardPresent: boolean; completionSignature: boolean; startApprovalOrPrepay: boolean };          // stub F (pure §11.1 table)

// src/features/media/api.ts
export type MediaTag = 'before'|'during'|'after'|'problem'|'receipt'|'odometer'|'document'|'tool'|'signature'|'id_check'|'other';
export interface MediaItem { id: string; kind: string; tag: MediaTag|null; caption: string|null; jobId: string|null; mime: string;
  width: number|null; height: number|null; createdAt: Date; capturedAt: Date|null; lat: number|null; lng: number|null;
  flags: string[]; includeInInvoice: boolean; evidenceLocked: boolean; thumbUrl: string; url: string /* signed, 10 min */ }
export function listJobPhotos(jobId: string, opts?: { tags?: MediaTag[]; limit?: number }): Promise<MediaItem[]>; // stub M; B4 evidence, B3
export function countJobPhotos(jobId: string): Promise<Partial<Record<MediaTag, number>>>;                // stub F
/** Embedding cascade §M11: flags → company default → service type → invoice.show_photos/photo_media_ids → starred →
 *  latest 2 before + 2 after. invoice ≤ 8, receipt ≤ 4, portal = all starred. */
export function selectInvoicePhotos(invoiceId: string, variant: 'invoice'|'receipt'|'portal'): Promise<MediaItem[]>; // stub M
export function getMediaUrls(mediaIds: string[], variant?: 'full'|'thumb'|'original'): Promise<Record<string, string>>; // stub F; everyone
export function lockEvidenceMedia(tx: Tx, mediaIds: string[]): Promise<void>;                              // stub F; B3 (issue, signatures)
/** Link already-uploaded media to an entity created afterwards (e.g. receipt → part_purchase). */
export function attachMedia(tx: Tx, mediaIds: string[], entity: EntityRef, opts?: { jobId?: string|null; customerId?: string|null }): Promise<void>; // stub F; B6, B7
```

### 6.5 B5: messaging, consent, notify, reviews

```ts
// src/features/messaging/api.ts
export type MsgChannel = 'sms'|'whatsapp'|'email'|'push'|'in_app';
export type Purpose = 'transactional'|'marketing'|'review'|'internal';
export type Audience = { type: 'customer'; customerId: string; to?: string|null }
                     | { type: 'user'; userId: string }
                     | { type: 'address'; to: string; name?: string|null };   // invites / reset links (no user/customer yet)
export type ScheduledStatus = 'scheduled'|'deferred_quiet'|'pending_tap'|'sent'|'sent_manual'|'skipped'|'delivered'|'failed'|
  'canceled'|'suppressed_optout'|'expired';
export interface EnqueueMessageInput {
  templateKey?: string;                 // preferred; rendered with buildContext(entity) + vars at send time
  body?: string; subject?: string;      // free text (composer); still passes every compliance check
  channel: MsgChannel | 'customer_preferred';
  purpose?: Purpose;                    // required with free text; else template's purpose
  audience: Audience;
  entity?: EntityRef; jobId?: string|null; leadId?: string|null;
  vars?: Record<string, string>;        // pre-formatted extras: eta_minutes, amount, count …
  sendAt?: Date;                        // default now
  dedupeKey?: string;                   // default `manual:<uuid>`; automations use automation:entity:step
  outboxAssigneeUserId?: string|null;   // link-mode owner override (tech for on-my-way unless tech_texts_from=office_outbox)
  manualOverride?: boolean;             // transactional one-off after explicit UI warning; never marketing/review
}
/** THE ONLY way to message a customer, tech or admin (SPEC §15.5 rule). Inserts scheduled_messages; the sender
 *  (cron each minute + after()) re-checks flag/automation/cancel_on/entity state/consent/quiet hours/caps, renders,
 *  sends via adapters; link drivers → pending_tap outbox card. Writes messages + activity; emits message.sent
 *  (sent|sent_manual|delivered) / message.failed. Returns an immediate terminal status when knowable.
 *  stub M: insert row; email/push/in_app sent immediately (console email driver), sms/whatsapp → pending_tap. */
export function enqueueMessage(tx: Tx, input: EnqueueMessageInput, actor: Actor): Promise<{ scheduledMessageId: string; status: ScheduledStatus }>;
export function cancelScheduledMessages(tx: Tx, q: { entity?: EntityRef; jobId?: string; templateKeys?: string[]; dedupePrefix?: string },
  reason: string): Promise<number>;                                                                        // stub F
export function getOutboxCount(userId: string, scope?: 'mine'|'all'): Promise<number>;                    // stub F; B2, B8
export interface ConsentStatus { smsStatus: SmsStatus; doNotText: boolean; doNotContact: boolean;
  canSmsTransactional: boolean; canSmsMarketing: boolean; canEmail: boolean }
export function getConsentStatus(customerId: string): Promise<ConsentStatus>;                             // stub M
export interface RecordConsentInput { customerId: string; address: string; channel: 'sms'|'whatsapp'|'email';
  purpose: 'transactional'|'marketing'; action: 'grant'|'revoke';
  source: 'web_form'|'verbal'|'sms_keyword'|'admin'|'import'|'portal'|'natural_language';
  textShown?: string|null; pageUrl?: string|null; ip?: string|null; userAgent?: string|null; actorUserId?: string|null; messageId?: string|null }
/** Append consent_events; recompute sms_status → B1 setCustomerSmsStatus; emit consent.changed; on revoke cancel
 *  queued marketing/review sends. */
export function recordConsent(tx: Tx, input: RecordConsentInput, actor: Actor): Promise<{ consentEventId: string; smsStatus: SmsStatus }>; // stub M; B1 intake/import/manual
export function anonymizeCustomerMessages(tx: Tx, customerId: string, actor: Actor): Promise<void>;       // stub M; B1 anonymize

// src/features/notify/api.ts
export interface NotifyInput { to: { userIds?: string[]; perm?: Perm; role?: string }; type: string /* template key, e.g. 'staff.generic' */;
  title: string; body?: string|null; url?: string|null; entity?: EntityRef; priority?: 'normal'|'high';
  channels?: ('in_app'|'push'|'email')[] /* default: per-user prefs */ }
/** Direct staff alert (notifications row + push/email per prefs; email fallback for critical types). Use ONLY for
 *  alerts with no §7.3 automation (e.g. lead.touched → assignee, remittance request). tx null ⇒ own short tx. */
export function notify(tx: Tx|null, input: NotifyInput): Promise<{ notified: number }>;                   // stub M
export function deletePushSubscriptions(tx: Tx, userId: string): Promise<number>;                         // stub F; B8 deactivate

// src/features/reviews/api.ts
export function getReviewStatsByTech(from: Date, to: Date): Promise<Record<string, { sent: number; clicked: number; ratings: number; avgRating: number|null }>>; // stub M; B8
```

### 6.6 B6: approvals, payroll, parts

```ts
// src/features/approvals/api.ts
export type ApprovalEntityType = 'odometer'|'fuel'|'service'|'document'|'inspection'|'trip'|'part_purchase'|'job_cancel'|'job_start'|'settlement_flag';
export interface ApprovalRow { id: string; entityType: ApprovalEntityType; entityId: string; policy: 'auto'|'auto_if_evidence'|'always_review';
  status: 'pending'|'approved'|'rejected'; requestedBy: string|null; reviewerId: string|null; decidedAt: Date|null; reason: string|null;
  evidence: Record<string, unknown>|null; createdAt: Date }
/** One pending row per entity (returns the existing one). Producers emit their own *_submitted/_requested event. */
export function createApproval(tx: Tx, input: { entityType: ApprovalEntityType; entityId: string;
  policy: ApprovalRow['policy']; requestedBy: string|null; evidence?: Record<string, unknown> }, actor: Actor): Promise<{ approvalId: string }>; // stub F; B2, B7, B6
/** Checks the kind's perm for actor, updates the row, calls kind.onDecide (same tx), audits. */
export function decideApproval(tx: Tx, approvalId: string, d: { decision: 'approved'|'rejected'; reason?: string|null;
  edits?: Record<string, unknown> }, actor: Actor): Promise<void>;                                          // stub M; B6 page, B7 /vehicles/approvals
export function getApprovalFor(entityType: ApprovalEntityType, entityId: string): Promise<ApprovalRow|null>; // stub F; B4 (job_start), B2, B7
export function countPendingApprovals(user: SessionUser): Promise<number>;                                 // stub M; badge, B8

// src/features/payroll/api.ts
export type TraceStep = { step: string; label: string; amount_cents: number; running_cents: number };
export interface JobFinancialsView { jobId: string; locked: boolean; planKey: string; planVersion: number;
  company: null | { revenueCents: number; taxCents: number; tipCents: number; companyPartsCents: number; techPartsCents: number;
    feesCents: number; feesOnTipsCents: number; otherDeductionsCents: number; baseCents: number; companyNetCents: number; trace: TraceStep[] };
  earnings: { userId: string; name: string; splitBps: number; rateBps: number; rateSource: string; commissionCents: number;
    spiffsCents: number; tipCents: number; reimbursementCents: number; cashHeldCents: number; netCents: number; trace: TraceStep[] }[] }
/** jobs.view_financials → everything; otherwise payroll.view_own → company=null and only the viewer's earnings row. */
export function getJobFinancials(jobId: string, viewer: SessionUser): Promise<JobFinancialsView|null>;     // stub M (null); B8
export function getCustodyBalances(userIds: string[]): Promise<Record<string, { heldCents: number; cashCents: number;
  checksCents: number; oldestAt: Date|null }>>;                                                            // stub M (SQL formula §M16); B8 team, B2 finish
export function getPeriodEarnings(userId: string): Promise<{ payPeriodId: string|null; startsOn: string|null; endsOn: string|null;
  netCents: number; byType: Partial<Record<string, number>> }>;                                           // stub M (zeros); B8 tech insights
export type ExternalLedgerType = 'reimbursement_mileage'|'reimbursement_expense'|'tool_deduction'|'tool_allowance'|'tool_deposit'|'adjustment';
/** Append-only insert for other groups. W-2 deductions (tool_*) forced needs_review; effective date in a closed
 *  period → posted into the open period with memo; pay_period_id may be null (settlement selects by effective_date).
 *  Never call for commission/tip/cash types. */
export function postLedgerEntry(tx: Tx, input: { userId: string; type: ExternalLedgerType; amountCents: number;
  effectiveDate: string; jobId?: string|null; refTable: string; refId: string; wageClass?: 'wage'|'reimbursement'|'custody'|'n/a';
  memo?: string|null; needsReview?: boolean }, actor: Actor): Promise<{ ledgerEntryId: string }>;           // stub F; B7 trips/tools
export function getCompAgreementStatuses(userIds: string[]): Promise<Record<string, { planKey: string|null; currentVersion: number|null;
  signedVersion: number|null; required: boolean }>>;                                                       // stub M; B8 team list

// src/features/parts/api.ts
export interface CreatePartPurchaseInput { paidBy: 'company'|'tech'; instrument?: 'personal'|'company_card'|'company_account'|'po'|null;
  purchaserUserId: string; category: 'part'|'fuel'|'vehicle'|'tool'|'supplies'|'other'; jobId?: string|null; vehicleId?: string|null;
  toolId?: string|null; vendor?: string|null; purchasedOn: string; subtotalCents?: number|null; taxCents?: number|null;
  totalCents: number; receiptMediaId?: string|null; notes?: string|null; clientId?: string|null }
/** company → approved; tech → pending → auto-approve rules or approvals row (+ part_purchase.submitted); queues AI
 *  receipt extraction when receipt present; attaches receipt media. Approved tech non-job purchase → reimbursement_expense. */
export function createPartPurchase(tx: Tx, input: CreatePartPurchaseInput, actor: Actor): Promise<{ partPurchaseId: string; status: 'pending'|'approved' }>; // stub M (insert pending); B7 fuel/service/tool maintenance
export function listUnreceiptedTechParts(userId: string, date?: string): Promise<{ lineItemId: string; jobId: string; jobNumber: string;
  name: string; totalCents: number }[]>;                                                                    // stub M ([])
```

### 6.7 B7: vehicles, tools, map

```ts
// src/features/vehicles/api.ts
export function getAssignedVehicle(userId: string): Promise<{ id: string; nickname: string; odometer: number|null;
  ownership: 'company_owned'|'leased'|'tech_owned' }|null>;                                                // stub F; B2 clock, B5
export function getVehicleOdometer(vehicleId: string): Promise<number|null>;                               // stub F; B5 every_n_miles reminders
export function getFleetSummary(from: Date, to: Date): Promise<{ costPerMileCents: number|null; fuelSpendCents: number; miles: number;
  overdueReminders: number; dueSoon: number; openIssues: number }>;                                        // stub M (zeros); B8
// src/features/tools/api.ts
export function getToolAuditStatuses(userIds: string[]): Promise<Record<string, { nextDueOn: string|null; overdue: boolean;
  lastSubmittedAt: Date|null }>>;                                                                          // stub M; B8 team list
// src/features/map/api.ts
/** Status-change stamp → upsert tech_locations (source 'status') only if clocked in AND monitoring notice acked. */
export function recordStatusLocation(tx: Tx, input: { userId: string; jobId: string; geo: Geo }): Promise<void>; // stub F; B2 every transition with geo
```

### 6.8 B8: team, settings

```ts
// src/features/team/api.ts
export interface UserBrief { id: string; name: string; firstName: string; email: string; phone: string|null; role: string;
  baseRole: 'admin'|'office'|'tech'; status: string; workerType: 'w2'|'1099'; color: string|null; avatarUrl: string|null;
  licenseNumbers: { state: string; trade: string; number: string; expiresOn: string|null }[];
  usesCompanyTools: boolean; usesCompanyVehicle: boolean }
export function getUserBriefs(userIds: string[]): Promise<Record<string, UserBrief>>;                     // stub F; everyone (TechCard, names)
export function listUsers(q?: { roles?: string[]; statuses?: string[]; perm?: Perm }): Promise<UserBrief[]>; // stub F; B2 assign, B5 audiences, B6, B7

// src/features/settings/api.ts
export interface ServiceTypeRow { id: string; name: string; color: string|null; icon: string|null; aliases: string[];
  defaultDurationMin: number; defaultPriceCents: number|null; contractKind: 'repair'|'improvement'; checklistTemplateId: string|null;
  photosRequiredBefore: number; photosRequiredAfter: number; photosOnInvoice: boolean; requiresSignedEstimate: boolean;
  requiresOwnershipCheck: boolean; upsellCovered: boolean; warrantyDays: number; maintenanceIntervalMonths: number|null; active: boolean }
export function listServiceTypes(opts?: { includeInactive?: boolean }): Promise<ServiceTypeRow[]>;         // stub F
export function getServiceType(id: string): Promise<ServiceTypeRow|null>;                                  // stub F
export type ChecklistItemDef = { id: string; label: string; type: 'check'|'text'|'number'|'photo'|'signature'|'select'; required: boolean; options?: string[] };
export function getChecklistTemplate(id: string): Promise<{ id: string; name: string; items: ChecklistItemDef[] }|null>; // stub F; B2
export function listTags(appliesTo: TagTarget): Promise<{ id: string; name: string; color: string }[]>;    // stub F
export function getEntityTags(entities: EntityRef[]): Promise<Record<string /* entity id */, { id: string; name: string; color: string }[]>>; // stub F
/** No perm check. TagEditor's own action checks the entity edit perm: customer→customers.edit, job→jobs.edit,
 *  lead→leads.edit, estimate→estimates.create, invoice→invoices.create, vehicle→vehicles.manage, tool→tools.manage. */
export function setEntityTags(tx: Tx, entity: EntityRef, tagIds: string[], actor: Actor): Promise<void>;   // stub F
export function getCustomFieldDefs(entityType: 'customer'|'property'|'job'|'lead'|'vehicle'|'tool', serviceTypeId?: string|null): Promise<CustomFieldDef[]>; // stub F
export function validateCustomValues(entityType: 'customer'|'property'|'job'|'lead'|'vehicle'|'tool', values: Record<string, unknown>,
  serviceTypeId?: string|null): Promise<{ ok: true; values: Record<string, unknown> } | { ok: false; fieldErrors: Record<string, string[]> }>; // stub M (passthrough)
export function getTaxRates(): Promise<{ id: string; name: string; rateBps: number; isDefault: boolean }[]>; // stub F; B3
export function getBrandingStyle(): Promise<string>;   // CSS custom-property overrides for the root layout; stub F ('')
```

### 6.9 Who calls whom (quick index)

| Consumer | Calls |
|---|---|
| B1 | B2 `getContactWindowJob`, `createTask`, `importHistoricalJobs`; B3 `upsertPricebookItems`; B5 `recordConsent`, `enqueueMessage`, `anonymizeCustomerMessages`, `notify`; B8 tags, custom fields, service types |
| B2 | B1 `getCustomerBrief`, `getPropertyBrief`, `logCall`, `getLeadPrefill`, `markLeadConverted`; B3 `issueInvoiceForJob`, `addJobLine`, `captureSignature`, `getChangeOrderStatus`; B4 `evaluateTransitionControls`, `computeJobRisk`, `getJobMoney`, `getDepositFlags`; B5 `enqueueMessage`, `getOutboxCount`; B6 `createApproval`, `getApprovalFor`; B7 `recordStatusLocation`, `getAssignedVehicle`; B8 users, service types, checklist templates |
| B3 | B1 `findOrCreateCustomer`, `markLeadConverted`; B2 `createJob`, `setJobEstimate`, `assertJobAccess`, `getJobContext`; B4 `linkDepositsToInvoice`, `ensureDepositRequest`, `previewDeposit`, `getInvoiceBalance`, `getPaymentReceiptData`, `lockEvidenceMedia`, `selectInvoicePhotos`; B5 `enqueueMessage`; B8 tax rates, users |
| B4 | B1 `setCustomerFlags`, `addCardFingerprint`; B2 setters, `getJobContext`, `createTask`, `closeTasksFor`; B3 `syncInvoicePaymentState`, `hasSignedAuthorization`, `hasSignature`, `getChangeOrderStatus`, `getInvoiceSummary`; B5 `enqueueMessage`; B6 `getApprovalFor` |
| B5 | B1 `setCustomerSmsStatus`, `setCustomerFlags`, `getDefaultBookingLink`; B2 `confirmJob`, `requestReschedule`, `createTask`, `getJobContext`; B4 `getPaymentReceiptData`; B7 `getVehicleOdometer`; B8 `listUsers` |
| B6 | B2 `lockJobsForSettlement`, `closeJobIfEligible`, `createTask`, `closeTasksFor`, `getHoursWorked`; B3 `addJobLine`, `removeJobLine`, `listJobLines`, `priceFromMarkup`, `captureSignature`; B4 `ensureDepositRequest`, `markSpecialOrderPo`, `attachMedia`, `getJobMoney`; B5 `notify`, `enqueueMessage` |
| B7 | B2 `getTechDay`, `getClockStatuses`, `assertJobAccess`; B6 `createApproval`, `decideApproval`, `postLedgerEntry`, `createPartPurchase`; B4 `attachMedia`, `getMediaUrls`; B3 `captureSignature`; B5 `notify` |
| B8 | F `createInvite`, `revokeAllSessions`, `createPasswordResetLink`; B2 `getClockStatuses`; B5 `deletePushSubscriptions`, `enqueueMessage`, `getOutboxCount`, `getReviewStatsByTech`; B6 `getCustodyBalances`, `getCompAgreementStatuses`, `countPendingApprovals`, `getPeriodEarnings`, `getJobFinancials`; B7 `getToolAuditStatuses`, `getFleetSummary` |

**Synchronous (in-tx) vs. event-driven.** An invariant that must hold atomically is a direct in-tx call:
- invoice status after a payment
- the job `payment_status` cache
- deposit linking on invoice creation
- invoice issue on completion
- lead converted on job or estimate create
- settlement lock → job close
- signature evidence lock

Everything else reacts to events (§7): messages, notifications, risk, readiness, financials and ledger, and activity in other domains.

### 6.10 Approval kinds contract (B6 owns the registry; producers own their kinds)

```ts
// src/features/approvals/contracts.ts
export interface ApprovalKindDef {
  entityTypes: ApprovalEntityType[];
  perm: Perm;                // decide permission (§4.2 note): vehicles.log_approve | parts.approve_reimbursement |
                             // jobs.review_cancellations | jobs.approve_start | payroll.manage
  label: string;
  Row(p: { approval: ApprovalRow }): Promise<React.ReactNode>;      // server component: one-line summary
  Detail(p: { approval: ApprovalRow }): Promise<React.ReactNode>;   // server component: evidence side-by-side, typed vs AI values, flags
  clean?(approval: ApprovalRow): boolean;                           // eligible for "Approve all clean"
  onDecide(tx: Tx, approval: ApprovalRow, d: { decision: 'approved'|'rejected'; reason?: string|null;
           edits?: Record<string, unknown> }, actor: Actor): Promise<void>;   // domain effects + the producer's events
}
```

| File | Kinds | `onDecide` effects |
|---|---|---|
| `src/features/vehicles/approval-kinds.tsx` (B7) | odometer, fuel, service, document, inspection, trip | Set `approval_status`; on approve: reset reminders (service), post mileage reimbursement (trip, via `postLedgerEntry`), update the odometer cache. |
| `src/features/jobs/approval-kinds.tsx` (B2) | job_cancel, job_start | `cancel_review_status` ok or flagged; emit `job.start_approved` or `job.start_denied`. |
| `src/features/parts/approval-kinds.tsx` (B6) | part_purchase | Approve: emit `part_purchase.approved`, post the reimbursement line, recompute. Reject: emit `part_purchase.rejected`. |
| `src/features/payroll/approval-kinds.tsx` (B6) | settlement_flag | Resolve or reject the flag; post an optional adjustment. |

### 6.11 Client outbox and drafts (B2 owns; F ships online pass-through stubs)

```ts
// src/client/outbox.ts  ('use client' helpers; IndexedDB; flush on app open, 'online', 'visibilitychange')
export type OfflineActionKey = string;  // '<module>.<action>' as registered in src/features/*/offline.ts
export function queueAction(key: OfflineActionKey, input: Record<string, unknown> & { clientId: string; clientTs: string }):
  Promise<{ queued: boolean; result?: ActionResult<unknown> }>;     // online → call now; offline/failure → persist + retry
export interface UploadMeta { clientId: string; kind: MediaKind; tag?: MediaTag|null; caption?: string|null;
  entity?: EntityRef|null; jobId?: string|null; geo?: Geo|null; fileLastModified?: number|null; clientCapturedAt: string;
  sha256Original: string; keepOriginal?: boolean }
export function queueUpload(file: Blob, meta: UploadMeta): Promise<{ clientId: string; queued: boolean; mediaId?: string }>; // presign → PUT → complete
export function useOutboxState(): { pending: number; uploading: number; syncing: boolean; lastError: string|null };
export function flush(): Promise<void>;
// src/client/drafts.ts
export function useDraft<T>(key: string, initial: T): [T, (v: T) => void, () => void /* clear */];   // debounced 400 ms IndexedDB
```
`UploadMeta.clientId` becomes `media.client_id`. Producers attach media to a not-yet-existing entity later via `attachMedia`, using the `mediaId` returned by `complete`, or by looking up `media.client_id`.


---

## 7. Domain events

### 7.0 Conventions
- **Emit in the same transaction as the domain write:** `emit(tx, type, entity, payload)`. Every payload carries `{ id, at, actor_user_id }` plus the §7.1 fields with these amendments.
- **The emitter also calls `writeActivity`** for every event on an entity that has a timeline (customer, job, lead, estimate, invoice, vehicle, tool, user), with `kind = <event type>`. Handlers never write activity for another group's events. This replaces "activity written by event handlers" from M22 and keeps one writer per row.
- **Handlers** live in `src/features/<m>/events.ts` (§4).
  - Each runs in its own transaction.
  - It must be **idempotent**, because the processor retries the whole event until every handler succeeds.
  - It must be fast. Slow work goes to `enqueueJob`.
- **B5's automation engine** registers `{ event: '*', name: 'automations.engine' }`. It matches `automations.trigger_event` and `cancel_on` for **every** event and creates or cancels `scheduled_messages` (dedupe `automation:entity:step`).
- **Seeds never emit events** (§10).

### 7.1 Additions and payload amendments (F adds these to `EventMap`)

| Change | Payload / note |
|---|---|
| **New** `message.sent` | `{ message_id, scheduled_message_id\|null, customer_id\|null, lead_id\|null, job_id\|null, channel, template_key\|null, user_id\|null, status: 'sent'\|'sent_manual'\|'delivered' }`. Emitted by B5 when a message actually leaves, including outbox "Sent? Yes". |
| **New** `time.clocked_in` / `time.clocked_out` | `{ time_entry_id, user_id, vehicle_id\|null, odometer_reading_id\|null, date /* YYYY-MM-DD company TZ */ }`. Emitted by B2. |
| **New in the catalog** `job.status_changed` | `{ job_id, from, to, tech_id\|null, lat\|null, lng\|null }`. M05 requires it for every transition, but §7.1 omitted it. Emitted by B2 alongside the specific event. |
| **New** `review.received_logged` | `{ review_request_id, job_id, tech_user_id }`. Emitted by B5 (manual "review received" log); feeds B6 `review_bonus` spiffs. |
| `job.en_route` | **Drop `tracking_token`.** Raw tokens never go into `events`. B5 mints the `tracking` token at render time for `{{tracking.link}}`. B2 revokes tracking tokens on `arrived`, `cancelled` or `completed`. |
| `job.completed` | `invoice_id` is nullable (when auto-issue is off). Add `completed_at`. |
| `invoice.issued` | Add `via: 'job_completed'\|'manual'` so `invoice_sent` skips completion-issued invoices. |
| `payment.succeeded` | Add `job_id\|null, customer_id, kind, tip_cents, deposit_request_id\|null, provider, entry_mode`. |
| `refund.*` | Add `invoice_id\|null, job_id\|null`. |
| `dispute.created` / `.updated` / `.closed` | Add `job_id\|null, amount_cents, customer_id`. |
| `part_purchase.*` | Add `purchaser_user_id, job_id\|null, category, approval_id\|null`. |
| `job.cancelled`, `job.rescheduled` | Add `tech_ids` (assignees at the time, including removed ones for `job.assigned`). |
| `task.created` / `task.due` | Add `kind, title, entity_type\|null, entity_id\|null`. |
| `signature.captured` | Add `job_id\|null, customer_id\|null, signer_kind`. |

### 7.2 Event matrix

Legend:
- **AUTO(x)** = B5's automation engine acting on the built-in automation `x` from §7.3. It is listed for clarity only: the engine handles **every** event generically, including custom automations.
- "in-tx" = done by the emitter inside the transaction, not by a handler.

| Event | Emitter (group: where) | Handlers (group: what) |
|---|---|---|
| `lead.created` | B1: intake routes, `/leads/new` | AUTO(`lead_ack`, `lead_alert`, `lead_escalate_5`, `lead_escalate_15`, `lead_not_reached`) |
| `lead.touched` | B1: intake dedupe | B1: `notify()` the assignee (no built-in automation) |
| `lead.responded` | B1: claim+call, `markLeadResponded` | AUTO cancel_on (`lead_ack`, escalations) |
| `lead.sla_breached` | B1: cron `leads.sla` (5, 15 min) | — (activity only; the escalation pushes come from `lead.created` delays per §7.3) |
| `lead.status_changed`, `lead.converted` | B1: actions, `markLeadConverted` | AUTO cancel_on (`lead_not_reached`) |
| `customer.created` | B1: `findOrCreateCustomer`, create | — |
| `customer.updated` | B1: edits, `setCustomerFlags` | B4: recompute risk for the customer's open jobs |
| `customer.merged` | B1: merge tool | B5: recompute `sms_status` of the survivor |
| `consent.changed` | B5: `recordConsent` | B5: suppress queued sends; opt-out confirmation text (paid drivers) |
| `job.created` | B2: `createJob` | B4: risk; AUTO cancel_on (`maintenance` for the same customer and service) |
| `job.scheduled` | B2: schedule or assign with window | AUTO(`booking_confirm`, `reminder_24h`, `reminder_2h`, `unconfirmed_flag`, `late_prompt`); B4: `ensureDepositRequest(context 'job_scheduled')` and risk |
| `job.rescheduled` | B2 | AUTO(`reschedule_notice`, `tech_job_changed`; recompute anchored sends); B4: risk |
| `job.assigned` | B2 | AUTO(`tech_assigned`, `tech_job_changed` for removed techs) |
| `job.confirmed` | B2: `confirmJob` (portal, reply, manual) | AUTO cancel_on (`unconfirmed_flag`) |
| `job.reschedule_requested` | B2: `requestReschedule` | AUTO(`reschedule_request_alert`) |
| `job.en_route` | B2: On my way (in-tx: B7 `recordStatusLocation`) | AUTO(`on_my_way`, cancel `reminder_2h`, `late_prompt`) |
| `job.running_late` | B2 | AUTO(`running_late`) |
| `job.arrived` | B2 (in-tx: revoke tracking tokens, location stamp) | AUTO cancel_on; B4: readiness |
| `job.status_changed` | B2: every transition | — (only custom automations, via the wildcard) |
| `job.started` | B2 | — |
| `job.on_hold` | B2 | — |
| `job.return_visit_scheduled` | B2 | AUTO(`return_visit_notice`, `booking_confirm`, `reminder_24h`) |
| `job.completed` | B2 (in-tx: B3 `issueInvoiceForJob`; B4 captures auth holds via handler) | AUTO(`job_completed_invoice`, `review_request`, `checkin_7d`, `maintenance`); B6: recompute financials and post the ledger when `earned_on='job_done'`; B4: readiness and hold capture; B2: create the next recurring job |
| `job.closed` | B2: `closeJobIfEligible` | AUTO (`review_request` "or job.closed" path) |
| `job.cancelled` | B2 | AUTO(`cancel_notice` or `post_cancel_verify`, `tech_job_changed`; cancels all job sends); B4: deposit (refund suggestion, forfeit per policy, cancel hold) |
| `job.callback_created` | B2: `createJob` with `callbackOfJobId` | B6: recall policy (clawback on the original job); B6: when reason=`part`, a `warranty_claim` task via `createTask` |
| `job.start_approval_requested` | B2 (in-tx: B6 `createApproval` job_start) | AUTO(`start_approval`) |
| `job.start_approved` / `job.start_denied` | B2: `onDecide` (job_start kind) | AUTO(`start_decided`) |
| `job.cancel_review_requested` | B2 (after-arrival cancel; in-tx `createApproval` job_cancel) | AUTO(`approval_needed`) |
| `estimate.sent` | B3 | AUTO(`estimate_followup`, `estimate_closeout`); B4: risk (if job) |
| `estimate.viewed` | B3: `/e/[token]` | AUTO(`estimate_viewed_staff`) |
| `estimate.approved` | B3 (in-tx: lines → job draft invoice, B2 `setJobEstimate` or `createJob`, B4 `ensureDepositRequest`) | AUTO(`estimate_approved_staff`; cancel follow-ups); B4: risk |
| `estimate.declined` | B3 | AUTO cancel follow-ups |
| `estimate.expired` | B3: cron `estimates.expire` | AUTO cancel_on |
| `change_order.approved` | B3 | B4: risk and readiness |
| `invoice.issued` | B3: `issueInvoiceForJob` or manual issue | AUTO(`invoice_sent` only when `via='manual'`, `dunning`); B6: recompute |
| `invoice.revised` | B3 | B6: recompute (unlocked) or adjustment (locked); B8 reads it for the anomaly report |
| `invoice.overdue` | B3: cron `invoices.overdue` | — (digest and insights read it; dunning is anchored on `invoice.issued`) |
| `invoice.paid` | B3: `syncInvoicePaymentState` | AUTO cancel_on (`dunning`, `job_completed_invoice`; unblocks `review_request`); B6: post the ledger when `earned_on='paid_in_full'` |
| `invoice.voided` | B3 | AUTO cancel; B6: recompute |
| `deposit.required` | B4: `ensureDepositRequest` | AUTO(`deposit_request`) |
| `deposit.paid` | B4 (payment or webhook) | AUTO(`deposit_paid_staff`; cancel `deposit_request`); B4: risk |
| `deposit.hold_expiring` | B4: cron | AUTO(`hold_expiring`) |
| `payment.succeeded` | B4: `recordPayment`, Stripe webhook (in-tx: B2 payment status, B3 invoice sync, B1 `addCardFingerprint`) | AUTO(`payment_receipt`); B6: recompute and the cash custody check (`cash.over_limit`); B4: risk and readiness |
| `payment.failed` | B4: webhook | AUTO(`payment_failed_alert`) |
| `payment.fee_updated` | B4: `stripe_fee` worker / webhook enrich (the card fee estimate replaced by the actual fee; QA2) | B6: recompute (`payroll.recompute_on_fee`) |
| `payment.manual_unverified` | B4: cron | AUTO(`manual_unverified_alert`) |
| `payment.customer_flagged` | B4: public action from `/i/` (in-tx: B2 `createTask` callback_customer) | AUTO(`receipt_flag_alert`) |
| `refund.created` | B4 | B6: recompute |
| `refund.succeeded` | B4 (in-tx: B3 invoice sync) | AUTO(`refund_notice`; cancel `refund_due`); B6: recompute; B4: close the `refund_due` task |
| `refund.due` | B4: cron (promised refund due) | AUTO(`refund_due`) |
| `dispute.created` | B4: webhook (in-tx: B1 `setCustomerFlags` disputeHistory, B2 payment status 'disputed', enqueue `evidence_pack` job) | AUTO(`dispute_alert`; cancel `dunning`); B6: `chargeback_hold` per plan |
| `dispute.updated` / `dispute.closed` | B4: webhook | B6: release or clawback; AUTO cancel_on (`dispute_alert`) |
| `dispute.evidence_submitted` | B4: Submit | AUTO cancel_on (`dispute_alert`) |
| `efw.created` | B4: webhook | AUTO(`efw_alert`) |
| `review.requested` | B5 | AUTO(`review_reminder`) |
| `review.clicked` | B5: `/r/[token]` | AUTO cancel_on (`review_request`, `review_reminder`) |
| `review.rated` | B5: `/r/[token]` rating | AUTO(`low_rating_alert` ≤ 3); B5: `callback_customer` task when the customer wants a call; B4: risk `complaint` signal (≤ 2) |
| `review.received_logged` | B5 | B6: `review_bonus` spiff recompute |
| `message.sent` | B5: sender, outbox "Sent? Yes" | B1: `markLeadResponded` (lead or customer with an open lead); B4: readiness (receipt delivered, comms log) |
| `message.received` | B5: inbound driver or manual "log reply" | B5: STOP/START/HELP and C/R keywords (B2 `confirmJob`/`requestReschedule`), thread push; AUTO cancel_on (`lead_not_reached`, `estimate_followup`) |
| `message.failed` | B5 | AUTO(`message_failed_alert`) |
| `message.optout_detected` | B5 | B5: one-tap review prompt (notification) |
| `photo.uploaded` | F: `api/uploads/complete` | B4: readiness (job photos) |
| `signature.captured` | B3: `captureSignature` | B4: readiness and risk; AUTO cancel_on (`comp_agreement_required` when doc_type is comp_agreement) |
| `part_purchase.submitted` | B6 | AUTO(`approval_needed`) |
| `part_purchase.approved` / `.rejected` | B6: auto rules or `onDecide` | AUTO(`reimbursement_decided`); B6: recompute the job financials |
| `cash.over_limit` | B6: cron or payment handler | AUTO(`cash_over_limit`) |
| `cash.remitted` / `cash.received` | B6 | AUTO cancel_on (`cash_over_limit`) |
| `cash.discrepancy_declared` | B6: S44 on `/today/finish` | AUTO(`cash_discrepancy`) |
| `pay_period.closed` | B6: cron | B6: draft settlements → `settlement.ready_for_review` |
| `settlement.ready_for_review` / `.flagged` / `.approved` / `.paid` | B6 | AUTO(`settlement_ready`, `settlement_flagged`, `payout_sent`) |
| `comp_agreement.required` | B6: plan version or assignment change | AUTO(`comp_agreement_required`) |
| `user.bank_changed` | B6: `/pay/bank` | AUTO(`bank_changed_alert`) |
| `vehicle.log_submitted` | B7 (in-tx `createApproval` when review is needed) | AUTO(`approval_needed`) |
| `vehicle.reminder_due` | B7: cron | AUTO(`vehicle_due`) |
| `vehicle.document_expiring` | B7: cron | AUTO(`doc_expiring`) |
| `vehicle.issue_reported` | B7 | AUTO(`vehicle_issue_alert`) |
| `vehicle.anomaly` | B7: log submit | — (B5 daily digest reads it) |
| `tool.audit_due` / `tool.audit_submitted` | B7: cron, audit submit | AUTO(`tool_audit_due`; cancel_on) |
| `tool.incident` | B7 | AUTO(`tool_incident_alert`) |
| `tool.maintenance_due` | B7: cron | AUTO(`tool_maintenance_due`) |
| `time.clocked_in` | B2 | B7: start-of-day inspection-due notification when due |
| `time.clocked_out` | B2 | B7: draft the day's trip (`getTechDay`; tech-owned vehicles → reimbursable) |
| `task.created` | B2: `createTask` | B5: `notify()` the assignee when the assignee ≠ the actor |
| `task.due` | B2: cron `tasks.due` | AUTO(`task_due`) |
| `user.invited` | F: `createInvite` | — |
| `user.deactivated` | B8 (in-tx: F `revokeAllSessions`, B5 `deletePushSubscriptions`) | — (B2's reassign list and B6's cash flag are queries) |
| `permission.changed` | B8 | — (perms are re-read per request) |
| `reminder.due` | B5: cron | B5: deliver the custom reminder |
| `digest.daily` | B5: cron 07:30 | AUTO(`daily_digest`) |

Every `EventType` must have at least one handler or an explicit `ignore` entry (SPEC §7.1 typing). The events marked "—" are covered by the `automations.engine` wildcard.

---

## 8. Cron hooks, queue workers, AI handlers

### 8.1 `cronHooks` (run by F's `/api/cron/tick`, company TZ)

| Group | Key | Schedule | Does |
|---|---|---|---|
| F | `events.process`, `queue.run` | every 1 min (also `after()`) | Event processor; `job_queue` runner (SKIP LOCKED) |
| F | `system.prune` | daily 03:00 | Prunes `rate_limits`, `action_receipts` older than 30 d, old `login_attempts`, expired sessions and tokens |
| B1 | `leads.sla` | every 1 min | Emits `lead.sla_breached` (5 and 15 min) once per lead, idempotent via `lead_events` |
| B1 | `leads.map_backfill` | every 10 min | Lead map (leads flow redesign): open leads with a street + ZIP and no property get a customer and property the way intake does (queues the geocode), 25 a run; re-queues a lead property's stuck geocode once a day |
| B1 | `data.backup` | daily 02:00 | Queues `backup` (14 daily + 8 weekly retention) |
| B1 | `data.exports_prune` | daily 03:30 | Expires exports and download links |
| B2 | `tasks.due` | every 1 min | Emits `task.due` for open tasks with `due_at` in (lastRunAt, now] |
| B2 | `jobs.stale_tracking` | every 15 min | Revokes tracking tokens for jobs `en_route` more than 3 h |
| B3 | `estimates.expire` | every 60 min | sent or viewed and past `expires_at` → `expired`, emits `estimate.expired` |
| B3 | `invoices.overdue` | daily 06:00 | Emits `invoice.overdue` (days 1, 3, 7, 14, 30…) for issued or partially paid invoices past `due_at` |
| B4 | `payments.webhook_retry` | every 1 min | Reprocesses `webhook_events` where `processed_at is null` |
| B4 | `payments.manual_unverified` | daily 08:00 | Emits `payment.manual_unverified` (age ≥ 3 d) |
| B4 | `deposits.hold_expiring` | every 60 min | Emits `deposit.hold_expiring` 24 h before `capture_before` |
| B4 | `refunds.due` | every 15 min | Scheduled promised refunds past `due_at` → `refund.due` plus a `refund_due` task |
| B4 | `checkout.expire` | every 60 min | Expires `checkout_sessions` |
| B5 | `messaging.send_due` | every 1 min (also `after()`) | Sends due `scheduled_messages`, applies quiet-hours deferral with jitter, caps, cancel checks |
| B5 | `messaging.outbox` | every 5 min | Expires stale `pending_tap`; batched pushes "n customer texts ready" and `approval_needed` (15-min batch) |
| B5 | `automations.fixed_time` | daily 00:05 | Schedules today's `fixed_time_local` sends (`tech_daily_agenda` 07:00) |
| B5 | `reminders.due` | every 5 min | Emits `reminder.due` and advances `next_at` (`every_n_miles` via B7 `getVehicleOdometer`) |
| B5 | `notify.digest` | daily 07:30 | Emits `digest.daily` |
| B5 | `push.prune` | daily 04:00 | Removes dead subscriptions |
| B6 | `payroll.periods` | daily 00:15 | Ensures the current and next `pay_periods` exist |
| B6 | `payroll.close` | every 60 min | Period end + `close_delay_hours` → close, emit `pay_period.closed` |
| B6 | `payroll.review_deadline` | every 60 min | `tech_review` past 48 h → ready for approval (admin notification) |
| B6 | `payroll.cash_alerts` | daily 08:00 | `cash.over_limit` (max held or older than `remit_within_days`) |
| B6 | `parts.stale_receipts` | daily 06:30 | Tech-paid receipts older than 60 d flagged (accountable plan) |
| B6 | `inventory.cycle_count` | monthly day 1 06:00 | Creates the count task (inventory flag on) |
| B7 | `vehicles.reminders` | daily 05:00 | Forecasts from trailing 30-day miles; status changes → `vehicle.reminder_due` |
| B7 | `vehicles.documents` | daily 05:10 | 30, 14 and 3 d → `vehicle.document_expiring` |
| B7 | `vehicles.recalls` | monthly day 2 04:00 | Queues `recalls` per vehicle |
| B7 | `tools.audits` | daily 05:20 | Creates scheduled audits per frequency; `tool.audit_due` |
| B7 | `tools.maintenance` | daily 05:30 | `tool.maintenance_due` 7 days before and on the day |
| B7 | `map.prune` | daily 03:15 | Prunes breadcrumbs older than `keep_breadcrumbs_days` |
| B8 | — | — | Insights are computed on view |

### 8.2 `job_queue` kinds → worker owner (`workers.ts`)

| Kind | Owner |
|---|---|
| `email` | B5 |
| `push` | B5 |
| `export` | B1 |
| `backup` | B1 |
| `geocode` | B1 (uses the geocode adapter stewarded by B7) |
| `pdf` | B4 |
| `evidence_pack` | B4 |
| `stripe_fee` | B4 (fetch `balance_transaction` fee) |
| `vin` | B7 |
| `recalls` | B7 |
| `ai` | F (policy layer, budget and cache, then calls `aiHandlers`) |

### 8.3 `aiHandlers` (`ai.ts`)

| Group | Kinds |
|---|---|
| B6 | `receipt` (parts and non-job purchases; then re-run auto-approve) |
| B7 | `odometer`, `receipt` (fuel; routed by `ref.module`), `shop_invoice`, `tool_label`, `maintenance_suggest`, `explain_flags` |

---

## 9. Per-group scope checklists

Each list has three parts:
- **MVP:** must ship (screens, then actions and flows).
- **Later:** schema only; don't build. Leave a `TODO(later)` only where a hook is needed.
- **Tests:** required. Golden tests are marked ★.

### B1: Customers, leads, data

**MVP screens**
- `/customers`: search, chips (type, tag, flags), cursor pagination, desktop list–detail split.
- `/customers/new`: duplicate prompt (exact phone or email; fuzzy normalized street + zip).
- `/customers/[id]`: composition per §5.3; properties CRUD with encrypted gate code; flags (`customers.flags_manage`); anonymize (`customers.delete`); soft delete; CSV export (`customers.export`).
- `/customers/[id]/merge`: choose surviving fields, re-point FKs, audit, `merged_into_id` tombstone.
- `/leads`: SLA-sorted cards with the timer (green < 5, amber < 15, red), source badge, service, quoted price, preferred date, in or out of service area, returning badge. Filters: status, source, "Check" (`spam_score ≥ threshold`), spam.
- `/leads/[id]`: timeline (S33, entity lead) and `lead_events`; raw payload for admins.
- `/leads/new`: manual entry; source required.
- `/settings/lead-sources`:
  - Source CRUD by `integration_kind`: plain form, JS snippet, hosted form, JSON API, preset.
  - Keys: `pk` shown; `sk` and the hook secret shown **once**; rotation.
  - Allowed origins, `require_ts`, Turnstile, daily cap, cost model, `source_spend` by month.
  - JSON-path mapping editor with "test with last payload".
  - §8.5 snippet generator for all three levels with the real key.
  - Test console with the last 20 payloads and their mapping result.
  - The `settings.leads` section: assignment, lost reasons, spam threshold, SLA business hours, `lead_response_minutes`.
- `/settings/api-keys`: scopes; shown once; revoke.
- `/settings/data`: export everything, CSV import wizard, backups status, danger zone "reset demo data" (ConfirmTyped; only when `NODE_ENV !== 'production'` or a demo flag).
- `/f/[publicKey]` and `/f/[publicKey]/thanks`.

**MVP actions and flows**
- Intake per §8.3, exactly, on all endpoints:
  - Size ≤ 32 KB, rate limit 10/min plus a daily cap.
  - Key and origin check; CORS preflight.
  - Honeypot, `_ts` HMAC (only when present or when `require_ts`), Turnstile.
  - Fake 200 or 303 for spam.
  - Preset → source mapping → aliases; zod validation; normalization (phone, email, price, date in the company TZ; fuzzy service match).
  - Dedupe: `(source, external_id)`; the 10-min `dedupe_hash`; an open lead for the same customer and service within 14 d becomes a touch.
  - `findOrCreateCustomer`; consent via B5 `recordConsent`; `lead_events(received, raw)`.
  - Emit `lead.created`; respond in under 300 ms.
- Presets: generic, zapier, make, thumbtack (`leadPrice` → `source_cost_cents`), angi, google_ads_leadform (`google_key`).
- `GET /api/v1/leads/schema`.
- `embed.js`: built by `npm run build:embed`, under 3 KB gz, no dependencies, ES2017. Handles first and last touch in localStorage (90 d, try/catch), `_ts`, honeypot, an unchecked consent box plus a separate marketing box, Turnstile, fetch submit with inline success, and a POST fallback. Build tooling uses only what's already in `node_modules` (esbuild ships with tsx) or a hand-written file plus a gzip size check.
- Claim (first-to-claim or round-robin).
- Call → outcome sheet (`logCall`). "No answer" → `lead_retry` task (+15 min) plus an auto-drafted `lead.no_answer` text via `enqueueMessage`.
- Text (S29); mark lost (reasons); mark spam.
- Convert → `/jobs/new?leadId=` or `/estimates/new?leadId=`; B2 or B3 call `markLeadConverted`.
- `message.sent` handler → `markLeadResponded`.
- Masking and `customer.viewed` audit.
- Calls and texts from cards are logged.
- Property geocode via the `geocode` worker (1 req/s) with the timezone from `zip-tz`.
- `globalSearch` (under 150 ms at 50k customers; prefix indexes).
- Export:
  - `job_queue` export → zip (hand-rolled store-only zip writer, no dependency) with JSON per table (excluding secrets, `sessions`, token hashes), CSVs for the main entities, and the media manifest plus files.
  - `/api/export/[id]` → 302 to a signed URL valid 24 h.
- CSV import: customers + properties (B1), price book (→ B3 `upsertPricebookItems`), past jobs (→ B2 `importHistoricalJobs`). Column mapping UI, dry-run preview, dedupe.
- Nightly backup to `backups/YYYY-MM-DD/`; `scripts/restore.ts`, `scripts/export.ts`, `scripts/import-csv.ts`.

**Later:** inbound-email parser (route returns 501), LSA polling, missed-call text-back, online booking, memberships, customer login, multiple contacts, Jobber/HCP/Workiz presets, QuickBooks/Xero.

**Tests:** ★ lead normalizer (aliases, `first+last`, price "$1,200" / "1200.50", ISO and MM/DD/YYYY dates in the company TZ, E.164, consent truthiness `on/true/1/yes`, unknown fields → `extra`, mapping); ★ spam scoring and the `_ts` rules (plain form without `_ts` is not spam); dedupe windows; CORS; zip writer round-trip; `globalSearch` phone formats.

### B2: Jobs, tech app, tasks, time

**MVP screens**
- `/jobs`: filters (status, tech, date, callback, "cancelled after arrival", mine), cursor pagination.
- `/jobs?mine`: tech upcoming and past.
- `/jobs/new`: S3 picker; service type; title; priority; window 1, 2 or 4 h; assignees with split; after-hours; recurrence; callback-of; lead prefill; snapshots the cancellation policy and service-fee disclosure.
- `/jobs/[id]`: §5.3 composition; office tabs vs tech action bar.
- `/jobs/[id]/print`: work order.
- `/schedule`:
  - Day view (desktop columns per tech, drag to assign; mobile list per tech with the S9 sheet), 3-day and week views.
  - Unscheduled queue.
  - Conflict warnings: overlap, outside the tech's ZIPs, tech not clocked in.
  - Travel-gap hint (straight line ÷ 30 mph); color by status or tech; unpaid-deposit flag (B4 `getDepositFlags`).
  - "Unconfirmed tomorrow" list.
- `/today` (tech My Day, office/admin → S54) and `/today/finish`.
- `/tasks`: mine or all (`tasks.view_all`); create; assign; done or dismiss.
- `/time`: own entries; others with `time.manage` (edit with reason).
- `/settings/jobs`.

**MVP actions and flows**
- The full status machine with every guard from the M05 table. B2 owns assignee, window, geostamp and distance flag, checklist required items, and the ownership template. B4 `evaluateTransitionControls` covers everything risk- and evidence-related.
  - `jobs.override_requirements` bypasses with a reason.
  - Each transition writes `job_status_events` (actor, client_ts, lat/lng, accuracy, distance) and emits its specific event plus `job.status_changed`.
  - Each transition calls B7 `recordStatusLocation`.
- `en_route` never touches other jobs.
- On my way with ETA chips; running late (15/30/45/60).
- Arrived (radius warning, never a block).
- Start: calls `computeJobRisk(…,'manual')` first. For the Critical band it offers "Request approval" (`createApproval` job_start, emits `job.start_approval_requested`) or prepay.
- Complete:
  - The sheet shows readiness items (S22 data), control misses, checklist, and completion signature (S15 with B2's `signCompletion` action → B3 `captureSignature`).
  - Issues the invoice via B3 `issueInvoiceForJob`.
- Hold, then return visit (`on_hold → scheduled`, new window, `visit_count++`, `job.return_visit_scheduled`).
- Cancel with a reason code. After arrival it also requires a note and a photo (S24), plus `createApproval` job_cancel and `job.cancel_review_requested`.
- Reopen (`jobs.reopen`, audited); manual close (`closeJobIfEligible` with force).
- Create callback (no-charge default; `callback_of`).
- Recurring next job on completion.
- Cancellation-fee line via B3 `addJobLine` (late cancel or no-show), `waived_fee_count`.
- Assign or reassign (`job.assigned`); reschedule (`job.rescheduled`, recompute).
- Portal confirm and reschedule actions (S8, token re-validated).
- `confirmJob` and `requestReschedule` APIs.
- Tracking token revoke on arrived, completed or cancelled.
- Notes (S5), tasks (`createTask`, `task.due` cron).
- Time clock: geostamp, breaks, odometer via S48 when `vehicles.require_odometer_on_clock`, emits `time.clocked_in`/`out`.
- Offline: IndexedDB outbox for status, notes, checklist, clock, plus B4, B6 and B7 registered actions and uploads; idempotent on `clientId`; banner ("3 changes waiting to sync"); autosave drafts (`useDraft`).
- Approval kinds `job_cancel` and `job_start`.

**Later:** route optimization, ETAs, capacity slots, multi-day jobs, subcontractor `/s/[token]`, availability and time off, skills-based dispatch.

**Tests:** status-machine transition table (allowed and forbidden, guard outcomes, override); contact-window computation; recurrence next date; the outbox queue (replay with the same `clientId` returns the stored result).

### B3: Price book, estimates, invoices, portal

**MVP screens**
- `/settings/pricebook`: items CRUD, categories, markup matrix (markup and margin shown), CSV import and export.
- `/estimates`: unsold board by value, close rate per tech, filters.
- `/estimates/new`.
- `/estimates/[id]` builder:
  - 1–3 options (Good/Better/Best, editable, Recommended); lines (types, S14 picker, qty to 3 dp, unit cost internal, taxable, part source, warranty, optional add-ons, `is_upsell`, service-fee line "credited if approved").
  - Discount within the role's `max_discount_pct`; expiry (default 30 d); problem photos (S25).
  - Terms: warranty, deposit (B4 `previewDeposit`), policies inline.
  - FTC cooling-off auto-attach; compliance-profile contract warnings.
  - Send by SMS, email or in person (S15 on device); approve on behalf (verbal).
- `/estimates/[id]/print`.
- `/estimates/co/[id]`: change order with delta and signature.
- `/invoices`: aging filter 0–30/31–60/61–90/90+ by tech and source.
- `/invoices/[id]`: draft edit, issue, revise (snapshot, hash, diff, reason; flagged after payment), void (`invoices.void`), uncollectible, credit notes, photos (S25 plus `show_photos`), S16 and S19, send or resend.
- `/invoices/[id]/print`:
  - Print CSS; S26 photo grid; pay QR (hand-rolled encoder or server SVG, under 5 KB).
  - Descriptor line; "Pay only {Company}. Never pay a technician personally."; warranty block; tech name and license #.
- `/invoices/statement/[customerId]`.
- `/settings/invoices`.
- Public `/j/[token]`, `/e/[token]` (view, option and add-on selection, ESIGN box, typed name, drawn signature, then the deposit `/p/`), `/i/[token]` (view, print, pay; `?receipt=` with S28).
- `api/uploads/public/presign` (ID photo during remote signing).

**MVP actions and flows**
- Estimate statuses draft → sent → viewed → approved, declined or expired.
- Approval converts the chosen option and add-ons into lines on the job's draft invoice. It creates the job if missing (B2 `createJob`), sets `setJobEstimate`, and calls `ensureDepositRequest`.
- `captureSignature` with the snapshot hash and policy versions.
- Change-order requirement (threshold % or $) feeds `getChangeOrderStatus`.
- Sequential numbers via counters.
- Invoice lifecycle (status is a cache; balance comes from B4).
- $0 invoices go straight to paid.
- Due terms by customer type.
- Revisions immutable with a version bump.
- Receipts per payment (data from B4).
- Portal access logging via `resolvePublicToken`; rate limit 60/min/IP; branding footer.
- Template sends: `estimate.sent`, `invoice.sent` (resend), `job.link`.

**Later:** financing, templates library, proposal PDF, multi-payer, progress invoicing, lien letters, QBO.

**Tests:** line math and rounding (qty × price, discounts, per-line tax, half-away); revision hash stability (canonical JSON); the `getChangeOrderStatus` threshold; QR encoder output for a known URL; `syncInvoicePaymentState` transitions.

### B4: Payments, deposits, disputes, risk, media

**MVP screens**
- S19 Collect-payment sheet (all methods, tip presets, split payments).
- `/payments`: list, unverified manual items with "Verify" (`payments.verify_manual`), reconciliation (Stripe payouts vs card payments; unmatched flagged; manual unverified more than 3 d), refunds plus scheduled promised refunds.
- `/p/[token]`: Stripe Checkout redirect or manual instructions; success and cancel states.
- `/disputes`: countdowns plus analytics (rate vs 0.75%, by tech, service, source, entry mode, reason; win rate by readiness band).
- `/disputes/[id]`: template narrative (never AI), attach or remove items, Submit or Accept (suggest Accept when under $50 and readiness under 50), copy panel when there is no `PdfRenderer`.
- `/jobs/[id]/evidence`: printable pack in §M10 order, 12 pt+, ≤ 19 pages.
- `/settings/payments`, `/settings/deposits`, `/settings/chargebacks` (risk weights and bands, controls, readiness weights, EFW multiplier, `media.keep_originals`).
- Slots S16–S28.

**MVP actions and flows**
- `recordPayment` (manual): reference required for check, Zelle and Venmo; check photo per setting; unverified until verified; `collected_by`.
- Overpayment guard (UI and server).
- Stripe REST driver (about 250 LOC, form encoding, pinned version, idempotency keys): pay links with itemized lines, shipping, descriptor suffix, metadata, ToS, 3DS when risk ≥ High, 1 h expiry.
- Webhook: HMAC with 5-min tolerance, `webhook_events` idempotency, every type in §8.4, unknown types stored, always 200.
- Fee fetch (`stripe_fee` worker).
- Refunds (role limit, original method; manual driver only records); promised refunds.
- Tips (none on fees by default).
- Fee policy: absorb, cash_discount (default) or surcharge (blocked in CT and MA, capped 2% CO and 3% elsewhere, credit only, warning).
- Deposits: rules engine (all triggers, amount types, min/max, round to $5); modes with fallback to manual without a processor; lifecycle; policy snapshot; link to invoice; hold capture on completion; hold-expiry alert; special-order PO date; waive (`deposits.waive`); suggest a refund when the deposit exceeds the total; state-cap warnings.
- Risk engine (pure `risk.ts`) and readiness engine (pure), persisted, recomputed by handlers (§7.2).
- `evaluateTransitionControls`.
- Card-fingerprint matching.
- Disputes: create, update or close from webhooks; evidence JSON by category; `evidence_pack` job; outcome tracking; EFW refund suggestion.
- Media:
  - S23 gallery (tags, captions, star, compare slider lazy-loaded, soft delete with `photos.delete` audited, evidence-lock rules: no delete when linked to an issued invoice, signature or dispute).
  - Flags `possibly_from_library`, `no_geo`, `far_from_site`.
  - Embedding cascade; stamped CSS overlay; `attachMedia`.

**Later:** Square, Terminal, Tap to Pay, ACH, financing, card-on-file auto-charge, server PDF default, annotations, video, Verifi/Ethoca.

**Tests:** ★ risk score (every signal, band thresholds, `no_estimate_min_ticket` gate, strong_auth and repeat negatives, clamp); ★ readiness (n/a = full credit, photo knock-on when flags are off); ★ deposit rules (priority, each trigger and amount type, rounding, caps, manual fallback); fee split base vs tip (§10.2); surcharge caps; webhook signature verification with a recorded fixture; balance view math including a lost dispute as a refund.

### B5: Messaging, automations, reviews, notifications

**MVP screens**
- `/messages/outbox`: cards (recipient, editable body, due and expiry countdown, GSM segment indicator); Send → `smsHref`/`waHref`; on `visibilitychange` the "Sent? Yes / Not sent / Skip" sheet; Next mode; Copy text; mine or all (`messages.outbox_all`).
- `/messages`: threads.
- `/messages/[customerId]`: bubbles for all channels, S29 composer, "log received reply".
- `/reviews`: sent, click rate, ratings distribution, per-tech leaderboard by clicks, manual "review received" log.
- `/notifications`: grouped, deep links, mark all read.
- `/settings/messaging`: SMS driver display, outbox owner by template, `tech_texts_from` with the admin Banner, link delimiter default, WhatsApp, email from-name, reply phone, digest settings, per-device `sms:` override with "Send test to myself".
- `/settings/templates`: per key, channel and locale; variable picker with live preview; GSM-7 lint; segments; reset to default; review incentive linter; own-domain link rule.
- `/settings/automations`: list with toggles; form editor (timing, anchor, audience, channel, template, conditions); raw JSON for admins; "Send test to me"; "Preview with a real job".
- `/settings/reminders`.
- `/settings/reviews`: Google URL plus "Test link", min days, delay, reminder, rating page, consent basis.
- `/settings/audit`: filters by actor, entity, action, date (`audit.view`).
- Public `/r/[token]` (log click → 302; optional 1–5 page where every rating sees Google and ≤ 3 also sees the callback offer), `/sms-terms`, `/privacy` (generated from settings).
- Slots S29–S37.

**MVP actions and flows**
- `enqueueMessage` and the sender:
  - Re-checks at send time: flag, automation enabled, `cancel_on`, entity state, consent, `do_not_text`, quiet hours 08–20 in the recipient TZ (property timezone → zip-tz → company), defer to 08:00 plus 0–30 min jitter, frequency caps (3 per 24 h non-live automated, marketing 1 per 7 d), template expiry.
  - Link drivers → `pending_tap` with the assigned user.
  - Writes `messages` and activity; emits `message.sent`/`failed`.
- Email HTML and text with branding (Resend over fetch, or console).
- Push via VAPID; prune 410s.
- Consent ledger (`recordConsent`); STOP/START/HELP keywords and natural-language opt-out flags for inbound; "Customer asked us to stop" (S31); first-message and marketing "Reply STOP" footer; bulk send (`messages.bulk_send`, filter preview, ConfirmTyped; unreachable from review screens).
- Automation engine:
  - Wildcard handler; conditions evaluator (no eval; ops `eq…not_exists`); anchors including negative delays.
  - Audiences: customer, `assigned_tech(s)`, `subject_user`, creator, `vehicle_assignee`, office, admins, `perm:`, `role:`, `user:`.
  - Channel resolution for `customer_preferred`; dedupe keys; recompute on reschedule; `fixed_time_local`.
  - Every §7.3 built-in plus the Appendix B ad-hoc templates in `builtin/index.ts`, with default GSM-7 texts.
  - `buildContext` covers every §7.4 variable and mints tokens per send (`job`, `estimate`, `invoice`, `pay`, `review`, `tracking`).
- Custom reminders (all recurrence types).
- Maintenance reminders (marketing consent only).
- Reviews:
  - Eligibility: paid or closed, at most 2 asks, min days between, opted out, `do_not_contact`, test, no-charge callback.
  - Sentiment-neutral hard rule; Yelp is never a target.
  - Consent basis setting; caps count.
- Notifications: `notify()`, per-user prefs, email fallback for critical types (new lead if on call, dispute, cash over limit, settlement ready), daily digest, push subscribe route and client.
- Activity timeline UI (Appendix C mapping); audit viewer.

**Later:** Twilio and Telnyx (interface-complete only), 10DLC wizard, Android gateway, missed-call text-back, team inbox, translations, flow builder, A/B tests, GBP import.

**Tests:** ★ conditions evaluator; ★ quiet hours and deferral (TZ from ZIP, jitter bounds); ★ frequency caps; ★ GSM-7 detection and segment counts; ★ review incentive linter; channel resolution; anchor and negative-delay math, including the "past anchor > expires_after → expired" rule; `smsHref` per UA and override; dedupe on re-emitted events.

### B6: Parts, inventory, payroll, approvals

**MVP screens**
- S39 AddPart sheet (stock, price book, tech-paid "bought it now" with receipt, company card with receipt required).
- `/parts`: my receipts, approvals queue link, unbilled flags, non-job purchases (fuel, vehicle, tool, supplies), new receipt (`?new=receipt`).
- `/inventory` (flag): stock by location (warehouse plus vehicles), par min/max, moves (receive, transfer, use_on_job, adjust, return), avg cost, restock requests (task `restock`, closed by transfer), monthly count variance report.
- `/pay` (tech):
  - Live period balance; per-job lines with the "Why this amount?" trace (§10.5).
  - Cash held with the remit flow (slip photo); pending reimbursements; statements to acknowledge (typed name and IP) and flag lines.
  - Comp-agreement banner.
- `/pay/statements`, `/pay/statements/[id]` (printable pay stub per M16).
- `/pay/settlements` (admin): periods, settlements, flags, approve (`payroll.approve`), record payouts (`payroll.payout`, methods and proof), NACHA export (PPD/CCD, bank-change hold, "Verified" override), CSV for Gusto/ADP (wages vs reimbursements).
- `/pay/settlements/[id]`.
- `/pay/bank`: ABA checksum client and server, account typed twice, checking or savings, personal or business, `direct_deposit_auth` acknowledgment, encrypted at rest, last 4 only.
- `/pay/agreement`: plan rendered with formulas and two worked examples from the tech's rate; S15 e-sign; re-sign on a version change.
- `/approvals`: kinds registry, filtered by decidable perms, Row and Detail, approve, reject, edit-and-approve, "Approve all clean".
- `/settings/commission`: versioned plans with a form plus Advanced JSON (zod `CompPlanSchema`); assignments including per-tech cash overrides and by-service-type rates; pay period config; close delay; negative balance; NACHA company bank info (encrypted); bank-change hold hours; 1099 threshold; mileage rates.
- `/settings/parts`: receipt-required threshold, AI tolerance, inventory options, auto-approve limit (`limits`).
- Reports (in `/pay/settlements`): per-tech settlement and YTD, cash outstanding aging, pending reimbursements, open chargeback holds, job P&L, 1099 totals.

**MVP actions and flows**
- Both money trees per the M15 diagram (`company_stock`/`po`/`card` vs `tech_purchased`).
- Auto-approve rules; AI receipt extraction handler.
- `reimbursement_parts` vs `reimbursement_expense`; `avg_cost_cents` maintenance.
- Warranty-claim task on a callback with reason part.
- Anomaly flags (unbilled part, tech part with no receipt, receipt older than 60 d, parts cost > price).
- Engine (`src/features/payroll/engine/`, pure): every §10 step, tiers, W-2 floor and OT, deduction cap, splits with last-assignee remainder.
- `loadJobFinancialInputs`; recompute with reversal posting; earned_on rules; locking.
- Chargeback hold, release and clawback; recall policy; spiffs including `review_bonus`.
- Custody balance formula; remit and confirm (`cash.receive`); alerts.
- Pay periods; settlement lifecycle with the 48 h tech review; negative balance carry-forward or remittance request.
- Payouts and `payout_settlements`; payout notification event.
- Bank change → `user.bank_changed`, payout hold.
- Comp agreement required → event.
- Approval kinds `part_purchase` and `settlement_flag`; approvals API.

**Later:** supplier POs, price history, core returns, barcode, Stripe Connect, Gusto/ADP APIs, hourly auto-calc beyond the floor check, tier UI beyond Advanced JSON.

**Tests:** ★ commission golden cases A–G from §10.4 exactly, **including F-same-period and F-hold-earlier**; ★ split rounding (case E); ★ W-2 floor and OT (case G, 45 h); ★ deduction cap carry-forward; ★ NACHA file (record lengths 94, blocking factor 10, hash and totals, PPD vs CCD, bank-change exclusion); ★ ABA checksum; ★ custody balance formula (checks never netted); auto-approve rules.

### B7: Vehicles, tools, map

**MVP screens**
- `/vehicles`: fleet list with status, assignee, due badges, open issues.
- `/vehicles/[id]`: tabs Overview, Logs (odometer, fuel, inspections), Service, Docs, Issues, Trips. Create and edit with VIN decode (vPIC), USDOT fields when GVWR ≥ 10,001, photos, tank size, ownership. Recalls.
- My Vehicle for techs is `/vehicles/[id]` of the assigned vehicle with a limited view. Forms are hidden with "Ask your admin…" when the policy says techs can't log.
- `/vehicles/approvals`: vehicle kinds with full-size image vs typed vs AI values, confidence chip, previous reading, flags, bulk "Approve all clean".
- `/settings/vehicles`: policies per entry type, inspection frequency, `require_odometer_on_clock`, reminder seeds.
- `/tools` (flag): mine or all.
- `/tools/[id]`: detail, history, check-out and check-in.
- `/tools/[id]/theft-report`: printable.
- `/tools/audits/[id]`: photo per tool; missing → incident.
- `/tools/labels`: QR sheet generated in the browser.
- `/settings/tools`: deductions OFF ⚖️, audit frequency, maintenance defaults, agreement text.
- `/map` (flag; Leaflet dynamic import, tile env):
  - Tech markers with initials, status ring, staleness fade (> 15 min grey, > 60 min hidden unless toggled), accuracy halo above 100 m.
  - Today's job pins; job sheet with S9.
  - Side list or bottom sheet with current and next job and an ETA chip.
- `/settings/map`.
- `/t/[token]`: only while the job is `en_route` (≤ 3 h); tech card, ETA, company phone, last-known position on a small static map (single OSM tile composite or lazy Leaflet within budget).
- Slots S46–S53.

**MVP actions and flows**
- Odometer, fuel (MPG; tech-paid → B6 `createPartPurchase` category fuel), service records (paid by tech → part purchase category vehicle; AI shop invoice → suggested tasks; reminder reset only on approval), documents with expiry reminders, DVIR-lite inspections, issues (response timer, acknowledge, resolve), trips (auto-draft on `time.clocked_out`; classification; tech-owned → `reimbursement_mileage` via `postLedgerEntry` at `mileage_rates`).
- `resolveVehicleLogPolicy` (pure, §M17 order) plus rules-first anomaly flags that always force review.
- `createApproval` when review is needed; approval kinds.
- Gemini assist via `queueAiTask` (free tier never sends registration or insurance documents); manual fallback always.
- Fleet reports.
- Tools: CRUD (photos required; `tool_label` AI prefill); kits; scan check-out with `BarcodeDetector` or manual select; condition and photo at handoff; tech acknowledgment; block when calibration is overdue or the tool is `in_repair`.
- Audits and incidents. A `tech_responsibility` decision creates a pending `tool_deduction` (via `postLedgerEntry`, `needs_review`) only when deductions are enabled and not blocked for W-2 by the compliance profile.
- Maintenance log resets the due date (tech-paid → part purchase category tool).
- `uses_company_tools` gating; tech-owned registry.
- `/api/location`: session, `location.share`, clocked in (B2 `getClockStatuses`), monitoring notice acked, at most 1 per 30 s per user. Upserts `tech_locations`; optional breadcrumbs.
- `recordStatusLocation`.

**Later:** OBD and telematics, fuel-card import, AI monthly summary, Bluetooth tags, depreciation, route playback, geofence auto-arrive, nearest-tech suggestion.

**Tests:** ★ `resolveVehicleLogPolicy` (all four steps, the trusted override, anomaly forces review); ★ anomaly rules (odometer backwards or jump, gallons > tank, MPG drop > 20%, two fuel buys the same day, odometer unchanged, weekend); reminder forecast; MPG; stale-marker classification.

### B8: Team, settings, insights

**MVP screens**
- `/team`: avatar, role, status, worker type, clocked in (B2 batch), cash held (B6 batch), agreement status, tool audit status. Invite sheet: name, email or phone, role, worker type → F `createInvite`, delivered via `enqueueMessage` template `user.invite` (email, and/or `sms:` link).
- `/team/[id]`: §5.3 composition; all M02 profile fields; role change; deactivate (in-tx `revokeAllSessions` plus `deletePushSubscriptions`, `user.deactivated`, then S7 and the cash flag); admin reset link (`createPasswordResetLink`); worker type switch with ⚖️ notes; link to overrides.
- `/settings` index (grouped list filtered by perms and flags) and `layout.tsx`.
- `/settings/company` (including business hours, after hours, service ZIPs, `auth.open_signup`, `insights.show_tech_rank`).
- `/settings/branding`: accent color with contrast check and an auto-derived `--accent-text`; logos; app name; invoice header style; `getBrandingStyle`.
- `/settings/services`: every service-type field.
- `/settings/taxes`.
- `/settings/compliance` ⚖️.
- `/settings/tags`, `/settings/custom-fields`, `/settings/checklists`.
- `/settings/features`: all manifest flags with descriptions.
- `/settings/permissions`: module × role grid from manifests; locks (admin keeps `settings.permissions` and `users.manage`; at least one active admin); audited.
- `/settings/permissions/users/[id]`: Inherit, Allow or Deny; non-admins can't be granted `settings.permissions`.
- `/settings/integrations`: secrets write-only showing last 4; env wins; test buttons per adapter; VAPID public key display.
- `/settings/profile`.
- `/insights`, three role variants:
  - Admin: every KPI in the M20 table with the exact formulas, period selector, Δ vs the previous period, tech leaderboard, lead-source ROI, fleet (S52), weekly anomaly report card with every listed signal.
  - Office: Ops.
  - Tech: My Stats with S42.
  - Every number links to the filtered list (Appendix A).
  - `reports.export` CSV.
  - Hand-rolled SVG charts from the UI kit.
- S54 `OpsToday` (office dashboard list in M20 plus the M01 setup checklist card for admins).

**MVP actions and flows**
- Tags and custom-fields APIs and slots (S55, S56) with entity-perm checks.
- Service types and checklists used by B2.
- Settings writes only via `updateSettings` (audited).
- Permission grid and overrides (`permission.changed`).

**Later:** saved reports, scheduled digests beyond the daily one, goals, availability calendar, skills-based dispatch, subcontractor role.

**Tests:** KPI SQL on a seeded PGlite: median speed-to-lead, close rate, AR aging buckets, payroll cost %, callback rate, dispute rate; the permission-grid locks; contrast calculation.

---

## 10. Demo seed plan

### 10.1 Mechanics (F builds these; frozen)
- **Command:** `npm run seed:demo [-- --reset]` runs `scripts/seed.ts`, which does:
  1. migrate
  2. **base seed** (§15.3: roles, grants, counters, policies v1, all templates and automations from `builtinTemplates`/`builtinAutomations`, comp plan `partner_25` v1, mileage rate 2026, generic service types, default deposit rules, tax placeholder)
  3. the demo fragments in the order of §10.3

  `--reset` truncates every domain table first. Without it, the runner refuses when demo users already exist.
- **Deterministic IDs:** `src/db/seed/demo-ids.ts` exports `seedId(ns: string, key: string|number): string`. It is a UUID v4-shaped value derived from `sha256('crm-seed:' + ns + ':' + key)`: hex formatted 8-4-4-4-12 with version nibble 4 and variant 8. Base and demo seeds use it everywhere, so fragments reference each other **without** querying. Examples: `seedId('job', 12)`, `seedId('service_type', 'repair')`, `seedId('pricebook', 'rekey_cyl')`.
- **Shared plan:** `src/db/seed/demo-plan.ts` (F) exports `DEMO`. It is a pure, deterministic data object (rng `mulberry32(42)`; date offsets relative to `ctx.now`) and the **single source of truth** for cross-referenced demo data:
  - `DEMO.company`, `DEMO.users`, `DEMO.pricebook`, `DEMO.customers`, `DEMO.leadSources`, `DEMO.leads`, `DEMO.jobs`, `DEMO.vehicles`, `DEMO.tools`
  - for every job: lines (pricebook keys, qty, price, cost, part_source), precomputed `totals` (8.25% tax on taxable lines, per-line half-away), payments, deposit, estimate outcome, parts, photo counts, review state, flags
- **Fragment contract:** `seedDemo(db: DB, ctx: DemoSeedCtx)` with `ctx = { now: Date /* frozen */, tz: string, plan: typeof DEMO, at(dayOffset: number, hhmm: string): Date, rng(): number /* forked per fragment */, log(msg: string): void }`.
- **Fragment rules**
  - Write **only your own tables** (§3.2).
  - Exceptions: you may call other groups' API functions **whose stub level is F**: `createTask`, `createApproval`, `postLedgerEntry`, `setJob*` setters, `addNote`, `setEntityTags`, `setCustomerFlags`. You may also call F libs: `writeActivity`, `writeAudit`, `mintPublicToken`, `seedPlaceholderMedia`.
  - **Never emit events.** Automations must not fire on seed data.
  - Plan totals are authoritative: B3 stores `total_cents` from `plan.jobs[n].totals`, and B4's payments sum to them.
  - Use `onConflictDoNothing` so a fragment can be rerun.
  - Drive your **own engine** where one exists. B6 runs `recomputeJobFinancials` and period close; B4 runs the risk and readiness engines. Don't hand-write derived rows.
- **Media helper** (F, `src/db/seed/helpers.ts`): `seedPlaceholderMedia(db, { id, kind, tag, entity?, jobId?, customerId?, label, color, capturedAt, geo? })`. It writes a small generated PNG (pure `node:zlib`, labeled color block; thumb and full) through the storage adapter, inserts the `media` row with a sha256, and returns the id. It is the only way fragments create media.

### 10.2 Fixed identities and demo shape (in `DEMO`)

| Thing | Value |
|---|---|
| Company | "Acme Home Services" (legal "Acme Home Services LLC"), TZ `America/Chicago`, state TX, Austin TX 78701, phone +1 512-555-0100, service ZIPs 78701–78759, every feature flag ON (tools and inventory included), `PAYMENTS_DRIVER` manual. Card payments are stored as provider `stripe` with fake `pi_demo_<n>` refs so card analytics and disputes have data. |
| Password | All demo users use `demo1234`. The seed hashes it directly and bypasses the signup policy. |
| Admin | `seedId('user','admin')`, admin@demo.test, "Alex Morgan" |
| Office | `seedId('user','office')`, office@demo.test, "Olivia Chen" |
| Tech 1 | `seedId('user','tech1')`, tech1@demo.test, "Tom Rivera": 1099, `partner_25`, keeps cash with `net_in_payout`, Van 1, has `vehicles.log_trusted` override, bank details changed 2 days ago (payout hold) |
| Tech 2 | `seedId('user','tech2')`, tech2@demo.test, "Maria Lopez": W-2 (forced `separate_remittance`), Van 2 |
| Tech 3 | `seedId('user','tech3')`, tech3@demo.test, "Sam Patel": 1099, override `tech_keeps_cash=false`, tech-owned "Sam's Tacoma" (mileage reimbursement), agreement **unsigned** (banner), override 5000 bps on service type `after_hours_lockout` |
| Monitoring notice | All techs have `monitoring_notice_ack_at` set |
| Pending invite | "Jordan Blake" (tech), created by B8 |
| Customers | 40 customers, `seedId('customer', 1..40)`. C1–C3 are property managers or commercial (net 30) with 3 properties each; C4 is home_warranty; C6 VIP; C7 has a dispute (gets `dispute_history`); C8 is `prepay_required`; C12 opted out (consent revoke); C13 `do_not_text`; C20 has an unsold estimate with no job; C3 is the returning lead. C9 and C10 have 2 properties each. That makes 48 properties: `seedId('property', 'c<n>-<k>')`, Austin streets with preset lat/lng (no geocoder needed), `geocode_status 'ok'`, timezone `America/Chicago`. |
| Lead sources | `seedId('lead_source', 'website'\|'google_lsa'\|'thumbtack'\|'referral'\|'phone')`. The website source uses `pk_demo_website0001` and is a JS snippet. Thumbtack and LSA have per-lead costs. There are 2 months of `source_spend`. |
| Leads (25) | L1–L8 booked (converted to jobs J88, J77, J78, J80, J70, J55, J40, J30). L9–L14 new: created 2, 4, 12 and 40 min ago; L13 has a high spam score ("Check"); L14 is returning (C3). L15–L18 contacted (L15 has a no-answer call plus a `lead_retry` task). L19–L20 qualified. L21–L23 lost (price, timing, out of area). L24 spam (honeypot). L25 lost (no answer). |
| Price book | About 30 items, `seedId('pricebook', key)`: services (service call $89 fee line, lockout, rekey per cylinder, opener install, spring replacement, water-heater flush, AC tune-up, drain clear, handyman hour), parts (cylinders, springs, opener, capacitor, thermostat, wax ring, …, with costs), one special-order part (`is_special_order`), and fees (after-hours premium, trip fee, cancellation fee) |

**Jobs (`seedId('job', n)`, numbers J-1001…J-1090).** Tech assignment rotates, and 6 jobs have a helper at a 50/50 split.

| n | When | Status and money |
|---|---|---|
| 1–60 | Past, days −60…−2 | Completed, or closed when paid and inside a locked settlement. Payment mix: card 30 (5 with a prior card deposit: J10, J20, J30, J40, J50), cash 12 (collected by the tech; tech1's netted, tech2's and tech3's remitted), check 4, Zelle 4, Venmo 2, unpaid AR 6 (J55–J60, ages spread across 0–30 and 31–60). 20 had approved estimates (6 with good/better/best). 20 used company-stock parts and 10 tech-purchased parts (approved). Before/after photos (≥ 2 + 2) on 30 jobs. J12 has the **dispute**. J25 a partial refund of $50. J33 was revised after payment (anomaly) plus a promised refund due in 2 days. J45 is a no-charge callback of J15 (workmanship; a $0 invoice → paid). J46 is a callback of J16 (reason part → warranty task). |
| 61–66 | Past | Cancelled: customer_cancelled, customer_no_show (fee line), price, duplicate, weather. **J66 was cancelled after arrival** (tech2, with a note and photo; `cancel_review_status` pending; approval `job_cancel`). |
| 67–68 | Past | `on_hold`. J67 waits for a special-order part (deposit paid, `special_order_po_at` set). J68 waits for customer approval. |
| 69–76 | Today | tech1: J69 completed (cash $300 kept), J70 `in_progress`, J71 scheduled for the afternoon. tech2: J72 completed (card plus tip), J73 `en_route`, J74 confirmed for the afternoon. tech3: J75 `arrived`; J76 scheduled at **Critical** risk with a pending `job_start` approval. |
| 77–87 | Days +1…+14 | J77 and J78 tomorrow and **unconfirmed**; J79 tomorrow, confirmed, with a sent estimate (unsold); J80 has an unpaid required deposit; J81 is a recurring maintenance job; J82 has a viewed estimate; the rest are a mix of scheduled and confirmed. |
| 88–90 | — | Unscheduled queue. J88 comes from lead L1. |

**Other demo records**
- One open dispute: J12, C7, card $600, `product_unacceptable`, `needs_response`, `due_by` now + 5 d, readiness at open 72.
- Two declined estimates and one expired.

### 10.3 Fragment order, owners and contents

| # | File | Owner | Writes |
|---|---|---|---|
| 0 | `src/db/seed/base.ts` | F | Base seed (§10.1) |
| 1 | `src/db/seed/demo-core.ts` | F | Company profile and settings (features all on), 5 users with password hashes and monitoring acknowledgment |
| 2 | `src/features/team/seed.ts` | B8 | User profiles (colors, license #s, skills, service ZIPs, home base), the tech1 override, Jordan's invite (via F `createInvite`) |
| 3 | `src/features/settings/seed.ts` | B8 | Tags (VIP, Complaint, Commercial, Warranty), custom-field defs (property "Lock brand", "Door model"; vehicle "Fuel card #"), checklist templates ("Ownership check": ID photo, proof-of-address photo, authority signature; "Standard repair"), extra service type `after_hours_lockout`, tax rate 8.25% default; tags applied to customers and jobs |
| 4 | `src/features/pricebook/seed.ts` | B3 | `pricebook_items` from `DEMO.pricebook` |
| 5 | `src/features/customers/seed.ts` | B1 | Customers, properties, calls (on leads), notes via B2 `addNote` (5 customers) |
| 6 | `src/features/leads/seed.ts` | B1 | Lead sources, `source_spend`, leads, `lead_events` (received, touch, call_attempt), `api_keys` (one), the L15 `lead_retry` task via `createTask` |
| 7 | `src/features/jobs/seed.ts` | B2 | Jobs (statuses, timestamps, windows, checklist answers, `payment_status` from the plan), assignments, `job_status_events` with geostamps near properties, notes, `job_cancel` and `job_start` approvals via `createApproval`, 2 custom tasks |
| 8 | `src/features/time/seed.ts` | B2 | `time_entries` for 60 days (Mon–Sat; today's entries open for all 3 techs) |
| 9 | `src/features/estimates/seed.ts` | B3 | Estimates, options, lines, change order (J41, signed), estimate signatures, `public_tokens` for sent estimates |
| 10 | `src/features/invoices/seed.ts` | B3 | Invoices (`seedId('invoice', n)`), lines (`part_source`; tech-purchased lines carry `part_purchase_id = seedId('part_purchase', 'j<n>')`), J33 revision, credit note on J25 if needed, completion signatures on 40 jobs, comp_agreement signatures for tech1 and tech2 (`seedId('signature','comp-tech1'\|'comp-tech2')`, `doc_id = seedId('tech_comp','tech1'\|'tech2')`) |
| 11 | `src/features/media/seed.ts` | B4 | Job photos (before, after, problem; some starred `include_in_invoice`; evidence-locked where invoiced) via `seedPlaceholderMedia` |
| 12 | `src/features/payments/seed.ts` | B4 | `deposit_requests`, payments per plan (manual ones verified except 3 unverified older than 3 d; cash `collected_by`), refunds (J25 succeeded, J33 scheduled), risk assessments plus readiness via its engines, then `setJobRisk`/`setJobReadiness` |
| 13 | `src/features/disputes/seed.ts` | B4 | The J12 dispute, evidence JSON, auto narrative; `setCustomerFlags(C7, disputeHistory)` |
| 14 | `src/features/messaging/seed.ts` | B5 | Consent (34 transactional grants from web_form or verbal, 10 marketing, C12 revoke), messages for 15 threads (booking, on-my-way, receipts `sent_manual`, one logged inbound reply), outbox `pending_tap` (office: tomorrow's reminders for J77 and J78 plus 2 review requests; tech2: on-my-way for J73), future `scheduled_messages` for upcoming jobs via its engine |
| 15 | `src/features/reviews/seed.ts` | B5 | `review_requests` for 30 jobs: 18 clicked; ratings 5, 5, 4, 2 (the 2 has `wants_callback` → `callback_customer` task) |
| 16 | `src/features/notify/seed.ts` | B5 | A few unread notifications per user; two custom reminders ("Monday 8:00 fuel receipts"; a customer dryer-vent yearly reminder) |
| 17 | `src/features/vehicles/seed.ts` | B7 | 3 vehicles; 60 days of odometer readings (approved); fuel about 2 per week each; pending V2 odometer jump plus a fuel log with gallons > tank (approvals via `createApproval`); V1 oil change at −40 d; V2 oil change **overdue**; V1 insurance expiring in 10 d; weekly inspections; open V2 issue ("check engine light", unacknowledged); V3 business trips with approved trips and mileage via `postLedgerEntry` |
| 18 | `src/features/tools/seed.ts` | B7 | 12 tools (incl. a key machine with calibration due in 5 d), kit "Locksmith kit" → V1, assignments with acknowledgment, tech1 audit due tomorrow, tech2 submitted audit with one missing → incident (lost, pending), one maintenance log |
| 19 | `src/features/map/seed.ts` | B7 | `tech_locations` for 3 techs (tech1 at J70, tech2 between J72 and J73, tech3 at J75), recent |
| 20 | `src/features/parts/seed.ts` | B6 | `part_purchases` (10 tech-paid approved, 2 pending with approvals, 1 rejected, 3 company card, 4 tech3 fuel purchases → `reimbursement_expense`); stock locations (warehouse, V1, V2), levels for 15 items (3 below par), moves; an open restock task |
| 21 | `src/features/payroll/seed.ts` | B6 | `tech_comp` with `id = seedId('tech_comp', key)` and `agreement_signature_id` pointing at B3's seeded signatures (tech3 has none), weekly pay periods covering −63…+7 d, `recomputeJobFinancials` for every completed job, chargeback hold for J12, period closes (older → locked and paid with payouts by Zelle or `ach_nacha`; last week → `tech_review` with a tech1 flag → approval row; current week open), `cash_remittances` (tech3 daily confirmed; tech2 one pending), tech1 bank details (test routing 011000015, encrypted, `bank_changed_at` −2 d) |
| — | `src/features/data/seed.ts`, `insights/seed.ts`, `automations/seed.ts`, `portal/seed.ts`, `signatures/seed.ts`, `tasks/seed.ts`, `approvals/seed.ts`, `tech/seed.ts`, `disputes` (already listed) | each owner | No-op exports (keep the file so the runner's import list is static) |

After all fragments, F's runner calls `processEvents()` once with an empty queue and prints the counts. **Acceptance:**
- seed:demo finishes in under 60 s on PGlite and runs twice cleanly (second run refuses without `--reset`)
- every route renders for every demo user (§12)
- `/approvals` shows 6 kinds
- `/insights` has non-zero values for every KPI

---

## 11. Rules of engagement for parallel builders

### 11.1 Ownership
1. **Edit only the files you own** (§3). Don't reformat, "fix" or lint-autofix anyone else's file, including shared ones. Run Biome only on your own paths: `npx biome check --write <your paths>`.
2. **Cross-group imports** are allowed only from:
   - `@/features/<m>/api`
   - `@/features/<m>/contracts`
   - `@/features/<m>/slots`
   - `@/features/<m>/slots.client`
   - route URLs as strings

   **Never import** another group's `actions.ts`, `queries.ts`, `components/**`, `engine/**` or `seed.ts`. The F libraries (`@/lib/*`, `@/ui/*`, `@/db`, `@/adapters/*` factories, `@/client/*`) are open to everyone.
3. **Vendor drivers stay inside adapters.** Only adapter stewards touch drivers. Features call the factories (`getPayments()`, …), and only B5 calls messaging, email and push. Everyone else sends through `enqueueMessage` or `notify`.
4. **No new dependencies. No `npm install`.** Never run `next build` or `next dev` (they clobber `.next`). `npx tsc --noEmit` is always fine; filter its output to your paths while others are mid-edit. Run tests with `npx vitest run <your paths>`.
5. **DB experiments** go to a private dir: `PGLITE_DIR=/private/tmp/claude-501/-Users-guybuganim-Code-CRM/00dea14e-68c4-4ad0-9c3b-c65e4de2bcc0/scratchpad/pglite-<group>`. Never touch `./.data`.
6. Never `git commit`. Put throwaway files in the scratchpad.

### 11.2 Documented exceptions (the only cross-owner writes)

| Exception | What is allowed |
|---|---|
| B1 customer **merge** | Direct `UPDATE … SET customer_id = :survivor` (and `property_id`) on every table with those columns: `jobs`, `leads`, `estimates`, `invoices`, `payments`, `messages`, `consent_events`, `media`, `notes`, `activity`, `tasks`, `review_requests`, `public_tokens`, `calls`, `properties`, `scheduled_messages`. One transaction, audited, with a `merged_into_id` tombstone. |
| B1 **anonymize** | Writes `customers` and `properties` directly, then calls B5 `anonymizeCustomerMessages`. |
| B1 **reset demo data** | Calls F's truncate helper (`src/db/seed/helpers.ts#truncateDomainTables`); never ad-hoc deletes. |
| B6 **avg cost** | Updates `pricebook_items.avg_cost_cents`. |
| B6 bank details, B5 notification prefs | Write their `users` columns (§3.2). |
| Page-level settings writes | Allowed only for the keys listed in §3.4. |
| B3 public signing uploads (integration) | `src/features/signatures/public-upload.server.ts` inserts `media` rows for `/e/[token]` remote-signing uploads (same shape as F's upload routes). |
| B1 `/settings/lead-sources` (integration) | Also edits `company.lead_response_minutes` (B8 namespace), as SPEC lists it in the lead settings. |

### 11.3 Frozen contracts
- §5 props, §6 signatures, §7 event names and payloads, permission keys, flag keys, route paths and settings key names are **frozen**.
- You **may** add optional props or optional input fields, new **internal** functions, new routes **under your own route prefix**, new settings keys in your own fragment, and new activity kinds.
- **Schema is frozen.** If you need storage:
  1. use an existing jsonb (`custom`, `payload`, `data`, `raw`, `evidence`, `extra`, `settings`, `ai_extract`, `results`)
  2. mark it `// TODO(schema): <proposal>`
  3. put the proposal in your report

  Never run `npm run db:generate` and never edit `drizzle/**`.
- **Stubs.** When a dependency is still a stub (T throws, M is simplified), code against the contract anyway:
  - Catch `NotImplementedError` only where a missing feature should degrade gracefully, such as an empty panel.
  - Mock the dependency in your tests.
  - **Never implement someone else's stub inside their file.** Also never copy it into yours beyond a temporary local shim marked `// SHIM(<group>.<fn>)`.

### 11.4 Requesting a contract change
Add a **"Contract change requests"** section to your final report. Each entry gives:
- the contract
- the current signature
- the proposed signature
- the reason
- the consumers affected
- a backward-compatible interim you used, if any

The integrator reconciles all requests after the eight builders finish. Don't coordinate by editing each other's files. **Ambiguity rule:** if this plan and SPEC disagree on behavior, follow SPEC and note it; if they disagree on ownership or signatures, follow this plan.

### 11.5 Definition of done (per builder)
- Every MVP item in your §9 checklist is implemented. Stubs you own are all replaced: no `NotImplementedError` and no `SlotPlaceholder` left in your dirs.
- `npx tsc --noEmit` shows no errors in your paths.
- `npx biome check <your paths>` is clean.
- Your golden and unit tests pass (`npx vitest run <paths>`).
- Your seed fragment runs on a fresh private PGlite after the earlier fragments; if they're still stubs, run yours on top of the base seed and guard on missing rows.
- Every server action uses `action()` with a perm, zod and audit where SPEC requires. Every mutation emits its events and writes activity.
- Every slot returns `null` for an unauthorized viewer or when its flag is off.
- No client component imports `server-only` code. No route-specific client bundle obviously exceeds 30 KB gz: lazy-load sheets, the signature pad, compare, drag and Leaflet.
- `src/features/<m>/README.md` covers what the module does, the key flows and the extension points.
- **Final report** contains:
  - files created or changed
  - contracts implemented (stub replaced: yes or no)
  - contract change requests
  - schema TODOs
  - known gaps vs §9
  - tests run, with output summary
  - suggested `docs/MODULES.md` paragraph and `docs/budget.md` entries

---

## 12. Integration checklist (final integrator)

1. **Reconcile:** apply the §11.4 change requests and schema TODOs (one new migration via `npm run db:generate`; never edit applied ones); remove `SHIM(...)` blocks; grep must be empty for `NotImplementedError`, `SlotPlaceholder`, `TODO(contract)`, `SHIM(`.
2. **Static checks:** `npm run typecheck`, `npm run lint`, `npm test` (all golden suites: commission including the F variants, NACHA, risk, readiness, deposit rules, template, permissions, leads, vehicle policy, conditions, quiet hours).
3. **Contract hygiene greps:**
   - No `'use server'` in any `api.ts`.
   - No cross-group imports of `actions`, `queries`, `components` or `engine` (a script walks the import specifiers and checks owners per §3.1).
   - No INSERT, UPDATE or DELETE on non-owned tables outside §11.2 (grep `db.insert(`/`tx.update(` table identifiers per dir).
   - No vendor SDKs; no banned libraries (§14); no `'use cache'`, `cacheTag` or `updateTag`; no `cacheComponents`/PPR in `next.config.ts`.
   - No driver calls outside adapters and B5 (and B4 for payments).
   - No `localStorage` without try/catch.
4. **Registry coverage:**
   - Every `EventType` has a handler or an explicit ignore (type-level check passes).
   - Every §7.3 automation and every Appendix B template exists in `builtin`.
   - Every perm in `DEFAULT_GRANTS` is referenced by at least one `action()` or `requireUser()`.
   - Every route in §3.3 exists. Every settings page in §3.4 is in the settings index.
5. **Database:** delete `./.data/pglite`, `npm run seed:demo` (under 60 s), rerun (refuses), `npm run seed:demo -- --reset` (clean). Check the counts against §10.2.
6. **Build:** `npm run build` (the first allowed full build). Then `npm run analyze`: shell ≤ 150 KB gz, ≤ 30 KB per route (map excluded), CSS ≤ 25 KB, `embed.js` ≤ 3 KB gz. Record any exceptions in `docs/budget.md`.
7. **Route smoke test.** Start `npm run start` and log in as each demo user. GET every authenticated route in §3.3 with the demo IDs: expect 200, or a redirect or 403 where the role lacks the perm. GET each public route with a freshly minted token. Expect no server errors in logs.
8. **End-to-end flows** (scripted where possible):
   1. curl JSON lead → appears in the inbox with the SLA timer → `lead_ack` pending in the outbox.
   2. Convert → `/jobs/new` prefilled → schedule → `booking_confirm` and reminders scheduled.
   3. Tech: On my way (outbox card plus the `/t/` link live) → Arrived (tracking dead) → Start (estimate guard on a Medium job) → before and after photos → Complete (readiness sheet, completion signature) → invoice issued → Collect cash → receipt `pending_tap` → custody pill updates → `job_financials` and ledger lines present.
   4. Portal `/e/` sign plus deposit link; `/i/?receipt=` flag → admin alert plus callback task.
   5. Stripe webhook fixtures replayed twice (idempotent) → payment, fee, `dispute.created` → hold posted.
   6. Cron tick with a faked clock: pay period closes → settlement `tech_review` → approve → payout → locked → job `closed`.
   7. Vehicle odometer jump → `/approvals` → approve → reminders recomputed.
   8. Offline: toggle network off, change status, add a note and a photo → back online → synced once (no duplicates).
9. **Flags off:** turn off tools, inventory, map, photos and before_after, estimates and deposits. Their nav disappears, actions return `FeatureDisabledError`, the readiness photo item is n/a, and no page crashes.
10. **Permissions:** run the tech-masking and row-scope spot checks (a tech can't open another tech's job, invoice or customer outside the window); `/approvals` shows only decidable kinds.
11. **Lighthouse** on `/today`, `/jobs/[id]`, `/i/[token]` (LCP < 2.5 s on mid-range mobile, INP < 200 ms). Reduced-motion and dark mode spot check. Print preview of the invoice, evidence pack and pay stub.
12. **Docs:** update `CLAUDE.md` (§15.5 outline with npm commands and the amendments), `docs/MODULES.md` (from the builder reports), `docs/CHANGELOG.md`, `docs/budget.md`, `docs/DEPLOY.md` (cron worker, `CRON_SECRET`, VAPID, R2, append-only grants).

---

## Appendix A: URL and query contracts (deep links and drill-downs)

List pages must accept these params. Insights (B8), notifications and Ops Today link to them.

| Route (owner) | Params |
|---|---|
| `/jobs` (B2) | `status=a,b`, `tech=<userId>`, `from=`, `to=` (YYYY-MM-DD), `mine=1`, `callback=1`, `cancelledAfterArrival=1`, `unassigned=1`, `unconfirmed=1`, `noInvoiceAfter48h=1`, `q=` |
| `/jobs/[id]` (B2) | `tab=overview\|photos\|estimate\|invoice\|parts\|messages\|history`, `action=collect\|complete\|assign` (opens the sheet) |
| `/jobs/new` (B2) | `customerId`, `propertyId`, `leadId`, `callbackOf`, `date` |
| `/schedule` (B2) | `view=day\|3day\|week`, `date=`, `tech=` |
| `/leads` (B1) | `status=`, `source=`, `from=`, `to=`, `filter=check\|breached\|mine` |
| `/customers` (B1) | `q=`, `type=`, `tag=`, `flag=` |
| `/estimates` (B3) | `status=`, `tech=`, `from=`, `to=`, `unsold=1` |
| `/estimates/new` (B3) | `customerId`, `propertyId`, `jobId`, `leadId` |
| `/invoices` (B3) | `status=`, `aging=0-30\|31-60\|61-90\|90+`, `tech=`, `source=`, `revisedAfterPayment=1`, `from=`, `to=` |
| `/payments` (B4) | `tab=all\|unverified\|reconciliation\|refunds`, `method=`, `tech=`, `from=`, `to=` |
| `/disputes` (B4) | `status=` |
| `/messages/outbox` (B5) | `scope=mine\|all` |
| `/reviews` (B5) | `from=`, `to=`, `tech=` |
| `/parts` (B6) | `tab=mine\|approvals\|unbilled\|nonjob`, `new=receipt` |
| `/pay/settlements` (B6) | `period=<id>`, `status=` |
| `/approvals` (B6) | `kind=<ApprovalEntityType>` |
| `/vehicles/[id]` (B7) | `tab=overview\|logs\|service\|docs\|issues\|trips`, `log=odometer\|fuel\|service\|inspection\|issue` (opens the form) |
| `/tools` (B7) | `scope=mine\|all`, `status=` |
| `/tasks` (B2) | `scope=mine\|all`, `kind=` |
| `/insights` (B8) | `period=today\|week\|month\|last30\|custom`, `from=`, `to=` |

**Notification and activity deep links:** `entity.url` is always one of the routes above.

## Appendix B: Template keys B5 must seed in addition to §7.3

| Key | Channel / purpose | Used by |
|---|---|---|
| `lead.ack_after_hours` | sms+email / transactional | the `lead_ack` automation (spec note) |
| `lead.no_answer` | sms / transactional | B1, after a no-answer call |
| `estimate.sent` | preferred / transactional | B3 send estimate |
| `change_order.sent` | preferred / transactional | B3 send change order |
| `invoice.pay_link` | preferred / transactional | B4 "send pay link" from S19 |
| `job.link` | preferred / transactional | B2 or B3 "send job page link" |
| `user.invite` | email+sms / internal | B8 invites (audience `address`) |
| `user.password_reset` | email / internal | F reset flow and B8 admin reset |
| `staff.generic` | push+in_app / internal | `notify()` default |
| `staff.lead_touched` | push / internal | B1 `lead.touched` |
| `staff.remittance_request` | push / internal | B6 negative balance with `request_remittance` |
| `staff.optout_review` | in_app / internal | B5 `message.optout_detected` |
| `staff.inspection_due` | push / internal | B7 start of day |

## Appendix C: Activity kinds and timeline filters (S33)

`activity.kind` is the event type, or `<entity>.<verb>` for non-event entries. Examples: `note.added`, `call.logged`, `invoice.line_added`, `customer.viewed`. Never put PII-sensitive data in `summary`.

| Filter chip | Kinds (prefix match) |
|---|---|
| Messages | `message.`, `consent.`, `call.`, `review.` |
| Jobs | `job.`, `estimate.`, `change_order.`, `lead.`, `photo.`, `signature.` |
| Money | `invoice.`, `payment.`, `refund.`, `deposit.`, `dispute.`, `efw.`, `credit_note.` |
| Notes | `note.` |
| All | everything except `customer.viewed` |

## Appendix D: Nav badge keys (`badges.ts`)

| Key | Owner | Count |
|---|---|---|
| `leads.new` | B1 | Leads `new` with `spam_score` under the review line (= the New chip; the same number for everyone since the leads flow redesign) |
| `jobs.needs_tech` | B2 (`jobs/badges.ts`) | Booked jobs needing a tech: arrival start today or later (company zone), not cancelled/closed/completed, no `job_assignments` row (`dispatch/needs-tech.ts`, also the Assign hub's queue header); 0 without `jobs.assign`. Shown on Assign; the More tab carries it |
| `messages.outbox` | B5 | `pending_tap` assigned to me (all, with `messages.outbox_all`, on the office's Today) |
| `notifications.unread` | B5 | Unread notifications (bell) |
| `approvals.pending` | B6 (`approvals/badges.ts`) | `countPendingApprovals(user)` |
| `tasks.due` | B2 (`tasks/badges.ts`) | My open tasks due by end of today |
| `invoices.overdue` | B3 | Overdue invoices (`invoices.view`, office and admin) |
| `disputes.open` | B4 | Disputes `needs_response` |

Badges are red only for critical counts (`disputes.open`, overdue SLA). Everything else uses the neutral tone (§12.6 TabBar).
