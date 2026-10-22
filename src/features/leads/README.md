# leads (M04) — owner B1

Lead intake from any website or marketplace, the speed-to-lead inbox, lead sources with
keys and copy-paste snippets, and server API keys.

## Intake (SPEC §8.1, §8.3 — one pipeline for every door)
| Door | Endpoint | Auth |
|---|---|---|
| Plain HTML form (no JS) | `POST /api/v1/leads/f/<pk>` → `303` to an allow-listed `redirect`, else `/f/<pk>/thanks` | public key; honeypot; a tampered or too-fast `_ts` is spam; a missing (on `require_ts` sources) or expired `_ts` only sends the lead to "Check" |
| Form + `embed.js` | same endpoint via fetch (`X-Requested-With: crm-embed`) → JSON and an inline "Thanks!"; `GET` returns a signed `_ts` and the consent wording | public key + origin allow-list |
| Hosted form | `/f/<pk>` (iframe-able, works without JS) | public key |
| JSON API | `POST /api/v1/leads` (+ `OPTIONS` CORS) → `201` / `200 merged` / `400` / `429` for secret keys; site-key callers get one uniform `200 {status:"received"}` (created, merged or spam) | `X-Site-Key: pk_…` or `Authorization: Bearer sk_…` (source secret or an `api_keys` key) |
| Marketplace hooks | `POST /api/v1/hooks/<preset>/<secret>` (generic, zapier, make, thumbtack, angi, google_ads_leadform) | hashed path secret (+ `google_key`) |
| Schema | `GET /api/v1/leads/schema` | public |

Pipeline (`intake/process.ts`): 32 KB cap → rate limit (10/min per IP+key, daily cap per
source) → origin check → preset → source JSON-path mapping → aliases (`intake/normalize.ts`)
→ hard spam (honeypot, `_ts`, Turnstile) is stored as `spam` with a fake success → dedupe
(`source + external_id`; 10-minute phone+service hash; an open lead for the same customer
and service within 14 days becomes a touch) → `findOrCreateCustomer` (not for spam or
"Check") → `consent_events` via B5 `recordConsent` → `lead.created`. Soft signals only
raise `spam_score`; at or above `settings.leads.spam_review_threshold` the lead lands under
**Check** and is never dropped.

`embed.js`: source `embed/embed.src.js`, built by `npm run build:embed` (esbuild
transform, ES2017, fails above 3 KB gzipped; currently about 1.8 KB).

## Screens
- `/leads`: SLA-sorted cards (oldest unanswered first) with the live timer (green < 5 min, amber < 15, red beyond), source, service, price, preferred date, in/out of service area, returning badge; chips Inbox / Check / Booked / Lost / Spam / Mine / Overdue / per source; swipe for Lost / Spam. Appendix A params `status= source= from= to= filter=check|breached|mine`.
- `/leads/[id]`: Call (claim + `tel:` + outcome sheet; no answer creates a `lead_retry` task in 15 min and drafts a `lead.no_answer` text), Text, Claim / Take over, Convert (→ `/jobs/new?leadId=` or `/estimates/new?leadId=`, customer + property created first), More (qualified, lost with reason, spam, reopen), attribution, consent, notes, tags, timeline, intake log, raw payload (admins).
- `/leads/new`: the call-to-booking flow (step 1 caller, `createLeadAndCustomer`) → `/leads/new/schedule` (calendar + windows, `createJobAction`) → `/leads/new/done`. The source is required; verbal consent box.
- `/settings/lead-sources` (+ `[id]`): sources, inbox rules (`settings.leads`, `company.lead_response_minutes`), per-source snippets for all three levels with the real key, keys (pk shown; sk, hook URL and Google key shown once; rotation), test console (last 20 payloads + mapping result + paste box), JSON-path mapping editor, ROI and monthly spend, origins / `require_ts` / Turnstile / daily cap / cost model.
- `/settings/api-keys`: create (shown once), revoke.

## Contracts
- `api.ts`: `getLeadPrefill`, `markLeadConverted`, `markLeadResponded`, `getDefaultBookingLink`.
- Emits `lead.created`, `lead.touched`, `lead.responded`, `lead.sla_breached`, `lead.status_changed`, `lead.converted`. Handles `message.sent` → `markLeadResponded` (human sends only) and `lead.touched` → `notify()` the assignee.
- Cron `leads.sla` (every minute; idempotent via `lead_events(kind='sla_breached')`; optional business-hours SLA). Badge `leads.new`.

## Demo keys (seed only — rotate before going live)
`pk_demo_website0001` (website form), `sk_demo_referral_0000000000000001` (Referral JSON
API), `/api/v1/hooks/thumbtack/hk_demo_thumbtack_000000000000001` (Thumbtack hook),
`sk_demo_zapier_00000000000000001` (server API key).

```bash
curl -X POST http://localhost:3000/api/v1/leads \
  -H "Authorization: Bearer sk_demo_referral_0000000000000001" -H "Content-Type: application/json" \
  -d '{"name":"Dana Lee","phone":"(512) 555-7788","service_type":"Rekey","sms_consent":true}'
```

## Extending
- New marketplace: add a case to `intake/presets.ts` (plus a sample in `PRESET_SAMPLES` and a golden test) and its key to the hooks route's `PRESETS`.
- New field alias: `FIELD_ALIASES` in `intake/normalize.ts` (the schema endpoint picks it up).
