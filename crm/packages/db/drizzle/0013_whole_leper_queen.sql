ALTER TABLE "bot_sessions" ADD COLUMN "atendimento_seq" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "atendimento_seq" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "atendimento_seq" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
-- Carimba automaticamente messages.atendimento_seq com o atendimento atual da
-- conversa no INSERT. Centraliza a regra (não depende de cada ponto de insert).
CREATE OR REPLACE FUNCTION set_message_atendimento_seq() RETURNS trigger AS $$
BEGIN
  NEW.atendimento_seq := COALESCE(
    (SELECT c.atendimento_seq FROM conversations c WHERE c.id = NEW.conversation_id),
    1
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_message_atendimento_seq ON messages;--> statement-breakpoint
CREATE TRIGGER trg_message_atendimento_seq
  BEFORE INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION set_message_atendimento_seq();