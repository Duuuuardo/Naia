ALTER TABLE "workspace_settings" ADD COLUMN "next_protocol" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "blocked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "blocked_at" timestamp;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "protocol" integer;--> statement-breakpoint
-- Backfill: protocolo sequencial por workspace, ordenado por created_at.
WITH numbered AS (
	SELECT "id", ROW_NUMBER() OVER (PARTITION BY "workspace_id" ORDER BY "created_at", "id") AS rn
	FROM "conversations"
	WHERE "protocol" IS NULL
)
UPDATE "conversations" c SET "protocol" = n.rn FROM numbered n WHERE c."id" = n."id";--> statement-breakpoint
-- Contadores: próximo protocolo de cada workspace = max(protocol) + 1.
INSERT INTO "workspace_settings" ("workspace_id", "next_protocol")
SELECT "workspace_id", MAX("protocol") + 1 FROM "conversations" GROUP BY "workspace_id"
ON CONFLICT ("workspace_id") DO UPDATE SET "next_protocol" = EXCLUDED."next_protocol";--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "protocol" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspace_id_protocol_unique" UNIQUE("workspace_id","protocol");
