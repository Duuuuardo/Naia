ALTER TABLE "entitlements" ADD COLUMN "managers_limit" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "role_permissions" jsonb;