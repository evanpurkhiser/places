CREATE TABLE "namespaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"icon" jsonb,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "namespaces_name_unique" UNIQUE("name"),
	CONSTRAINT "namespaces_name_normalized" CHECK ("namespaces"."name" <> '' AND position(':' in "namespaces"."name") = 0 AND "namespaces"."name" = lower(btrim("namespaces"."name")))
);
