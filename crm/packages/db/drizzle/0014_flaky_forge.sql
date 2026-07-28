ALTER TABLE "conversation_ratings" DROP CONSTRAINT "conversation_ratings_conversation_id_unique";--> statement-breakpoint
ALTER TABLE "conversation_ratings" ADD COLUMN "atendimento_seq" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_ratings" ADD CONSTRAINT "conversation_ratings_conversation_id_atendimento_seq_unique" UNIQUE("conversation_id","atendimento_seq");