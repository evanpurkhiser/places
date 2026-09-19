ALTER TABLE "tags" DROP CONSTRAINT "tags_name_normalized";--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "namespace_id" uuid;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."namespaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tags_namespace_id_idx" ON "tags" USING btree ("namespace_id");--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_namespace_name" CHECK (("tags"."namespace_id" IS NULL AND position(':' in "tags"."name") = 0) OR ("tags"."namespace_id" IS NOT NULL AND "tags"."name" ~ '^[^:]+:[^:]+$'));--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_name_normalized" CHECK ("tags"."name" <> '' AND "tags"."name" = lower(btrim("tags"."name")) AND split_part("tags"."name", ':', 1) = btrim(split_part("tags"."name", ':', 1)) AND split_part("tags"."name", ':', 2) = btrim(split_part("tags"."name", ':', 2)));
