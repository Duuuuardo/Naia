
ALTER TABLE "automations" ADD COLUMN IF NOT EXISTS "steps_json" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "automations" ADD COLUMN IF NOT EXISTS "stop_on_tags_json" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "automations" ADD COLUMN IF NOT EXISTS "trigger_json" text DEFAULT '{}' NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "automation_connections" (
	"automation_id" text NOT NULL REFERENCES "automations"("id") ON DELETE cascade,
	"connection_id" text NOT NULL REFERENCES "connections"("id") ON DELETE cascade,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "automation_connections_automation_id_connection_id_pk" PRIMARY KEY("automation_id","connection_id")
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "automation_enrollments" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
	"automation_id" text NOT NULL REFERENCES "automations"("id") ON DELETE cascade,
	"contact_id" text NOT NULL REFERENCES "contacts"("id") ON DELETE cascade,
	"current_step_index" integer DEFAULT 0 NOT NULL,
	"next_step_at" timestamp NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"context_json" text DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
