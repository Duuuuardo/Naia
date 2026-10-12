
CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"workspace_id" text REFERENCES "workspaces"("id") ON DELETE cascade,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "entitlements" DROP COLUMN IF EXISTS "messages_per_month";--> statement-breakpoint

ALTER TABLE "contacts" ALTER COLUMN "tags" SET DEFAULT '{}';--> statement-breakpoint

ALTER TABLE "workspaces" ALTER COLUMN "notification_preferences" SET DEFAULT '{"emailOnCampaignCompleted":true,"emailOnCampaignFailed":true,"emailOnCreditsExhausted":true,"emailOnConnectionDisconnected":true}'::jsonb;
