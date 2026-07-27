import { and, eq, inArray } from 'drizzle-orm'
import type { ChannelMessage } from '@naia/channel-core'
import type { BotConditionOperator, BotFlowDefinition, BotFlowEdge, BotFlowNode, BotInputValidation, MediaRef } from '@crm/schemas'
import {
  CRM_QUEUES,
  defaultCrmJobOptions,
  getCrmQueue,
  type BotResumeJob,
  type OutboundButton,
  type OutboundMessageJob,
  type Queue,
} from '@crm/queue'
import { db, botFlows, botSessions, connections, contactIdentities, conversations, conversationTags, files, messages, tags, type BotFlow, type BotSession } from '@crm/db'
import { generateId } from '../lib/ids'
import { buildInboxEvent, publishInboxEvent } from '../lib/events'

// Interpretador de bot_flows.definition (grafo de nós/arestas, ver @crm/schemas).
// Convenção do `data` por kind (o editor visual é a fonte da definição):
//   message:       { text?: string, attachmentFileId?: string, attachmentFilename?: string }
//                  — o anexo referencia a biblioteca de arquivos (tabela files);
//                  a engine resolve o fileId em MediaRef em runtime
//   menu:          { text?: string, options?: string[] } — arestas com sourceHandle
//                  "opt-0", "opt-1", ... (índice 0-based da opção); o contato
//                  responde com o número 1-based da lista
//   buttons:       { text?: string, options?: [{ id, label }] } — arestas com sourceHandle = id da opção
//                  (fallback: aresta 'default' ou a primeira do nó; resposta fora
//                  das opções segue a aresta 'default', se existir)
//   condition:     { variable?: string, operator?: 'contains'|'equals', value?: string }
//                  — comparação case-insensitive com trim; arestas "true"/"false"
//   collect_input: { question?: string, variable?: string, validation?: 'text'|'number'|'email'|'phone' }
//   delay:         { seconds?: number } — agenda a continuação na fila bot-resume-v1
//   assign_queue:  { queueId: string }
//   assign_agent:  { agentId: string }
//   close_conversation: { message?: string } — despedida opcional ao contato;
//                  encerra a sessão (finished) e resolve a conversa
//                  (status=resolved, resolvedAt). É o único nó que fecha
//                  conversa; terminal (não segue aresta).
//   manage_tag:    { action: 'add'|'remove', tagId: string } — idempotente;
//                  tag fora do workspace = falha do fluxo (invariante abaixo)
//   webhook:       { url: string, method?: 'GET'|'POST', saveToVariable?: string }
//                  — timeout de 10s; POST envia JSON { variables, contact: { id },
//                  conversation: { id } } (sem as variáveis internas "__*");
//                  com saveToVariable, o corpo da resposta (JSON parseado, ou
//                  texto puro se não for JSON) vai para a variável da sessão;
//                  status >= 400 ou timeout = falha do fluxo.
//                  manage_tag e webhook seguem para a próxima aresta padrão.
// Textos interpolam variáveis com {{nome}}. Respostas inválidas em menu, buttons
// e collect_input reenviam a pergunta até 3 vezes; depois o fluxo falha.
// Invariante de produto: o bot NUNCA trava o atendimento — qualquer exceção
// marca a sessão como failed, limpa conversations.activeBotFlowId e a conversa
// permanece aberta.

// Tentativas máximas de resposta inválida (menu/buttons/collect_input) antes de
// falhar o fluxo. Guardada em variables.__retries.
const MAX_INPUT_RETRIES = 3

// Contexto mínimo para executar o grafo — também usado na retomada de delay
// (fila bot-resume-v1), quando não existe mensagem inbound.
export type BotRuntime = {
  workspaceId: string
  connectionId: string
  connectionKind: 'whatsapp' | 'telegram'
  conversationId: string
  contactId: string
  // Identificador do contato no canal (telefone/chat id), resolvido sob demanda.
  target?: string
}

export type BotInboundContext = BotRuntime & {
  message: ChannelMessage
  // true quando o inbound criou a conversa agora (trigger new_conversation).
  isNewConversation: boolean
  // Força um fluxo específico (bot de fora de horário), ignorando triggers.
  forceFlowId?: string
}

type Runtime = BotRuntime

let outboundQueue: Queue<OutboundMessageJob> | null = null

function getOutboundQueue(): Queue<OutboundMessageJob> {
  if (!outboundQueue) {
    outboundQueue = getCrmQueue<OutboundMessageJob>(CRM_QUEUES.OUTBOUND_MESSAGES)
  }
  return outboundQueue
}

let botResumeQueue: Queue<BotResumeJob> | null = null

function getBotResumeQueue(): Queue<BotResumeJob> {
  if (!botResumeQueue) {
    botResumeQueue = getCrmQueue<BotResumeJob>(CRM_QUEUES.BOT_RESUME)
  }
  return botResumeQueue
}

// ─── Ponto de entrada (chamado pelo consumer de inbound) ─────────────────────

export async function evaluateBotForInbound(ctx: BotInboundContext): Promise<void> {
  let session: BotSession | null = null
  try {
    const [active] = await db
      .select()
      .from(botSessions)
      .where(and(eq(botSessions.conversationId, ctx.conversationId), inArray(botSessions.status, ['running', 'waiting_input'])))
      .limit(1)

    if (active?.status === 'waiting_input') {
      session = active
      await resumeWaitingSession(active, ctx)
      return
    }

    if (active) {
      // Sessão "running" com delay agendado (nó delay): a mensagem chegou
      // durante a espera — o bot ignora; a retomada vem pelo job delayed.
      const delayedUntil = readDelayedUntil(active.variables)
      if (delayedUntil && delayedUntil.getTime() > Date.now()) return

      // Sessão "running" persistida só existe se o processo morreu no meio do
      // fluxo — trata como travada: falha, limpa o badge e reavalia triggers.
      console.warn(`[crm-worker:bot] sessão ${active.id} travada em running; marcando como failed`)
      await failSession(active.id, ctx.conversationId)
    }

    await maybeStartFlow(ctx)
  } catch (error) {
    console.error('[crm-worker:bot] falha ao processar fluxo:', error)
    await failSession(session?.id ?? null, ctx.conversationId)
  }
}

// ─── Início de fluxo (triggers) ──────────────────────────────────────────────

async function maybeStartFlow(ctx: BotInboundContext): Promise<void> {
  // Fluxo forçado (bot de fora de horário): ignora triggers. Se o fluxo não
  // existe ou não está ativo, cai na avaliação normal.
  if (ctx.forceFlowId) {
    const [forced] = await db
      .select()
      .from(botFlows)
      .where(
        and(
          eq(botFlows.id, ctx.forceFlowId),
          eq(botFlows.workspaceId, ctx.workspaceId),
          eq(botFlows.status, 'active'),
        ),
      )
      .limit(1)
    if (forced) {
      await startFlow(ctx, forced)
      return
    }
    console.warn(`[crm-worker:bot] fluxo fora de horário ${ctx.forceFlowId} indisponível; avaliação normal`)
  }

  const flows = await db
    .select()
    .from(botFlows)
    .where(and(eq(botFlows.workspaceId, ctx.workspaceId), eq(botFlows.status, 'active')))
  if (flows.length === 0) return

  const text = (ctx.message.text ?? '').trim().toLowerCase()
  const flow = flows.find((candidate) => {
    if (candidate.triggerKind === 'always') return true
    if (candidate.triggerKind === 'new_conversation') return ctx.isNewConversation
    return candidate.triggerKeywords.some((keyword) => {
      const normalized = keyword.trim().toLowerCase()
      return normalized.length > 0 && text.includes(normalized)
    })
  })
  if (!flow) return

  await startFlow(ctx, flow)
}

async function startFlow(ctx: BotInboundContext, flow: BotFlow): Promise<void> {
  const definition = parseDefinition(flow.definition)
  const startNode = definition.nodes.find((node) => node.kind === 'start')
  if (!startNode) {
    console.warn(`[crm-worker:bot] fluxo ${flow.id} ativo sem nó start; ignorado`)
    return
  }

  const [session] = await db
    .insert(botSessions)
    .values({
      id: generateId(),
      workspaceId: ctx.workspaceId,
      flowId: flow.id,
      conversationId: ctx.conversationId,
      currentNodeId: startNode.id,
      status: 'running',
    })
    .returning()

  await db
    .update(conversations)
    .set({ activeBotFlowId: flow.id, updatedAt: new Date() })
    .where(eq(conversations.id, ctx.conversationId))

  await publishInboxEvent(
    buildInboxEvent('bot:started', { workspaceId: ctx.workspaceId, conversationId: ctx.conversationId, flowId: flow.id }),
  )

  await run(session, definition, { ...ctx }, startNode.id)
}

// ─── Retomada de sessão aguardando input ─────────────────────────────────────

async function resumeWaitingSession(session: BotSession, ctx: BotInboundContext): Promise<void> {
  const [flow] = await db.select().from(botFlows).where(eq(botFlows.id, session.flowId)).limit(1)
  if (!flow) throw new Error(`fluxo ${session.flowId} da sessão ${session.id} não existe mais`)

  const definition = parseDefinition(flow.definition)
  const node = definition.nodes.find((candidate) => candidate.id === session.currentNodeId)
  if (!node) throw new Error(`nó ${session.currentNodeId} da sessão ${session.id} não existe no fluxo`)

  const input = (ctx.message.text ?? '').trim()
  const variables: Record<string, unknown> = { ...session.variables, __lastInput: input }
  const rt: Runtime = { ...ctx }

  if (node.kind === 'menu') {
    const edge = findMenuEdge(definition.edges, node.id, input)
    if (!edge) {
      const retries = readRetries(variables) + 1
      if (retries >= MAX_INPUT_RETRIES) {
        // Respostas inválidas demais: falha o fluxo em vez de prender o contato
        // num menu em loop (a conversa volta a ficar aberta).
        await failSession(session.id, ctx.conversationId)
        return
      }
      variables.__retries = retries
      // Resposta fora das opções: repete o menu e continua aguardando.
      await sendMenu(rt, node, variables)
      await db
        .update(botSessions)
        .set({ variables, updatedAt: new Date() })
        .where(eq(botSessions.id, session.id))
      return
    }
    delete variables.__retries
    await db
      .update(botSessions)
      .set({ status: 'running', currentNodeId: edge.target, variables, updatedAt: new Date() })
      .where(eq(botSessions.id, session.id))
    await run({ ...session, variables }, definition, rt, edge.target)
    return
  }

  if (node.kind === 'buttons') {
    // A resposta pode ser callback de botão (id), o label da opção ou o número.
    const optionId = matchButtonsOption(readButtonOptions(node.data.options), input)
    if (!optionId) {
      // Resposta fora das opções: se o fluxo tem a aresta 'default' ("Outra
      // resposta"), segue por ela em vez de tratar como erro.
      const defaultEdge = definition.edges.find(
        (candidate) => candidate.source === node.id && candidate.sourceHandle === 'default',
      )
      if (defaultEdge) {
        delete variables.__retries
        await db
          .update(botSessions)
          .set({ status: 'running', currentNodeId: defaultEdge.target, variables, updatedAt: new Date() })
          .where(eq(botSessions.id, session.id))
        await run({ ...session, variables }, definition, rt, defaultEdge.target)
        return
      }
      const retries = readRetries(variables) + 1
      if (retries >= MAX_INPUT_RETRIES) {
        await failSession(session.id, ctx.conversationId)
        return
      }
      variables.__retries = retries
      // Resposta fora das opções: reenvia os botões e continua aguardando.
      await sendButtons(rt, node, variables)
      await db
        .update(botSessions)
        .set({ variables, updatedAt: new Date() })
        .where(eq(botSessions.id, session.id))
      return
    }
    delete variables.__retries
    const edge = findButtonsEdge(definition.edges, node.id, optionId)
    if (!edge) {
      // Opção válida sem nenhuma aresta: encerra o atendimento do bot.
      await finishSession({ ...session, variables }, ctx)
      return
    }
    await db
      .update(botSessions)
      .set({ status: 'running', currentNodeId: edge.target, variables, updatedAt: new Date() })
      .where(eq(botSessions.id, session.id))
    await run({ ...session, variables }, definition, rt, edge.target)
    return
  }

  if (node.kind === 'collect_input') {
    const validation = readValidation(node.data.validation)
    if (!isValidInput(validation, input)) {
      const retries = readRetries(variables) + 1
      if (retries >= MAX_INPUT_RETRIES) {
        await failSession(session.id, ctx.conversationId)
        return
      }
      variables.__retries = retries
      // Entrada inválida: reenvia a pergunta com aviso e continua aguardando.
      const question = interpolate(readString(node.data.question) ?? '', variables)
      const content = [invalidInputHint(validation), question].filter((line) => line.length > 0).join('\n')
      await sendBotMessage(rt, content, [])
      await db
        .update(botSessions)
        .set({ variables, updatedAt: new Date() })
        .where(eq(botSessions.id, session.id))
      return
    }
    delete variables.__retries
    const variableName = readString(node.data.variable) ?? 'input'
    variables[variableName] = input
    const nextId = nextNodeId(definition.edges, node.id)
    if (!nextId) {
      await finishSession({ ...session, variables }, ctx)
      return
    }
    await db
      .update(botSessions)
      .set({ status: 'running', currentNodeId: nextId, variables, updatedAt: new Date() })
      .where(eq(botSessions.id, session.id))
    await run({ ...session, variables }, definition, rt, nextId)
    return
  }

  throw new Error(`sessão ${session.id} aguardava input em nó ${node.kind} (inválido)`)
}

// ─── Execução do grafo ───────────────────────────────────────────────────────

async function run(
  session: BotSession,
  definition: BotFlowDefinition,
  rt: Runtime,
  startNodeId: string,
): Promise<void> {
  let currentId: string | null = startNodeId

  while (currentId) {
    // Takeover manual (POST /inbox/conversations/:id/bot/stop) ou falha
    // concorrente podem ter tirado a sessão de 'running' no meio do fluxo:
    // aborta em silêncio — quem cancelou já cuidou da conversa.
    const [fresh] = await db
      .select({ status: botSessions.status })
      .from(botSessions)
      .where(eq(botSessions.id, session.id))
      .limit(1)
    if (!fresh || fresh.status !== 'running') return

    const node = definition.nodes.find((candidate) => candidate.id === currentId)
    if (!node) throw new Error(`nó ${currentId} não encontrado no fluxo ${session.flowId}`)

    switch (node.kind) {
      case 'start': {
        currentId = nextNodeId(definition.edges, node.id)
        break
      }
      case 'message': {
        const text = interpolate(readString(node.data.text) ?? '', session.variables)
        const media = await resolveMessageMedia(rt, node)
        if (text.length > 0 || media.length > 0) {
          await sendBotMessage(rt, text, media)
        }
        currentId = nextNodeId(definition.edges, node.id)
        break
      }
      case 'menu': {
        await sendMenu(rt, node, session.variables)
        await waitForInput(session, node.id)
        return
      }
      case 'buttons': {
        await sendButtons(rt, node, session.variables)
        await waitForInput(session, node.id)
        return
      }
      case 'delay': {
        const seconds = readSeconds(node.data.seconds)
        const nextId = nextNodeId(definition.edges, node.id)
        if (!nextId) {
          await finishSession(session, rt)
          return
        }
        if (seconds <= 0) {
          // Delay inválido/zero: segue imediatamente para o próximo nó.
          currentId = nextId
          break
        }
        await scheduleResume(session, nextId, seconds)
        return
      }
      case 'collect_input': {
        const question = interpolate(readString(node.data.question) ?? '', session.variables)
        if (question.length > 0) {
          await sendBotMessage(rt, question, [])
        }
        await waitForInput(session, node.id)
        return
      }
      case 'condition': {
        const result = evaluateCondition(node, session.variables)
        const branch = nextNodeId(definition.edges, node.id, result ? 'true' : 'false')
        if (!branch) throw new Error(`condição ${node.id} sem aresta "${result ? 'true' : 'false'}"`)
        currentId = branch
        break
      }
      case 'assign_queue': {
        const queueId = readString(node.data.queueId)
        if (!queueId) throw new Error(`nó assign_queue ${node.id} sem queueId`)
        await handoff(session, rt, { queueId })
        return
      }
      case 'assign_agent': {
        const agentId = readString(node.data.agentId)
        if (!agentId) throw new Error(`nó assign_agent ${node.id} sem agentId`)
        await handoff(session, rt, { agentId })
        return
      }
      case 'close_conversation': {
        const text = interpolate(readString(node.data.message) ?? '', session.variables)
        if (text.length > 0) {
          await sendBotMessage(rt, text, [])
        }
        await closeConversation(session, rt)
        return
      }
      case 'manage_tag': {
        await applyTagChange(rt, node)
        currentId = nextNodeId(definition.edges, node.id)
        break
      }
      case 'webhook': {
        const saved = await callWebhook(rt, node, session.variables)
        if (saved) {
          session.variables = { ...session.variables, [saved.name]: saved.value }
          await db
            .update(botSessions)
            .set({ variables: session.variables, updatedAt: new Date() })
            .where(eq(botSessions.id, session.id))
        }
        currentId = nextNodeId(definition.edges, node.id)
        break
      }
      case 'end': {
        await finishSession(session, rt)
        return
      }
    }
  }

  // Fim de grafo sem nó end explícito: encerra o atendimento do bot.
  await finishSession(session, rt)
}

// ─── Delay: agenda a continuação do grafo na fila bot-resume-v1 ─────────────

async function scheduleResume(session: BotSession, nextNodeId: string, seconds: number): Promise<void> {
  const delayedUntil = new Date(Date.now() + seconds * 1000)
  // A sessão fica 'running' apontando para o próximo nó; __delayedUntil evita
  // que uma mensagem inbound durante a espera derrube a sessão como travada.
  await db
    .update(botSessions)
    .set({
      status: 'running',
      currentNodeId: nextNodeId,
      variables: { ...session.variables, __delayedUntil: delayedUntil.toISOString() },
      updatedAt: new Date(),
    })
    .where(eq(botSessions.id, session.id))

  await getBotResumeQueue().add(
    'resume',
    { botSessionId: session.id },
    { ...defaultCrmJobOptions, delay: seconds * 1000 },
  )
}

// Consumer da fila bot-resume-v1. Reconstrói o contexto a partir da sessão
// (sem mensagem inbound) e segue o grafo a partir do nó agendado.
export async function resumeDelayedSession(botSessionId: string): Promise<void> {
  try {
    const [session] = await db.select().from(botSessions).where(eq(botSessions.id, botSessionId)).limit(1)
    // Terminal (finished/failed/handed_off) ou waiting_input: nada a retomar.
    if (!session || session.status !== 'running') return

    const [flow] = await db.select().from(botFlows).where(eq(botFlows.id, session.flowId)).limit(1)
    if (!flow) throw new Error(`fluxo ${session.flowId} da sessão ${session.id} não existe mais`)

    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, session.conversationId))
      .limit(1)
    if (!conversation) throw new Error(`conversa ${session.conversationId} da sessão ${session.id} não existe mais`)

    const [connection] = await db
      .select()
      .from(connections)
      .where(eq(connections.id, conversation.connectionId))
      .limit(1)
    if (!connection) throw new Error(`conexão ${conversation.connectionId} da sessão ${session.id} não existe mais`)

    const variables = { ...session.variables }
    delete variables.__delayedUntil

    const rt: Runtime = {
      workspaceId: session.workspaceId,
      connectionId: connection.id,
      connectionKind: connection.kind,
      conversationId: conversation.id,
      contactId: conversation.contactId,
    }

    if (!session.currentNodeId) {
      await finishSession({ ...session, variables }, rt)
      return
    }

    await db
      .update(botSessions)
      .set({ variables, updatedAt: new Date() })
      .where(eq(botSessions.id, session.id))

    await run({ ...session, variables }, parseDefinition(flow.definition), rt, session.currentNodeId)
  } catch (error) {
    console.error('[crm-worker:bot] falha ao retomar sessão após delay:', error)
    const [session] = await db
      .select({ conversationId: botSessions.conversationId })
      .from(botSessions)
      .where(eq(botSessions.id, botSessionId))
      .limit(1)
    if (session) await failSession(botSessionId, session.conversationId)
  }
}

// ─── Ações terminais ─────────────────────────────────────────────────────────

async function waitForInput(session: BotSession, nodeId: string): Promise<void> {
  await db
    .update(botSessions)
    .set({ status: 'waiting_input', currentNodeId: nodeId, variables: session.variables, updatedAt: new Date() })
    .where(eq(botSessions.id, session.id))
}

async function handoff(session: BotSession, rt: Runtime, target: { queueId?: string; agentId?: string }): Promise<void> {
  const now = new Date()
  if (target.agentId) {
    await db
      .update(conversations)
      .set({ assignedAgentId: target.agentId, status: 'assigned', activeBotFlowId: null, updatedAt: now })
      .where(eq(conversations.id, rt.conversationId))
  } else {
    await db
      .update(conversations)
      .set({ queueId: target.queueId ?? null, activeBotFlowId: null, updatedAt: now })
      .where(eq(conversations.id, rt.conversationId))
  }

  await db
    .update(botSessions)
    .set({ status: 'handed_off', updatedAt: now })
    .where(eq(botSessions.id, session.id))

  await publishInboxEvent(
    buildInboxEvent('bot:handoff', {
      workspaceId: rt.workspaceId,
      conversationId: rt.conversationId,
      flowId: session.flowId,
      ...(target.agentId ? { agentId: target.agentId } : {}),
      ...(target.queueId ? { queueId: target.queueId } : {}),
    }),
  )
}

async function finishSession(session: BotSession, ctx: Runtime): Promise<void> {
  const now = new Date()
  await db
    .update(botSessions)
    .set({ status: 'finished', variables: session.variables, updatedAt: now })
    .where(eq(botSessions.id, session.id))
  await db
    .update(conversations)
    .set({ activeBotFlowId: null, updatedAt: now })
    .where(eq(conversations.id, ctx.conversationId))
  await publishInboxEvent(
    buildInboxEvent('bot:finished', { workspaceId: ctx.workspaceId, conversationId: ctx.conversationId, flowId: session.flowId }),
  )
}

// Nó close_conversation: encerra a sessão (finished), limpa o badge e resolve
// a conversa — é o único nó que fecha o atendimento.
async function closeConversation(session: BotSession, rt: Runtime): Promise<void> {
  const now = new Date()
  await db
    .update(botSessions)
    .set({ status: 'finished', variables: session.variables, updatedAt: now })
    .where(eq(botSessions.id, session.id))
  await db
    .update(conversations)
    .set({ status: 'resolved', resolvedAt: now, activeBotFlowId: null, updatedAt: now })
    .where(eq(conversations.id, rt.conversationId))
  await publishInboxEvent(
    buildInboxEvent('bot:finished', { workspaceId: rt.workspaceId, conversationId: rt.conversationId, flowId: session.flowId }),
  )
}

// Nó manage_tag: { action: 'add'|'remove', tagId }. Idempotente (add usa
// onConflictDoNothing; remove deleta o par). Tag fora do workspace = exceção
// → falha padrão da engine (sessão failed, conversa volta a open).
async function applyTagChange(rt: Runtime, node: BotFlowNode): Promise<void> {
  const tagId = readString(node.data.tagId)
  const action = node.data.action === 'add' ? 'add' : node.data.action === 'remove' ? 'remove' : null
  if (!tagId || !action) throw new Error(`nó manage_tag ${node.id} sem action/tagId válidos`)

  const [tag] = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.id, tagId), eq(tags.workspaceId, rt.workspaceId)))
    .limit(1)
  if (!tag) throw new Error(`tag ${tagId} do nó manage_tag ${node.id} não existe no workspace`)

  if (action === 'add') {
    await db
      .insert(conversationTags)
      .values({ conversationId: rt.conversationId, tagId })
      .onConflictDoNothing()
  } else {
    await db
      .delete(conversationTags)
      .where(and(eq(conversationTags.conversationId, rt.conversationId), eq(conversationTags.tagId, tagId)))
  }
}

const WEBHOOK_TIMEOUT_MS = 10_000

// Nó webhook: { url, method?: 'GET'|'POST', saveToVariable? }. POST envia JSON
// { variables, contact: { id }, conversation: { id } } — variables sem as
// chaves internas "__*". Erro de rede, timeout (10s) ou status >= 400 =
// exceção → falha padrão da engine. Com saveToVariable, retorna a variável a
// persistir (corpo JSON parseado; texto puro quando não é JSON).
async function callWebhook(
  rt: Runtime,
  node: BotFlowNode,
  variables: Record<string, unknown>,
): Promise<{ name: string; value: unknown } | null> {
  const url = readString(node.data.url)
  if (!url) throw new Error(`nó webhook ${node.id} sem url`)
  const method = node.data.method === 'POST' ? 'POST' : 'GET'
  const saveToVariable = readString(node.data.saveToVariable)

  const publicVariables = Object.fromEntries(
    Object.entries(variables).filter(([key]) => !key.startsWith('__')),
  )

  let response: Response
  try {
    response = await fetch(url, {
      method,
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      ...(method === 'POST'
        ? {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              variables: publicVariables,
              contact: { id: rt.contactId },
              conversation: { id: rt.conversationId },
            }),
          }
        : {}),
    })
  } catch (error) {
    throw new Error(
      `webhook do nó ${node.id} falhou (${url}): ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (response.status >= 400) {
    throw new Error(`webhook do nó ${node.id} respondeu ${response.status} (${url})`)
  }
  if (!saveToVariable) return null

  const body = await response.text()
  let value: unknown = body
  try {
    value = JSON.parse(body)
  } catch {
    // Corpo não-JSON: guarda o texto puro na variável.
  }
  return { name: saveToVariable, value }
}

// Falha best-effort: nunca propaga — o atendimento humano não pode depender do bot.
async function failSession(sessionId: string | null, conversationId: string): Promise<void> {
  try {
    const now = new Date()
    if (sessionId) {
      await db.update(botSessions).set({ status: 'failed', updatedAt: now }).where(eq(botSessions.id, sessionId))
    }
    await db.update(conversations).set({ activeBotFlowId: null, updatedAt: now }).where(eq(conversations.id, conversationId))
  } catch (error) {
    console.error('[crm-worker:bot] falha ao marcar sessão como failed:', error)
  }
}

// ─── Envio de mensagens do bot (agentId null, via fila de outbound) ──────────

async function resolveTarget(rt: Runtime): Promise<string> {
  if (rt.target) return rt.target
  const identities = await db
    .select()
    .from(contactIdentities)
    .where(and(eq(contactIdentities.contactId, rt.contactId), eq(contactIdentities.channelType, rt.connectionKind)))
  const identity = identities.find((candidate) => candidate.isPrimary) ?? identities[0]
  if (!identity) throw new Error(`contato ${rt.contactId} sem identidade no canal ${rt.connectionKind}`)
  rt.target = identity.channelIdentifier
  return rt.target
}

async function sendBotMessage(rt: Runtime, content: string, media: MediaRef[], buttons: OutboundButton[] = []): Promise<void> {
  const target = await resolveTarget(rt)
  const messageId = generateId()
  await db.insert(messages).values({
    id: messageId,
    conversationId: rt.conversationId,
    direction: 'outbound',
    content,
    kind: media[0]?.kind ?? 'text',
    status: 'queued',
    agentId: null,
    connectionId: rt.connectionId,
    attachments: media,
  })
  await getOutboundQueue().add(
    'send',
    {
      workspaceId: rt.workspaceId,
      connectionId: rt.connectionId,
      conversationId: rt.conversationId,
      messageId,
      target,
      content,
      ...(media.length > 0 ? { media } : {}),
      ...(buttons.length > 0 ? { buttons } : {}),
    },
    defaultCrmJobOptions,
  )
}

// Mensagem de sistema fora do fluxo de bot (ex.: auto-reply de fora de
// horário, disparada pelo inbound handler). Mesmo canal das mensagens do bot.
export async function sendSystemMessage(rt: BotRuntime, content: string): Promise<void> {
  await sendBotMessage(rt, content, [])
}

async function sendMenu(rt: Runtime, node: BotFlowNode, variables: Record<string, unknown>): Promise<void> {
  const intro = interpolate(readString(node.data.text) ?? '', variables)
  const options = readOptions(node.data.options)
  const lines = options.map((option, index) => `${index + 1}. ${option}`)
  const content = [intro, ...lines].filter((line) => line.length > 0).join('\n')
  await sendBotMessage(rt, content, [])
}

// Nó 'buttons': Telegram recebe inline keyboard; no WhatsApp o session-host
// degrada para lista numerada anexada ao texto.
async function sendButtons(rt: Runtime, node: BotFlowNode, variables: Record<string, unknown>): Promise<void> {
  const text = interpolate(readString(node.data.text) ?? '', variables)
  const options = readButtonOptions(node.data.options)
  // Telegram não aceita mensagem vazia: sem texto, usa a lista numerada como
  // conteúdo (funciona nos dois canais). Sem texto e sem opções, não envia.
  const fallback = options.map((option, index) => `${index + 1}. ${option.label}`).join('\n')
  const content = text.length > 0 ? text : fallback
  if (content.length === 0) return
  await sendBotMessage(rt, content, [], options)
}

// ─── Helpers do grafo ────────────────────────────────────────────────────────

function parseDefinition(raw: Record<string, unknown>): BotFlowDefinition {
  const definition = raw as unknown as BotFlowDefinition
  if (!Array.isArray(definition.nodes) || !Array.isArray(definition.edges)) {
    throw new Error('definition do fluxo inválida: esperado { nodes, edges }')
  }
  return definition
}

function nextNodeId(edges: BotFlowEdge[], sourceId: string, sourceHandle?: string): string | null {
  const edge = edges.find(
    (candidate) =>
      candidate.source === sourceId
      && (sourceHandle === undefined ? true : candidate.sourceHandle === sourceHandle),
  )
  return edge?.target ?? null
}

// Resposta numérica do menu casa com o sourceHandle da aresta: o editor salva
// "opt-0", "opt-1", ... (índice 0-based da opção); o contato responde com o
// número 1-based da lista enviada ("1" → "opt-0").
function findMenuEdge(edges: BotFlowEdge[], nodeId: string, input: string): BotFlowEdge | null {
  const choice = Number.parseInt(input, 10)
  if (Number.isNaN(choice) || choice < 1) return null
  return (
    edges.find((candidate) => candidate.source === nodeId && candidate.sourceHandle === `opt-${choice - 1}`) ?? null
  )
}

// Casa a resposta do contato com uma opção de 'buttons': callback_data (id),
// label exata (case-insensitive) ou número 1-based da opção.
function matchButtonsOption(options: OutboundButton[], input: string): string | null {
  const byId = options.find((option) => option.id === input)
  if (byId) return byId.id
  const normalized = input.trim().toLowerCase()
  const byLabel = options.find((option) => option.label.trim().toLowerCase() === normalized)
  if (byLabel) return byLabel.id
  const index = Number.parseInt(input, 10)
  if (!Number.isNaN(index) && index >= 1 && index <= options.length) return options[index - 1]!.id
  return null
}

// Opção válida: segue a aresta com sourceHandle = id da opção; fallback para a
// aresta 'default' ou a primeira aresta do nó.
function findButtonsEdge(edges: BotFlowEdge[], nodeId: string, optionId: string): BotFlowEdge | null {
  return (
    edges.find((candidate) => candidate.source === nodeId && candidate.sourceHandle === optionId)
    ?? edges.find((candidate) => candidate.source === nodeId && candidate.sourceHandle === 'default')
    ?? edges.find((candidate) => candidate.source === nodeId)
    ?? null
  )
}

// ─── Validação de collect_input ──────────────────────────────────────────────

function readValidation(value: unknown): BotInputValidation {
  return value === 'number' || value === 'email' || value === 'phone' ? value : 'text'
}

function isValidInput(validation: BotInputValidation, input: string): boolean {
  const trimmed = input.trim()
  switch (validation) {
    case 'number':
      return trimmed.length > 0 && !Number.isNaN(Number(trimmed))
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
    case 'phone':
      return trimmed.replace(/\D/g, '').length >= 8
    default:
      return true
  }
}

function invalidInputHint(validation: BotInputValidation): string {
  switch (validation) {
    case 'number':
      return 'Resposta inválida: informe um número.'
    case 'email':
      return 'Resposta inválida: informe um e-mail válido.'
    case 'phone':
      return 'Resposta inválida: informe um telefone válido.'
    default:
      return 'Resposta inválida.'
  }
}

// ─── Helpers de leitura defensiva ────────────────────────────────────────────

function readRetries(variables: Record<string, unknown>): number {
  const value = variables.__retries
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function readSeconds(value: unknown): number {
  const seconds = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
}

function readDelayedUntil(variables: Record<string, unknown>): Date | null {
  const raw = variables.__delayedUntil
  if (typeof raw !== 'string') return null
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
}

function readButtonOptions(value: unknown): OutboundButton[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is OutboundButton =>
      typeof item === 'object'
      && item !== null
      && typeof (item as OutboundButton).id === 'string'
      && typeof (item as OutboundButton).label === 'string',
  )
}

// Condição salva pelo editor: { variable, operator: 'contains'|'equals', value }.
// Comparação sempre case-insensitive com trim; sem variável, usa o último input.
function evaluateCondition(node: BotFlowNode, variables: Record<string, unknown>): boolean {
  const variable = readString(node.data.variable)
  const expected = (readString(node.data.value) ?? '').trim().toLowerCase()
  if (expected.length === 0) return false
  const raw = variable ? variables[variable] : variables.__lastInput
  const value = (raw === undefined || raw === null ? '' : String(raw)).trim().toLowerCase()
  const operator = readConditionOperator(node.data.operator)
  return operator === 'equals' ? value === expected : value.includes(expected)
}

function readConditionOperator(value: unknown): BotConditionOperator {
  return value === 'equals' ? 'equals' : 'contains'
}

function interpolate(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = variables[name]
    return value === undefined || value === null ? '' : String(value)
  })
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readOptions(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function readMedia(value: unknown): MediaRef[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is MediaRef =>
      typeof item === 'object'
      && item !== null
      && typeof (item as MediaRef).storageKey === 'string'
      && typeof (item as MediaRef).mimeType === 'string'
      && typeof (item as MediaRef).filename === 'string',
  )
}

// Anexo do nó 'message': o editor salva só attachmentFileId (arquivo da
// biblioteca) — a definição do fluxo não duplica storageKey. A engine resolve o
// arquivo na tabela files (escopado ao workspace) e monta o MediaRef. Arquivo
// deletado é falha tratada: registra o aviso, envia a mensagem sem o anexo e
// segue o fluxo (derrubar o fluxo por causa de um anexo puniria o contato, e
// o invariante é que o bot nunca trava o atendimento).
async function resolveMessageMedia(rt: Runtime, node: BotFlowNode): Promise<MediaRef[]> {
  const fileId = readString(node.data.attachmentFileId)
  if (!fileId) {
    // Legado: definições antigas com media inline no nó.
    return readMedia(node.data.media)
  }
  const [file] = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.workspaceId, rt.workspaceId)))
    .limit(1)
  if (!file) {
    console.warn(`[crm-worker:bot] anexo ${fileId} do nó ${node.id} não existe mais; mensagem segue sem anexo`)
    return []
  }
  return [{ storageKey: file.storageKey, mimeType: file.mimeType, kind: file.kind, filename: file.filename }]
}
