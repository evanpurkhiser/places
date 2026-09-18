ALTER TABLE "places" ADD COLUMN "time_zone" text;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "hours_weekly_open" "int4multirange";--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "business_status" text;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "last_sync" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "places_hours_weekly_open_idx" ON "places" USING gist ("hours_weekly_open");--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_hours_weekly_open_bounds" CHECK ("places"."hours_weekly_open" <@ '{[0,10080)}'::int4multirange);
