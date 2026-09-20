ALTER TABLE "sources" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_type_external_id_unique" UNIQUE("type","external_id");
