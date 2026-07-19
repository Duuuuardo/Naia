ALTER TABLE "entitlements" ADD COLUMN IF NOT EXISTS "storage_bytes" integer DEFAULT 0 NOT NULL;
ALTER TABLE "entitlements" ADD COLUMN IF NOT EXISTS "max_file_size_bytes" integer DEFAULT 0 NOT NULL;
