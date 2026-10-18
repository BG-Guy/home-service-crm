# Home-Service CRM

A lightweight, iOS-styled, single-tenant CRM boilerplate for home-service businesses —
locksmiths, garage doors, HVAC, plumbing, handyman. One business per deployment: clone it,
brand it, deploy it. Installable as a PWA on iPhone and Android.

- **Office:** leads inbox with SLA timers, customers and properties, schedule and dispatch,
  estimates (good/better/best, e-sign), invoices, payments (manual + Stripe), chargeback
  protection, messaging with consent and quiet hours, automations, reviews, insights.
- **Technicians:** "My Day", job status with geostamps, photos, signatures, parts and
  receipts, cash custody, earnings and pay statements, vehicles and tools.
- **Stack:** Next.js 16 (App Router, Turbopack), React 19.3, Drizzle ORM on Postgres
  (embedded PGlite in development), Tailwind 4, zod, a hand-built iOS component kit.
  No UI kit, no vendor SDKs, no auth library.

The full product and technical spec is [`docs/SPEC.md`](docs/SPEC.md). Working on the code?
Start with [`CLAUDE.md`](CLAUDE.md).

## Quick start (zero config)

Requires Node 24.

```bash
npm install
npm run dev
```

Open **http://localhost:3000/signup** and create your business and admin account. The
embedded database lives in `./.data/pglite`; it is created, migrated and seeded with
defaults on the first request. Delete that folder to start over.

### Demo data

```bash
npm run seed:demo             # a demo company, team, customers, jobs, invoices…
npm run seed:demo -- --reset  # wipe and re-seed
npm run seed:demo -- --profile=locksmith   # one trade: handyman, locksmith or chimney
```

Trade profiles seed a single fictional business (Brightside Handyman Co., Ironclad Lock &
Key, Ember & Flue Chimney Co.); sign in as `admin@`, `office@` or `tech1@` its domain
(`brightside.test`, `ironclad.test`, `emberflue.test`) with `TestDrive2026!`. The
script prints the logins it seeded.

Run it against a fresh database (stop `npm run dev` first; PGlite allows one process).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js dev server / production build / production server |
| `npm run lint` · `typecheck` · `test` | Biome · `tsc --noEmit` · Vitest |
| `npm run db:generate` · `db:migrate` · `db:studio` | Drizzle migrations and studio |
| `npm run seed:demo` | Demo data |
| `npm run gen:vapid` | Web Push keys |
| `npm run analyze` | Bundle analyzer |

## Configuration

Everything is optional in development. Copy [`.env.example`](.env.example) to `.env.local`
and fill in what you need; missing values fall back to free or development drivers.

| Variable | Purpose |
|---|---|
| `APP_URL` | Public base URL for links in messages (**required in production**) |
| `SESSION_SECRET` | Secret for signing and encryption, ≥ 16 chars (**required in production**) |
| `CRON_SECRET` | Bearer token for `/api/cron/tick` (**required in production**) |
| `DATABASE_URL` | Postgres 16+; without it, PGlite at `PGLITE_DIR` (default `./.data/pglite`) |
| `DB_MIGRATE_ON_BOOT` | `1` = migrate Postgres on the first request (otherwise `npm run db:migrate` at deploy) |
| `STORAGE_DRIVER`, `S3_*`, `UPLOADS_DIR` | Photo storage: `local` (default) or any S3-compatible store (Cloudflare R2) |
| `MESSAGING_SMS_DRIVER` | `link` (tap-to-send, default) or `console` |
| `EMAIL_DRIVER`, `RESEND_API_KEY`, `EMAIL_FROM` | Email: `console` (default) or `resend` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Web Push |
| `PAYMENTS_DRIVER`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `manual` (default) or `stripe` |
| `AI_PROVIDER`, `GEMINI_API_KEY`, `AI_TIER`, `AI_DAILY_BUDGET`, `AI_MODEL_OCR` | Optional receipt/odometer OCR |
| `GEOCODER`, `NEXT_PUBLIC_TILE_URL`, `NEXT_PUBLIC_TILE_ATTRIBUTION` | Geocoding and map tiles |
| `TURNSTILE_SECRET` | Optional bot check on the hosted lead form |

The full list with comments is in `.env.example`.

## Deploy

See [`docs/DEPLOY.md`](docs/DEPLOY.md): a Docker standalone build on a small VPS, or Vercel
Pro, with Neon Postgres, Cloudflare R2 storage and a once-a-minute cron pinger.

## Project docs

- [`docs/SPEC.md`](docs/SPEC.md): product and technical spec
- [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md): module ownership and cross-module contracts
- [`docs/MODULES.md`](docs/MODULES.md): module status
- [`docs/budget.md`](docs/budget.md): performance budgets and measurements
- [`docs/CHANGELOG.md`](docs/CHANGELOG.md)
