CREATE INDEX "campaign_messages_external_id_idx" ON "campaign_messages" USING btree ("external_message_id");--> statement-breakpoint
CREATE INDEX "campaign_messages_campaign_status_idx" ON "campaign_messages" USING btree ("campaign_id","status");
