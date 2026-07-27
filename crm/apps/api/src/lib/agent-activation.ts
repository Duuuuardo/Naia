import { db } from '@crm/db'
import { agentInviteTokens } from '@crm/db/schema'
import { generateId, generateToken } from './crypto'
import { buildInboxUrl } from './urls'
import { emailClient, buildAgentActivationEmail } from './email'

const ACTIVATION_TTL_MS = 24 * 60 * 60 * 1000

// Gera token de ativação e enfileira o email para o agente definir a senha.
// Usado na criação de workspace (owner) e na criação/reenvio de agente.
export const sendAgentActivation = async (opts: {
  agentId: string
  agentName: string
  agentEmail: string
  workspaceName: string
  workspaceSlug: string
}): Promise<void> => {
  const token = generateToken()
  await db.insert(agentInviteTokens).values({
    id: generateId(),
    agentId: opts.agentId,
    token,
    expiresAt: new Date(Date.now() + ACTIVATION_TTL_MS),
  })

  const activationUrl = buildInboxUrl(opts.workspaceSlug, `/inbox/activate?token=${token}`)
  const email = buildAgentActivationEmail({
    agentName: opts.agentName,
    workspaceName: opts.workspaceName,
    activationUrl,
  })
  await emailClient.enqueue({
    to: opts.agentEmail.toLowerCase(),
    subject: email.subject,
    html: email.html,
    brand: 'crm',
  })
}
