ALTER TABLE "users" ADD COLUMN "bank_holder_name_enc" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "custom" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "service_type_id" uuid;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "photo_media_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD COLUMN "vars" jsonb;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD COLUMN "meta" jsonb;--> statement-breakpoint
ALTER TABLE "service_records" ADD COLUMN "odometer_reading_id" uuid;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_service_type_id_service_types_id_fk" FOREIGN KEY ("service_type_id") REFERENCES "public"."service_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calls_lead_idx" ON "calls" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "calls_customer_idx" ON "calls" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "customers_email_lower_idx" ON "customers" USING btree (lower("email") text_pattern_ops);--> statement-breakpoint
CREATE INDEX "lead_events_source_idx" ON "lead_events" USING btree ("lead_source_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "leads_customer_idx" ON "leads" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "leads_new_assignee_idx" ON "leads" USING btree ("assigned_user_id") WHERE "leads"."status" = 'new';--> statement-breakpoint
CREATE INDEX "leads_created_idx" ON "leads" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "properties_street_lower_idx" ON "properties" USING btree (lower("street") text_pattern_ops);--> statement-breakpoint
CREATE INDEX "estimates_sent_idx" ON "estimates" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "invoices_issued_idx" ON "invoices" USING btree ("issued_at");--> statement-breakpoint
CREATE INDEX "checkout_sessions_status_idx" ON "checkout_sessions" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "deposit_requests_job_idx" ON "deposit_requests" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "disputes_payment_idx" ON "disputes" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "refunds_payment_idx" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "refunds_created_idx" ON "refunds" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "part_purchases_purchaser_idx" ON "part_purchases" USING btree ("purchaser_user_id","status");--> statement-breakpoint
CREATE INDEX "stock_moves_from_idx" ON "stock_moves" USING btree ("from_location_id");--> statement-breakpoint
CREATE INDEX "stock_moves_to_idx" ON "stock_moves" USING btree ("to_location_id");--> statement-breakpoint
CREATE INDEX "stock_moves_line_idx" ON "stock_moves" USING btree ("line_item_id");--> statement-breakpoint
CREATE INDEX "cash_remittances_user_idx" ON "cash_remittances" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "ledger_ref_idx" ON "ledger_entries" USING btree ("ref_table","ref_id");--> statement-breakpoint
CREATE INDEX "ledger_effective_idx" ON "ledger_entries" USING btree ("effective_date","type");--> statement-breakpoint
CREATE INDEX "fuel_logs_vehicle_idx" ON "fuel_logs" USING btree ("vehicle_id","filled_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "trips_vehicle_idx" ON "trips" USING btree ("vehicle_id","trip_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "vehicle_issues_vehicle_idx" ON "vehicle_issues" USING btree ("vehicle_id","status");--> statement-breakpoint
CREATE INDEX "tool_audits_user_idx" ON "tool_audits" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "tools_status_idx" ON "tools" USING btree ("status");--> statement-breakpoint
CREATE INDEX "exports_kind_idx" ON "exports" USING btree ("kind","created_at" DESC NULLS LAST);