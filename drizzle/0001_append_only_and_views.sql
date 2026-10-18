-- Custom SQL migration (hand-written; docs/SPEC.md §6.1 + §6.5). PG16-compatible.
-- 1) Append-only guards: BEFORE UPDATE OR DELETE raises.
--    Exception: events.processed_at / attempts / error may be updated by the processor.
-- 2) invoice_balances view (declared in Drizzle as pgView(...).existing()).

CREATE OR REPLACE FUNCTION crm_forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table "%" is append-only (% not allowed)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION crm_events_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'table "events" is append-only (DELETE not allowed)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.id, NEW.type, NEW.entity_type, NEW.entity_id, NEW.payload, NEW.actor_user_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.type, OLD.entity_type, OLD.entity_id, OLD.payload, OLD.actor_user_id, OLD.created_at) THEN
    RAISE EXCEPTION 'table "events" is append-only (only processed_at, attempts, error may change)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION crm_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION crm_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER consent_events_append_only BEFORE UPDATE OR DELETE ON "consent_events"
  FOR EACH ROW EXECUTE FUNCTION crm_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER signatures_append_only BEFORE UPDATE OR DELETE ON "signatures"
  FOR EACH ROW EXECUTE FUNCTION crm_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER job_status_events_append_only BEFORE UPDATE OR DELETE ON "job_status_events"
  FOR EACH ROW EXECUTE FUNCTION crm_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER portal_access_log_append_only BEFORE UPDATE OR DELETE ON "portal_access_log"
  FOR EACH ROW EXECUTE FUNCTION crm_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER invoice_revisions_append_only BEFORE UPDATE OR DELETE ON "invoice_revisions"
  FOR EACH ROW EXECUTE FUNCTION crm_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER events_append_only BEFORE UPDATE OR DELETE ON "events"
  FOR EACH ROW EXECUTE FUNCTION crm_events_guard();
--> statement-breakpoint
CREATE VIEW "invoice_balances" AS
SELECT
  i.id AS invoice_id,
  i.total_cents,
  coalesce((SELECT sum(p.amount_cents) FROM payments p
            WHERE p.invoice_id = i.id
              AND p.status IN ('succeeded','partially_refunded','refunded','disputed')), 0)::bigint AS paid_cents,
  coalesce((SELECT sum(r.amount_cents) FROM refunds r JOIN payments p ON p.id = r.payment_id
            WHERE p.invoice_id = i.id AND r.status = 'succeeded'), 0)::bigint AS refunded_cents,
  coalesce((SELECT sum(c.amount_cents) FROM credit_notes c WHERE c.invoice_id = i.id), 0)::bigint AS credited_cents
FROM invoices i;
