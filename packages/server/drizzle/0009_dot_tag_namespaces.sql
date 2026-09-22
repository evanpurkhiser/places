ALTER TABLE "namespaces" DROP CONSTRAINT "namespaces_name_normalized";--> statement-breakpoint
ALTER TABLE "tags" DROP CONSTRAINT "tags_namespace_name";--> statement-breakpoint
ALTER TABLE "tags" DROP CONSTRAINT "tags_name_normalized";--> statement-breakpoint
UPDATE "namespaces" SET "name" = replace("name", '.', '-'), "updated_at" = now() WHERE position('.' in "name") > 0;--> statement-breakpoint
UPDATE "tags" SET "name" = replace(replace("name", '.', '-'), ':', '.'), "updated_at" = now() WHERE "namespace_id" IS NOT NULL OR position('.' in "name") > 0;--> statement-breakpoint
ALTER TABLE "namespaces" ADD CONSTRAINT "namespaces_name_normalized" CHECK ("namespaces"."name" <> '' AND position('.' in "namespaces"."name") = 0 AND "namespaces"."name" = lower(btrim("namespaces"."name")));--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_namespace_name" CHECK (("tags"."namespace_id" IS NULL AND position('.' in "tags"."name") = 0) OR ("tags"."namespace_id" IS NOT NULL AND "tags"."name" ~ '^[^.]+[.][^.]+$'));--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_name_normalized" CHECK ("tags"."name" <> '' AND "tags"."name" = lower(btrim("tags"."name")) AND split_part("tags"."name", '.', 1) = btrim(split_part("tags"."name", '.', 1)) AND split_part("tags"."name", '.', 2) = btrim(split_part("tags"."name", '.', 2)));
