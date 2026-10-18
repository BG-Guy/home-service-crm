# Messaging (M12) — owner B5

The one send path for every customer, tech and admin message, the link-mode outbox,
per-customer conversation threads, the consent ledger and the composer. Drivers live in
`src/adapters/messaging` (SMS: `link` default, `console`, `android_gateway`; WhatsApp:
`whatsapp_link`), `src/adapters/email` (console / Resend over fetch) and
`src/adapters/push` (VAPID). **Features never call a driver** — they call
`enqueueMessage` (customers) or `notify` (direct staff alerts).

## Flows

- **`enqueueMessage(tx, input, actor)`** (`api.ts` → `enqueue.ts`): inserts one
  `scheduled_messages` row (unique `dedupe_key`, default `manual:<uuid>`; automations use
  `auto:<automation>:<entity>:<step>:<recipient>:<channel>[:a<anchor>|:e<event>]`). A row
  that is due now is decided in the caller's transaction (no provider call): link-mode
  texts become outbox cards, staff push/in-app writes the bell row, compliance outcomes
  are final. Email / auto-send SMS stay `scheduled`; `kickSender()` (after()) and cron
  `messaging.send_due` (every minute) send them.
- **Sender** (`sender.ts`, single-flight advisory lock): every due row is re-checked at
  send time — automation still enabled + feature flag, automation and step conditions,
  entity still valid (job not cancelled, invoice unpaid, estimate open…), expiry, consent
  / do-not-text / do-not-contact, review eligibility, quiet hours in the **recipient's**
  zone (property TZ → ZIP3 → company; defer to 08:00 + 0–30 min jitter; `allow_outside_
  quiet_hours` templates bypass), frequency caps (3 automated non-live per 24 h, marketing
  1 per 7 d) — then renders (tokens minted per send), appends "Reply STOP to opt out" on
  the first automated text and every marketing text, and delivers. Results: `pending_tap`
  (link drivers, assigned per `settings.messaging.outbox_owner_by_template` /
  `tech_texts_from`), `sent` (+ `messages` row, activity, `message.sent`), `failed`
  (retry with backoff, then `message.failed`), `canceled` / `skipped` /
  `suppressed_optout` / `deferred_quiet` / `expired` with a reason in `last_error`.
- **Outbox** (`/messages/outbox`, `OutboxCardView`): Send opens `sms:` (`smsHref`: Apple
  `&body=`, others `?body=`, per-device override in Settings → Messaging) or `wa.me`;
  coming back (`visibilitychange`) asks **Sent? Yes / Not sent / Skip**; Copy; edit;
  expiry countdown (never sent late); GSM-7 segment counter; "Send one by one" mode;
  Mine / Everyone (`messages.outbox_all`). Cron `messaging.outbox` expires stale cards
  and pushes "n customer texts ready" (batched per person).
- **Threads** (`/messages`, `/messages/[customerId]`): bubbles for every channel grouped
  by day, upcoming sends with cancel, composer, **Log reply** (link mode has no inbound),
  opt-out review banner. Techs see only customers of their jobs; contact details are
  masked outside the tech's contact window (B1).
- **Consent** (`recordConsent`): append-only `consent_events`; `sms_status` is derived
  from the SMS ledger (`deriveSmsStatus`) and stored via B1's setter; revoking suppresses
  the queued sends it covers. Inbound keywords (`message.received` handler):
  STOP… → opt-out (+ confirmation on auto-send drivers), START → opt-in, HELP → help text,
  **C** → B2 `confirmJob`, **R** → B2 `requestReschedule`; natural-language opt-outs only
  raise `message.optout_detected` → one-tap review (S31 / thread banner).
- **Bulk text** (`messages.bulk_send`): audience preview → type the count to confirm;
  consent, quiet hours and caps still apply; never offered from review screens.
- **Compliance pages**: `/sms-terms` and `/privacy` render the published policy plus a
  generated program disclosure (sender, frequency, STOP/HELP, no sharing of opt-in data).

## Extension points

- New provider: implement `MessagingDriver` (`src/adapters/messaging/types.ts`), register
  it in `index.ts`, select with `MESSAGING_SMS_DRIVER`. Inbound webhooks arrive at
  `/api/inbound/sms/<driver>` (`verifyWebhook` + `parseInbound`); dev: `POST
  /api/inbound/sms/console {"from","body"}`.
- New message: add the template to `src/features/automations/builtin/templates.ts`
  (GSM-7, own-domain links via `{{…link}}` variables) and send it with `enqueueMessage`.
- Slots: S29 `MessageComposer`, S30 `JobMessagesPanel`, S31 `ConsentPanel`,
  S32 `OutboxCountBadge`. Badge: `messages.outbox`.
- Tests: `tests/golden/{gsm,quiet-hours,frequency-caps}.test.ts`,
  `tests/messaging/*` (channel resolution, consent, smsHref, inbound, PGlite flows).
