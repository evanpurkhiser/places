CREATE TABLE "import_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"state" text DEFAULT 'created' NOT NULL,
	"source_id" uuid,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_runs_type_check" CHECK ("import_runs"."type" in ('instagram', 'gmaps')),
	CONSTRAINT "import_runs_state_check" CHECK ("import_runs"."state" in ('created', 'active', 'retry', 'completed', 'failed', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_runs_source_id_idx" ON "import_runs" USING btree ("source_id");
