CREATE TABLE "contact_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"channel_type" text NOT NULL,
	"channel_identifier" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"metadata" text DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entitlements" ALTER COLUMN "tier" SET DEFAULT 'free';--> statement-breakpoint
ALTER TABLE "entitlements" ALTER COLUMN "status" SET DEFAULT 'active';--> statement-breakpoint
ALTER TABLE "entitlements" ALTER COLUMN "seats" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "entitlements" ALTER COLUMN "connections" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "entitlements" ALTER COLUMN "messages_per_month" SET DEFAULT 3;--> statement-breakpoint
ALTER TABLE "entitlements" ALTER COLUMN "campaigns_per_month" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "contacts" ALTER COLUMN "opt_in_status" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "directory_users" ADD COLUMN "picture" text;--> statement-breakpoint
ALTER TABLE "directory_users" ADD COLUMN "picture_frame" text;--> statement-breakpoint
ALTER TABLE "contact_identities" ADD CONSTRAINT "contact_identities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_identities" ADD CONSTRAINT "contact_identities_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_workspace_channel_identifier" ON "contact_identities" USING btree ("workspace_id","channel_type","channel_identifier");--> statement-breakpoint
CREATE INDEX "idx_contact_identities_contact_id" ON "contact_identities" USING btree ("contact_id");