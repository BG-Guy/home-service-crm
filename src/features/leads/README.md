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
- `/leads`: a grid of `LeadBox`es, longest wait first: initials in the SLA ring (green < 5 min, amber < 15, red beyond), name, job and status, street; tapping the box (`.box-hit`) opens the lead card. Phones 1 or 2 columns (`leads-cols` cookie, default 2); wider screens fit as many as there's room for. Count line, status chips with counts (`?view=new|contacted|qualified|check|booked|lost|spam`; tap again for all open) and a Filter sheet (`mine=1`, `overdue=1`, `source=`). Swipe left on an open lead: Lost or Spam, with Undo. Grid / Map (`?show=map` on phones and tablets, side by side at ≥ 1024 px, full screen `?fs=leads-map`; `map-queries.ts`, `components/map/`). Appendix A params `status= source= from= to= filter=check|breached|mine` still work.
- Lead card (`LeadCardProvider` / `useLeadCard()`, lazy `LeadCardSheet`, mirrored in `?lead=<id>`): a TL;DR, boxes (phone, address with a mini map, wants or arrives, quote and source, last contact, notes, photos), four action groups whose steps each have a way back (pure rules in `rules.ts`), Undo for 5 s (`undoLeadChange`) and Book. Call keeps the outcome sheet (no answer creates a `lead_retry` task in 15 min and drafts a `lead.no_answer` text).
- `/leads/[id]`: the card's layout for links and printing, plus attribution, consent, notes, tags, the intake log, activity and the raw payload (admins).
- Booking, for any lead: Who (`/leads/new`, "New lead": `createLeadAndCustomer`; the source is required; verbal consent box; a repeat caller gets "Update their open lead or start a new one?") → What and When (`/leads/new/schedule?leadId=`: job type cards, then a week strip of 2-hour arrival windows from `jobs/availability`) → `bookLead` (`booking-actions.ts`): the job gets the window and no tech, and waits in the Assign hub's Needs a tech queue. The flow shows Done itself; `/leads/new/done?jobId=` is where a reload lands.
- `/settings/lead-sources` (+ `[id]`): sources, inbox rules (`settings.leads`, `company.lead_response_minutes`), per-source snippets for all three levels with the real key, keys (pk shown; sk, hook URL and Google key shown once; rotation), test console (last 20 payloads + mapping result + paste box), JSON-path mapping editor, ROI and monthly spend, origins / `require_ts` / Turnstile / daily cap / cost model.
- `/settings/api-keys`: create (shown once), revoke.

## Contracts
- `api.ts`: `getLeadPrefill` (with the job type, priority and after-hours typed on the call), `markLeadConverted` (writes a status `lead_events` row), `markLeadResponded`, `getDefaultBookingLink`, `openLeadIdsForCustomer`.
- `contracts.ts`: `LeadBoxData`, `LeadCardData`, `LeadMapPoint`, `LeadMapJob`, `CallerLookup`, `LeadChangeResult`. Other screens reuse `LeadBox` and `useLeadCard()` (`components/lead-env.ts`).
- `ensure-customer.ts`: `ensureLeadCustomer(tx, lead, actor)` gives a lead its customer, property and consent the way intake does (booking a "Check" lead uses it).
- Emits `lead.created`, `lead.touched`, `lead.responded`, `lead.sla_breached`, `lead.status_changed`, `lead.converted`. Handles `message.sent` → `markLeadResponded` (human sends only) and `lead.touched` → `notify()` the assignee.
- Cron `leads.sla` (every minute; idempotent via `lead_events(kind='sla_breached')`; optional business-hours SLA) and `leads.map_backfill` (every 10 minutes: open leads with an address get a property and its geocode job; `map-backfill.ts`, `map-geocode.ts`). Badge `leads.new`: the New chip's number (`newLeadsWhere`).

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
