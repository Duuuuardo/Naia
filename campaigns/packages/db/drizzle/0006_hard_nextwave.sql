-- Backfill do modelo antigo (1 campanha = 1 conexão + 1 template) para o novo
-- (campaign_connections + campaign_variants) antes de dropar as colunas.
INSERT INTO "campaign_connections" ("campaign_id", "connection_id", "position")
SELECT "id", "connection_id", 0 FROM "campaigns" WHERE "connection_id" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "campaign_variants" ("id", "campaign_id", "position", "body")
SELECT gen_random_uuid()::text, "id", 0, "message_template"
FROM "campaigns"
WHERE "message_template" IS NOT NULL AND "message_template" <> '';--> statement-breakpoint
-- Agendamento legado (scheduled_at) vira schedule_json tipo 'once'
UPDATE "campaigns"
SET "schedule_json" = json_build_object(
  'type', 'once',
  -- timestamp sem tz já é UTC naive; renderiza direto com sufixo Z
  'onceAt', to_char("scheduled_at", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
)::text
WHERE "scheduled_at" IS NOT NULL AND "schedule_json" = '{"type":"immediate"}';--> statement-breakpoint
ALTER TABLE "campaigns" DROP CONSTRAINT "campaigns_connection_id_connections_id_fk";
--> statement-breakpoint
ALTER TABLE "campaigns" DROP COLUMN "connection_id";--> statement-breakpoint
ALTER TABLE "campaigns" DROP COLUMN "message_template";
