CREATE TABLE "time_off" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_off_range_ck" CHECK ("time_off"."ends_at" > "time_off"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "service_types" ADD COLUMN "kind" text DEFAULT 'service' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "work_hours" jsonb;--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_off_user_idx" ON "time_off" USING btree ("user_id","starts_at");