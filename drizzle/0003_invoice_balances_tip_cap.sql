-- QA round 2: invoice_balances.refunded_cents counts only the invoice part of refunds.
-- payments.amount_cents excludes the tip, but a refund can include it (a full
-- processor refund returns amount + tip). Refunds come off the base first and off
-- the tip only beyond it (lead decision, T6-07), so each payment contributes
-- least(Σ its succeeded refunds, its amount_cents). Before this, refunding a tipped
-- payment in full overstated the balance by the tip.
-- Same columns, names and types as 0001, so CREATE OR REPLACE keeps dependants valid.
CREATE OR REPLACE VIEW "invoice_balances" AS
SELECT
  i.id AS invoice_id,
  i.total_cents,
  coalesce((SELECT sum(p.amount_cents) FROM payments p
            WHERE p.invoice_id = i.id
              AND p.status IN ('succeeded','partially_refunded','refunded','disputed')), 0)::bigint AS paid_cents,
  coalesce((SELECT sum(least(pr.refunded, pr.amount_cents))
            FROM (SELECT p.amount_cents, sum(r.amount_cents) AS refunded
                  FROM refunds r JOIN payments p ON p.id = r.payment_id
                  WHERE p.invoice_id = i.id AND r.status = 'succeeded'
                  GROUP BY p.id, p.amount_cents) pr), 0)::bigint AS refunded_cents,
  coalesce((SELECT sum(c.amount_cents) FROM credit_notes c WHERE c.invoice_id = i.id), 0)::bigint AS credited_cents
FROM invoices i;
