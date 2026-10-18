# Review requests (M14) — owner B5

Sentiment-neutral Google review requests: who gets asked never depends on a rating.

## Flows

- **Ask**: built-in `review_request` (job.completed → +delay, default 90 min, synced from
  Settings → Reviews) and `review_reminder` (+3 days, only if not clicked). At send time
  `eligibility.ts` requires: job completed **and** paid (or closed) — otherwise the ask
  waits and `reviews.after_payment` re-schedules it 60 min after `invoice.paid` /
  `job.closed`; at most two asks per job; not asked within `min_days_between` for another
  job; not opted out (email fallback) / do-not-contact / test; not a no-charge callback
  (configurable). Consent basis ⚖️ (`transactional` default, or `marketing`).
- **Manual ask** (S37 `RequestReviewButton`): office/admin with `reviews.send_manual`;
  never rendered for techs; same eligibility; lands in the sender's outbox in link mode.
- **Link**: always `/r/<token>` (minted per send). The click is logged (job, tech, time,
  UA; `review.clicked` once → cancels the reminder) then either 302 to
  `settings.reviews.google_url` or shows the optional 1–5 page. **Every rating sees the
  Google button**; ≤ 3 also sees "Want the owner to call you?" (`review.rated` → low-
  rating alert; callback → `callback_customer` task). Yelp is never a target.
- **Linter** (`lint.ts`, hard rule): incentives (discount, coupon, % / $ off, free, gift
  card…), sentiment gating ("5 stars", "if you loved us") and Yelp are rejected in review
  templates; enforced by the template editor's save.
- **Stats** (`/reviews`): sent, click rate, internal ratings, per-tech leaderboard by
  clicks, recent requests and the manual **Got a review** log (`review.received_logged`
  → B6 review bonus; ⚖️ never conditioned on sentiment).

## Extension points

- `getReviewStatsByTech(from, to)` (B8 insights). Settings: `settings.reviews.*`.
- Tests: `tests/golden/review-lint.test.ts`, review eligibility in `tests/messaging/flows.test.ts`.
