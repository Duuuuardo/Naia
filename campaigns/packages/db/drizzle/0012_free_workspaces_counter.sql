ALTER TABLE "directory_users" ADD COLUMN IF NOT EXISTS "free_workspaces_created" integer NOT NULL DEFAULT 0;
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "notification_preferences" jsonb NOT NULL DEFAULT '{"emailOnCampaignCompleted":true,"emailOnCampaignFailed":true,"emailOnCreditsExhausted":true,"emailOnConnectionDisconnected":true}';
ALTER TABLE "entitlements" ADD COLUMN IF NOT EXISTS "credits_per_cycle" integer NOT NULL DEFAULT 3;
ALTER TABLE "entitlements" ADD COLUMN IF NOT EXISTS "credits_balance" integer NOT NULL DEFAULT 3;
