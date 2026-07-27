CREATE TABLE "contact_tags" (
	"contact_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "contact_tags_contact_id_tag_id_pk" PRIMARY KEY("contact_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "conversation_tags" (
	"conversation_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "conversation_tags_conversation_id_tag_id_pk" PRIMARY KEY("conversation_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tags_workspace_id_name_unique" UNIQUE("workspace_id","name")
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"team_id" text NOT NULL,
	"agent_id" text NOT NULL,
	CONSTRAINT "team_members_team_id_agent_id_pk" PRIMARY KEY("team_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "business_hours" jsonb;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "out_of_hours_mode" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "out_of_hours_message" text;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "out_of_hours_bot_flow_id" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "queues" ADD COLUMN "team_id" text;--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_tags" ADD CONSTRAINT "conversation_tags_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_tags" ADD CONSTRAINT "conversation_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD CONSTRAINT "workspace_settings_out_of_hours_bot_flow_id_bot_flows_id_fk" FOREIGN KEY ("out_of_hours_bot_flow_id") REFERENCES "public"."bot_flows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queues" ADD CONSTRAINT "queues_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Backfill: unifica labels + contacts.tags + conversations.labels na tabela tags.
-- 1) Cada label vira uma tag equivalente (mesmo workspace/nome/cor).
INSERT INTO "tags" ("id", "workspace_id", "name", "color", "created_at")
SELECT gen_random_uuid()::text, "workspace_id", "name", "color", now()
FROM "labels"
ON CONFLICT ("workspace_id", "name") DO NOTHING;--> statement-breakpoint
-- 2) Tags de contacts.tags (jsonb): cria tag por nome se não existir (cor default).
INSERT INTO "tags" ("id", "workspace_id", "name", "color", "created_at")
SELECT gen_random_uuid()::text, s."workspace_id", s."name", '#DD5973', now()
FROM (
	SELECT DISTINCT c."workspace_id", t."name"
	FROM "contacts" c
	CROSS JOIN LATERAL jsonb_array_elements_text(c."tags") AS t("name")
) s
ON CONFLICT ("workspace_id", "name") DO NOTHING;--> statement-breakpoint
-- 3) Tags de conversations.labels (jsonb): idem (match por nome).
INSERT INTO "tags" ("id", "workspace_id", "name", "color", "created_at")
SELECT gen_random_uuid()::text, s."workspace_id", s."name", '#DD5973', now()
FROM (
	SELECT DISTINCT cv."workspace_id", t."name"
	FROM "conversations" cv
	CROSS JOIN LATERAL jsonb_array_elements_text(cv."labels") AS t("name")
) s
ON CONFLICT ("workspace_id", "name") DO NOTHING;--> statement-breakpoint
-- 4) Vínculos contato ↔ tag.
INSERT INTO "contact_tags" ("contact_id", "tag_id")
SELECT c."id", tg."id"
FROM "contacts" c
CROSS JOIN LATERAL jsonb_array_elements_text(c."tags") AS t("name")
JOIN "tags" tg ON tg."workspace_id" = c."workspace_id" AND tg."name" = t."name"
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- 5) Vínculos conversa ↔ tag.
INSERT INTO "conversation_tags" ("conversation_id", "tag_id")
SELECT cv."id", tg."id"
FROM "conversations" cv
CROSS JOIN LATERAL jsonb_array_elements_text(cv."labels") AS t("name")
JOIN "tags" tg ON tg."workspace_id" = cv."workspace_id" AND tg."name" = t."name"
ON CONFLICT DO NOTHING;
