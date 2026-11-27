CREATE TABLE "place_saves" (
	"place_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "place_saves_place_id_user_id_pk" PRIMARY KEY("place_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "place_saves" ADD CONSTRAINT "place_saves_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "place_saves" ADD CONSTRAINT "place_saves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "place_saves_user_id_idx" ON "place_saves" USING btree ("user_id");
--> statement-breakpoint
INSERT INTO "place_saves" ("place_id", "user_id", "saved_at")
SELECT "id", "added_by_user_id", "created_at" FROM "places";
--> statement-breakpoint
ALTER TABLE "places" DROP CONSTRAINT "places_added_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "places" DROP COLUMN "added_by_user_id";
