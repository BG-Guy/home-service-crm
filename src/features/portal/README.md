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
- **Present mode** (`/e/[token]?present=1`): the staff estimate page's "Present to customer"
  (`estimates.presentEstimate`, `mintEstimatePresentLink` = `mintOrReusePublicToken` purpose
  `estimate.present`, 12–24 h) opens the customer's own page on the staff device. Only with a
  signed-in user who may present it (`present.ts` `presentingUser`: `estimates.send` + row access)
  is the page wrapped in `components/PresentMode.tsx` (lazy `LazyPresentMode`): a full-screen hub
  with a "Tap to start" screen (its tap asks for browser full screen), a slim top row with "Exit
  presentation" (confirm → staff page) and a "Full screen" button when the browser left it. Back
  pauses (Resume / Exit); Esc and leaving browser full screen keep presenting
  (`present-policy.ts`). `approveEstimatePublic({ present: true })` re-checks the session and
  records the signature `in_person`, with `present_mode` + `presented_by` in the audit row.
- Photos on `/e` ("What we found" strip), `/j` (S27) and `/i` open the kit's full-screen
  `PhotoViewer` (lazy; the pages carry only the grid).
