CREATE TABLE "whatsapp_contacts_cache" (
	"connection_id" text NOT NULL,
	"contact_jid" text NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_contacts_cache_connection_id_contact_jid_pk" PRIMARY KEY("connection_id","contact_jid")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_sessions" (
	"connection_id" text NOT NULL,
	"key_id" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_sessions_connection_id_key_id_pk" PRIMARY KEY("connection_id","key_id")
);
--> statement-breakpoint
ALTER TABLE "whatsapp_contacts_cache" ADD CONSTRAINT "whatsapp_contacts_cache_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_sessions" ADD CONSTRAINT "whatsapp_sessions_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;