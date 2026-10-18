# Chargeback protection (M10, SPEC §11) — owner B4

Prevent disputes before work starts, keep every job dispute-ready, and answer disputes
fast with evidence the app already collected.

## Scores

- **Job Risk Score** (`risk.ts`, pure, golden-tested): Σ points of active signals clamped
  0–100; weights and bands are admin-editable (`settings.risk`). `no_signed_estimate` only
  counts above `no_estimate_min_ticket_cents`. Persisted in `risk_assessments` (only when
  the result changes, or on a manual run) and cached on the job via B2 `setJobRisk`.
  Recomputed by `events.ts` on job created/scheduled/rescheduled, estimate sent/approved,
  change order approved, payments, deposits, signatures, `customer.updated` and low
  ratings. A rise to ≥ High before the job starts asks for a deposit.
- **Readiness Score** (`readiness.ts`, pure): `round(100 × earned / applicable)`; n/a items
  earn full credit; the photo item is n/a when `photos` or `before_after` is off.
  Recomputed on arrival, completion, photos, signatures, messages, change orders, payments.
- **Controls** (`controls.ts`, pure; `evaluateTransitionControls` for B2's guards): the
  §11.1 band table + service-type requirements, with the photo → completion-signature
  knock-on when photos are off; Critical needs approval, prepay or cash-only
  (`settings.risk.critical_control`). `enforce_controls` off ⇒ only service-type rules.

## Disputes

- Webhook `charge.dispute.created` → `server.ts#openDisputeInTx`: dispute row with the
  evidence JSON mapped to Stripe fields per category (`narrative.ts`, template-based —
  **never AI**), default files (signature + after photo), customer flagged
  `dispute_history`, payment + job `disputed`, evidence media locked, `evidence_pack` job,
  `dispute.created` (B6 commission hold). Updates/closures track outcome; a lost or
  accepted dispute records a `dispute_lost` refund so the invoice balance re-opens.
- `/disputes`: open list with countdowns, early fraud warnings (refund suggested when ≤
  dispute fee × `efw_refund_multiplier`), analytics (rate vs the 0.75 % line over 90/30
  days; by tech, entry mode, service, lead source, reason; win rate by readiness band).
- `/disputes/[id]`: edit narrative and fields, attach/remove files, rebuild from the job,
  Submit (processor API) or "I submitted it" with a copy panel when there's no API/PDF
  renderer, Accept (suggested when small and readiness is low).
- `/jobs/[id]/evidence`: printable pack (cover + timeline → authorization & change orders
  → geostamps → before/after → completion → receipts → messages → policies →
  payment-auth signals), 12 pt+, no color reliance, capped to stay ≤ 19 pages.

## Files

`api.ts` (§6.4 contract), `facts.ts` (DB → engine inputs), `risk.ts` / `readiness.ts` /
`controls.ts` (pure), `evidence.ts` (pack loader), `narrative.ts` (template narrative +
Stripe field mapping), `server.ts` (dispute writes), `actions.ts`, `queries.ts`,
`events.ts`, `workers.ts`, `badges.ts` (`disputes.open`), `slots.tsx` (S21, S22),
`components/`, `seed.ts` (the J12 dispute).

## Extension points

- New risk signal: add the key to `RISK_SIGNAL_KEYS`, a default weight and label, set it
  in `scoreRisk`, load the fact in `facts.ts#loadRiskFacts`, add a golden case.
- New readiness item: same pattern in `readiness.ts` + `facts.ts#loadReadinessFacts`.
- Tests: `tests/golden/{risk,readiness}.test.ts`, `tests/disputes/controls.test.ts`.
