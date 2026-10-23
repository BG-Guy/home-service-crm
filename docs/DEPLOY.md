# Deploying

One deployment serves one business. The cheapest compliant production setup (SPEC §2):

| Piece | Recommendation | Notes |
|---|---|---|
| App | Docker on a small VPS (`STANDALONE=1`), **or** Vercel **Pro** | Vercel Hobby is non-commercial only |
| Database | Neon (free tier) or any Postgres 16+ | `DATABASE_URL`; PGlite is for development only |
| Storage | Cloudflare R2 (S3-compatible) | `STORAGE_DRIVER=s3` |
| Scheduler | A Cloudflare Worker cron hitting `/api/cron/tick` every minute, 07:00–21:59 company time | Plus the in-app piggy-back on signed-in requests |
| Backups | Daily JSON export to R2 (`npm run export`, built by B1) | Plus your Postgres provider's point-in-time restore |

## 1. Required environment

Set these in production (the app refuses to run or the cron returns 503 without them):

```bash
APP_URL=https://crm.example.com        # used in every link sent to customers
SESSION_SECRET=$(openssl rand -base64 32)
CRON_SECRET=$(openssl rand -base64 32)
DATABASE_URL=postgres://user:pass@host/db?sslmode=require
```

Optional but recommended: `DATA_KEY` (separate key for encrypted secrets), storage
(`STORAGE_DRIVER=s3`, `S3_*`), email (`EMAIL_DRIVER=resend`, `RESEND_API_KEY`,
`EMAIL_FROM`), Web Push (`npm run gen:vapid` → `VAPID_*` and `NEXT_PUBLIC_VAPID_PUBLIC_KEY`),
Stripe (`PAYMENTS_DRIVER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`). See
`.env.example` for the full list.

The session cookie is `__Host-sid` (Secure) in production, so the site must be served over
HTTPS. `COOKIE_INSECURE=1` exists only for local production testing over plain http.
**Never set `DEMO_LOGIN_PASSWORD`** on a real deployment: it puts one-tap Admin / Office / Tech
sign-in buttons on the login page (only `npm run demo:businesses` sets it, for the demo businesses).

## 2. Database migrations

Pick one:
- Run `npm run db:migrate` (with `DATABASE_URL` set) as a release step before the new
  version takes traffic, **or**
- set `DB_MIGRATE_ON_BOOT=1` to migrate on the first request (guarded by a Postgres advisory
  lock, so several instances starting together are safe).

The base seed (roles, permission grid, counters, policies, templates, default comp plan…)
runs automatically and idempotently on boot. The first visit to `/signup` creates the
company and the admin account; after that, signup is invite-only.

### Append-only tables (optional hardening)

Migration `0001` installs triggers that reject UPDATE/DELETE on the eight append-only
tables (`audit_log`, `ledger_entries`, `consent_events`, `signatures`,
`invoice_revisions`, `job_status_events`, `portal_access_log`, and `events` except its
processing columns). They do not stop
`TRUNCATE` or a superuser. For defense in depth, run the app as a role that cannot
truncate or drop:

```sql
CREATE ROLE crm_app LOGIN PASSWORD '…';
GRANT CONNECT ON DATABASE crm TO crm_app;
GRANT USAGE ON SCHEMA public TO crm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO crm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO crm_app;
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM crm_app;
```

Run migrations with the owner role and the app with `crm_app`.

## 3. Option A: Docker on a VPS

```bash
STANDALONE=1 DATABASE_URL=… npm run build
```

`next.config.ts` switches to `output: "standalone"` when `STANDALONE` is set, excludes PGlite
from the trace when `DATABASE_URL` is set at build time, and includes `drizzle/**` (for
`DB_MIGRATE_ON_BOOT`). A minimal Dockerfile:

```dockerfile
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV STANDALONE=1 NEXT_TELEMETRY_DISABLED=1
# A placeholder URL keeps PGlite out of the bundle; the real one is set at runtime.
RUN DATABASE_URL=postgres://build/placeholder npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/drizzle ./drizzle
EXPOSE 3000
CMD ["node", "server.js"]
```

Put Caddy or nginx in front for HTTPS. One small instance (1 vCPU, 1 GB) is plenty for a
single business.

Client IPs (rate limits, audit, consent evidence) come from the proxy, never from the
spoofable leftmost `X-Forwarded-For`. `TRUST_PROXY` picks the hop: unset or `1` = one proxy
that appends the client (Caddy, nginx `proxy_add_x_forwarded_for`, Vercel); `2`… = more
proxies; `cloudflare` = `CF-Connecting-IP`; `x-real-ip` = nginx `X-Real-IP $remote_addr`;
`none` or `0` = no proxy (no IP recorded).

> **Exposed directly, with no reverse proxy? Set `TRUST_PROXY=0`.** The default assumes a
> proxy in front that appends the real client address. Without one, nothing overwrites
> `X-Forwarded-For`, so a client can send any value and it becomes "their" IP: the per-IP
> login, lead and portal limits can be dodged by changing the header, and audit and consent
> records get a made-up address. With `TRUST_PROXY=0` no IP is recorded and the per-IP limits
> are off; the per-email login lockout and the per-link limits still apply. The better fix is
> to put Caddy or nginx in front and keep the default.

## 4. Option B: Vercel Pro

- Import the repo; framework preset Next.js; Node 24.
- Set the environment variables above (Production and Preview).
- Add a release step for migrations (or set `DB_MIGRATE_ON_BOOT=1`).
- The `pg` pool uses `attachDatabasePool` from `@vercel/functions` automatically on Vercel
  (`max: 5`). With Neon, use the pooled connection string.
- Vercel Cron can call `/api/cron/tick`, but the minimum interval on some plans is too
  coarse; the Cloudflare Worker below works everywhere.

## 5. Cloudflare R2 storage

1. Create a bucket and an API token with Object Read & Write on it.
2. Set `STORAGE_DRIVER=s3`, `S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com`,
   `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION=auto`.
3. Add a CORS rule so browsers can upload directly with presigned URLs:

```json
[{ "AllowedOrigins": ["https://crm.example.com"], "AllowedMethods": ["PUT", "GET", "HEAD"],
   "AllowedHeaders": ["content-type", "x-amz-*"], "MaxAgeSeconds": 3600 }]
```

Photos never pass through the app server: the client asks `/api/uploads/presign`, PUTs to
R2, then confirms with `/api/uploads/complete`.

Each presigned PUT carries a signed `x-amz-checksum-sha256` header (covered by the
`x-amz-*` CORS entry above), so the store refuses a truncated or swapped file, and
`/complete` checks the size and the checksum the store kept before recording the file.
R2 and S3 support it. For an S3-compatible store that rejects the header, set
`S3_CHECKSUM=off`: uploads then work as before and the file hash is recorded as unverified
(`media.sha256_stored` stays empty).

## 6. Cron pinger (Cloudflare Worker)

`/api/cron/tick` accepts GET or POST with `Authorization: Bearer $CRON_SECRET` and runs due
scheduled messages, queue jobs, reminders, period closes, expiries and digests under an
advisory lock. Ping it every minute during business hours (it also runs opportunistically
after signed-in requests, at most once a minute):

```js
// wrangler.toml: [triggers] crons = ["* 11-23,0-2 * * *"]  (07:00–21:59 US Eastern in UTC; adjust)
export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      fetch(`${env.APP_URL}/api/cron/tick`, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
      }),
    );
  },
};
```

Limiting the window protects Neon's free compute hours; overnight work catches up at the
first morning tick.

## 7. Web Push

`npm run gen:vapid` prints a key pair. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
`VAPID_SUBJECT` (a `mailto:`) and `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (same public key). On iOS,
push works only after the app is added to the Home Screen (iOS 16.4+). The service worker
(`/sw.js`) is served with `Cache-Control: no-cache` and a strict CSP.

## 8. Stripe (optional)

Set `PAYMENTS_DRIVER=stripe`, `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, and point a
webhook endpoint at `https://crm.example.com/api/webhooks/stripe` (built by B4). Manual
methods (cash, check, Zelle, Venmo) are always available.

## 9. Health and checks

- `GET /api/health` → `{ ok, db, config: { ok, missing, warnings }, version }` for uptime monitors (names of missing env vars, never values; 503 when the DB is down or `SESSION_SECRET` is missing). In production the server refuses to boot without `SESSION_SECRET` (≥ 16 chars).
- After deploying: sign in, open `/settings`, send yourself an invite, and confirm
  `/api/cron/tick` returns 200 with the bearer token.
