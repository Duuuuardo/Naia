ALTER TABLE "contacts" DROP CONSTRAINT "contacts_workspace_id_whatsapp_phone_unique";--> statement-breakpoint
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_workspace_id_telegram_chat_id_unique";--> statement-breakpoint
ALTER TABLE "contacts" DROP COLUMN "whatsapp_phone";--> statement-breakpoint
ALTER TABLE "contacts" DROP COLUMN "telegram_chat_id";--> statement-breakpoint
ALTER TABLE "contacts" DROP COLUMN "origin_channel";