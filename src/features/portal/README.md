# portal (M23) — B3

Customer pages behind magic links — no login, server-rendered, tiny client islands.

| Route | Purpose |
|---|---|
| `/j/[token]` | Job page: tech card (B8 briefs), status and window, confirm / reschedule (S8), estimate, change orders and invoice (fresh links on tap), pay, starred photos (S27), contact footer |
| `/e/[token]` | Estimate: options, add-ons, live total, policies inline, cooling-off notice, ESIGN consent + typed name + drawn signature (S15 via `/api/uploads/public/presign`), decline, then the deposit (`/p/`). Also renders change orders (B5 mints those as kind `estimate`, entity `change_order`). First view flips `sent → viewed`. |
| `/i/[token]` | Invoice: view, print/PDF, pay. `?receipt={paymentId}` shows that payment's receipt with S28 "Wrong amount? / I didn't pay this". |

- `token.ts`: per-IP rate limit (`settings.portal.rate_limit_per_minute`, default 60/min),
  `openPortalToken` (validate + `portal_access_log`), `peekPublicToken`, `portalActor`.
- `links.ts`: minting (`/j` 30 d after completion, `/e` until expiry, `/i` 180 d, `/p` 7 d or the
  paper's life for printed QR codes). Raw tokens never touch the DB or events.
- `actions.ts`: public server actions (no session) that re-validate the token, rate-limit, write in
  one transaction with audit + activity + events, log the portal action, then `refresh()`.
