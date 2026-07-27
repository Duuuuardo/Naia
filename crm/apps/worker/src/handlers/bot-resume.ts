import type { BotResumeJob } from '@crm/queue'
import { resumeDelayedSession } from '../bot/engine'

// Consumer de bot-resume-v1: jobs delayed publicados por nós 'delay' do bot
// engine. A retomada em si vive no engine (reconstrói o contexto da sessão).
export async function handleBotResume(job: BotResumeJob): Promise<void> {
  await resumeDelayedSession(job.botSessionId)
}
