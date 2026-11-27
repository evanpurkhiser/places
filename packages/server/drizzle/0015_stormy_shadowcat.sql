CREATE TABLE "audit_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"subject" jsonb NOT NULL,
	"actor" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "audit_entries_subject_shape" CHECK ((jsonb_typeof("audit_entries"."subject") = 'object'
        AND jsonb_typeof("audit_entries"."subject"->'type') = 'string'
        AND jsonb_typeof("audit_entries"."subject"->'id') = 'string') IS TRUE)
);
--> statement-breakpoint
CREATE INDEX "audit_entries_subject_timeline_idx" ON "audit_entries" USING btree (("subject"->>'type'),("subject"->>'id'),"occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);
