ALTER TABLE "import_runs" DROP CONSTRAINT "import_runs_type_check";--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_type_check" CHECK ("import_runs"."type" in ('instagram', 'gmaps', 'rednote'));
