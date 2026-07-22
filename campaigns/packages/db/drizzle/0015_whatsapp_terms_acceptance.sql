ALTER TABLE "connections" ADD COLUMN IF NOT EXISTS "terms_accepted_at" timestamp;
ALTER TABLE "connections" ADD COLUMN IF NOT EXISTS "terms_accepted_by_user_id" text;
ALTER TABLE "connections" ADD COLUMN IF NOT EXISTS "terms_version" text;
