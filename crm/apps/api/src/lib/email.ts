import { createVianovaEmailClient } from '@naia/vianova-email'
import { requireEnv } from './env'

const VIANOVA_API_URL = requireEnv('VIANOVA_API_URL')
const VIANOVA_INTERNAL_SECRET = requireEnv('VIANOVA_INTERNAL_SECRET')

export const emailClient = createVianovaEmailClient({
  vianovaApiUrl: VIANOVA_API_URL,
  internalSecret: VIANOVA_INTERNAL_SECRET,
})

// Template do email de ativação de conta de agente (define senha do inbox).
export const buildAgentActivationEmail = (opts: {
  agentName: string
  workspaceName: string
  activationUrl: string
}): { subject: string; html: string } => {
  const { agentName, workspaceName, activationUrl } = opts
  return {
    subject: `Ative seu acesso ao ${workspaceName}`,
    html: `
      <div style="font-family: 'Plus Jakarta Sans', -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #1a1a1a;">
        <h1 style="font-size: 22px; margin: 0 0 16px;">Olá, ${agentName} 👋</h1>
        <p style="font-size: 15px; line-height: 1.6; color: #444;">
          Você foi adicionado como atendente no workspace <strong>${workspaceName}</strong> no Naia CRM.
          Defina sua senha para começar a atender.
        </p>
        <a href="${activationUrl}" style="display: inline-block; margin: 24px 0; padding: 12px 24px; background: #DD5973; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">
          Definir minha senha
        </a>
        <p style="font-size: 13px; color: #888; line-height: 1.5;">
          O link expira em 24 horas. Se você não esperava este convite, ignore este email.
        </p>
      </div>
    `,
  }
}
