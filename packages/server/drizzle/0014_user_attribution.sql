ALTER TABLE "import_runs" ADD COLUMN "requested_by_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "added_by_user_id" uuid;
--> statement-breakpoint
UPDATE "import_runs" SET "requested_by_user_id" = (SELECT "id" FROM "users" WHERE "is_default");
--> statement-breakpoint
UPDATE "places" SET "added_by_user_id" = (SELECT "id" FROM "users" WHERE "is_default");
--> statement-breakpoint
ALTER TABLE "import_runs" ALTER COLUMN "requested_by_user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "places" ALTER COLUMN "added_by_user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
