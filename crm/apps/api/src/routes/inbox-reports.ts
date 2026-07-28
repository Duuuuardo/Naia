import { Elysia, t } from 'elysia'
import { db } from '@crm/db'
import {
  conversations,
  queues,
  messages,
  connections,
  deals,
  conversationRatings,
  conversationTransfers,
  agents,
} from '@crm/db/schema'
import { eq, and, gte, count, avg, sum, sql } from 'drizzle-orm'
import { authInboxPlugin } from '../plugins/auth-inbox'

const ALLOWED_DAYS = [7, 30, 90] as const

export const inboxReportsRoutes = new Elysia({ name: 'inbox-reports' })
  .use(authInboxPlugin)

  // GET /inbox/reports/summary?days=7|30|90 — dashboard do período: conversas
  // por status, por fila e por equipe, tempo médio de primeira resposta por
  // agente e por equipe, deals por status e valores em aberto/ganho, volume
  // de mensagens por canal, transferências por agente e CSAT (média,
  // distribuição 1-5 e média por agente).
  .get(
    '/inbox/reports/summary',
    async ({ agent, query, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }
      // Relatório geral da workspace (todos os agentes/filas/CSAT) é restrito a
      // superadmin/admin. Agente comum só enxerga o próprio desempenho
      // (GET /inbox/reports/me).
      if (agent.role !== 'superadmin' && agent.role !== 'admin') {
        set.status = 403
        return { message: 'Apenas administradores podem ver os relatórios da workspace.' }
      }

      const requested = query.days ?? 7
      const days = ALLOWED_DAYS.includes(requested as (typeof ALLOWED_DAYS)[number]) ? requested : 7
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

      // Conversas criadas no período, por status.
      const conversationsByStatus = await db
        .select({ status: conversations.status, value: count() })
        .from(conversations)
        .where(and(eq(conversations.workspaceId, agent.workspaceId), gte(conversations.createdAt, since)))
        .groupBy(conversations.status)

      // Conversas do período por fila (null = sem fila).
      const conversationsByQueue = await db
        .select({ queueId: queues.id, queueName: queues.name, value: count() })
        .from(conversations)
        .leftJoin(queues, eq(conversations.queueId, queues.id))
        .where(and(eq(conversations.workspaceId, agent.workspaceId), gte(conversations.createdAt, since)))
        .groupBy(queues.id, queues.name)

      // Tempo médio de primeira resposta por agente: primeira mensagem
      // outbound com agentId depois da primeira inbound da conversa. Agregação
      // em duas CTEs — mais legível em SQL cru do que no query builder.
      const firstResponseRows = await db.execute<{
        agent_id: string
        agent_name: string
        avg_seconds: number
        conversations: number
      }>(sql`
        with first_inbound as (
          select conversation_id, min(sent_at) as first_at
          from messages
          group by conversation_id
        ),
        first_response as (
          select m.conversation_id, min(m.sent_at) as first_at
          from messages m
          join first_inbound fi on fi.conversation_id = m.conversation_id
          where m.direction = 'outbound' and m.agent_id is not null and m.sent_at > fi.first_at
          group by m.conversation_id
        )
        select m.agent_id,
               a.name as agent_name,
               avg(extract(epoch from (fr.first_at - fi.first_at)))::float8 as avg_seconds,
               count(*)::int as conversations
        from first_response fr
        join first_inbound fi on fi.conversation_id = fr.conversation_id
        join messages m
          on m.conversation_id = fr.conversation_id
         and m.sent_at = fr.first_at
         and m.direction = 'outbound'
         and m.agent_id is not null
        join agents a on a.id = m.agent_id
        join conversations c on c.id = fr.conversation_id
        where c.workspace_id = ${agent.workspaceId}
          -- ISO string + cast: o driver postgres.js não serializa Date crua em
          -- comparação com coluna timestamp (sem tz) em prepared statement.
          and fr.first_at >= ${since.toISOString()}::timestamptz
        group by m.agent_id, a.name
        order by avg_seconds asc
      `)

      // Conversas do período por equipe: uma conversa conta para a equipe
      // quando está atribuída a um agente membro dela OU a uma fila da equipe
      // (pode contar em mais de uma equipe). SQL cru: o join OR entre
      // team_members e queues com count distinct é mais legível assim.
      const conversationsByTeamRows = await db.execute<{
        team_id: string
        team_name: string
        conversations: number
      }>(sql`
        select t.id as team_id,
               t.name as team_name,
               count(distinct c.id)::int as conversations
        from teams t
        left join team_members tm on tm.team_id = t.id
        left join queues q on q.team_id = t.id
        join conversations c
          on c.workspace_id = ${agent.workspaceId}
         -- ISO string + cast: mesmo motivo do firstResponseByAgent abaixo.
         and c.created_at >= ${since.toISOString()}::timestamptz
         and (c.assigned_agent_id = tm.agent_id or c.queue_id = q.id)
        where t.workspace_id = ${agent.workspaceId}
        group by t.id, t.name
        order by conversations desc
      `)

      // Tempo médio de primeira resposta por equipe: mesmas CTEs do
      // firstResponseByAgent, agrupando pela equipe do agente que respondeu.
      const firstResponseByTeamRows = await db.execute<{
        team_id: string
        team_name: string
        avg_seconds: number
        conversations: number
      }>(sql`
        with first_inbound as (
          select conversation_id, min(sent_at) as first_at
          from messages
          group by conversation_id
        ),
        first_response as (
          select m.conversation_id, min(m.sent_at) as first_at
          from messages m
          join first_inbound fi on fi.conversation_id = m.conversation_id
          where m.direction = 'outbound' and m.agent_id is not null and m.sent_at > fi.first_at
          group by m.conversation_id
        )
        select t.id as team_id,
               t.name as team_name,
               avg(extract(epoch from (fr.first_at - fi.first_at)))::float8 as avg_seconds,
               count(distinct fr.conversation_id)::int as conversations
        from first_response fr
        join first_inbound fi on fi.conversation_id = fr.conversation_id
        join messages m
          on m.conversation_id = fr.conversation_id
         and m.sent_at = fr.first_at
         and m.direction = 'outbound'
         and m.agent_id is not null
        join team_members tm on tm.agent_id = m.agent_id
        join teams t on t.id = tm.team_id
        join conversations c on c.id = fr.conversation_id
        where c.workspace_id = ${agent.workspaceId}
          and fr.first_at >= ${since.toISOString()}::timestamptz
        group by t.id, t.name
        order by avg_seconds asc
      `)

      // Deals por status com valor somado (snapshot atual, não do período —
      // funil é estado, não fluxo).
      const dealsByStatus = await db
        .select({ status: deals.status, value: count(), totalCents: sum(deals.valueCents) })
        .from(deals)
        .where(eq(deals.workspaceId, agent.workspaceId))
        .groupBy(deals.status)

      // Volume de mensagens do período por canal (kind da conexão de origem).
      const messagesByChannel = await db
        .select({ channel: connections.kind, value: count() })
        .from(messages)
        .innerJoin(conversations, eq(messages.conversationId, conversations.id))
        .innerJoin(connections, eq(messages.connectionId, connections.id))
        .where(and(eq(conversations.workspaceId, agent.workspaceId), gte(messages.sentAt, since)))
        .groupBy(connections.kind)

      // Transferências do período por agente que transferiu.
      const transfersByAgent = await db
        .select({ agentId: agents.id, agentName: agents.name, value: count() })
        .from(conversationTransfers)
        .innerJoin(agents, eq(conversationTransfers.transferredByAgentId, agents.id))
        .where(
          and(
            eq(conversationTransfers.workspaceId, agent.workspaceId),
            gte(conversationTransfers.createdAt, since),
          ),
        )
        .groupBy(agents.id, agents.name)

      // CSAT do período (por createdAt da avaliação): distribuição 1-5 e
      // média por agente (agente atribuído na resolução; null = sem dono).
      const csatDistributionRows = await db
        .select({ score: conversationRatings.score, value: count() })
        .from(conversationRatings)
        .where(and(eq(conversationRatings.workspaceId, agent.workspaceId), gte(conversationRatings.createdAt, since)))
        .groupBy(conversationRatings.score)

      const csatByAgentRows = await db
        .select({
          agentId: conversationRatings.agentId,
          agentName: agents.name,
          averageScore: avg(conversationRatings.score),
          totalRatings: count(),
        })
        .from(conversationRatings)
        .leftJoin(agents, eq(conversationRatings.agentId, agents.id))
        .where(and(eq(conversationRatings.workspaceId, agent.workspaceId), gte(conversationRatings.createdAt, since)))
        .groupBy(conversationRatings.agentId, agents.name)

      const csatTotalRatings = csatDistributionRows.reduce((acc, r) => acc + r.value, 0)
      const csatScoreSum = csatDistributionRows.reduce((acc, r) => acc + r.score * r.value, 0)

      const openValueCents = dealsByStatus
        .filter((r) => r.status === 'open')
        .reduce((acc, r) => acc + Number(r.totalCents ?? 0), 0)
      const wonValueCents = dealsByStatus
        .filter((r) => r.status === 'won')
        .reduce((acc, r) => acc + Number(r.totalCents ?? 0), 0)

      return {
        periodDays: days,
        conversationsByStatus: conversationsByStatus.map((r) => ({ status: r.status, count: r.value })),
        conversationsByQueue: conversationsByQueue.map((r) => ({
          queueId: r.queueId,
          queueName: r.queueName ?? 'Sem fila',
          count: r.value,
        })),
        conversationsByTeam: conversationsByTeamRows.map((r) => ({
          teamId: r.team_id,
          teamName: r.team_name,
          count: r.conversations,
        })),
        firstResponseByAgent: firstResponseRows.map((r) => ({
          agentId: r.agent_id,
          agentName: r.agent_name,
          avgSeconds: Math.round(r.avg_seconds),
          conversations: r.conversations,
        })),
        firstResponseByTeam: firstResponseByTeamRows.map((r) => ({
          teamId: r.team_id,
          teamName: r.team_name,
          avgSeconds: Math.round(r.avg_seconds),
          conversations: r.conversations,
        })),
        deals: {
          byStatus: dealsByStatus.map((r) => ({
            status: r.status,
            count: r.value,
            valueCents: Number(r.totalCents ?? 0),
          })),
          openValueCents,
          wonValueCents,
        },
        messagesByChannel: messagesByChannel.map((r) => ({ channel: r.channel, count: r.value })),
        transfersByAgent: transfersByAgent.map((r) => ({
          agentId: r.agentId,
          agentName: r.agentName,
          count: r.value,
        })),
        csat: {
          averageScore: csatTotalRatings === 0 ? null : Math.round((csatScoreSum / csatTotalRatings) * 10) / 10,
          totalRatings: csatTotalRatings,
          // Sempre as 5 posições (1-5), mesmo sem avaliações no período.
          distribution: [1, 2, 3, 4, 5].map((score) => ({
            score,
            count: csatDistributionRows.find((r) => r.score === score)?.value ?? 0,
          })),
          byAgent: csatByAgentRows
            .map((r) => ({
              agentId: r.agentId,
              agentName: r.agentName ?? 'Sem agente',
              averageScore: Math.round(Number(r.averageScore ?? 0) * 10) / 10,
              totalRatings: r.totalRatings,
            }))
            .sort((a, b) => b.averageScore - a.averageScore),
        },
      }
    },
    {
      query: t.Object({ days: t.Optional(t.Numeric()) }),
    },
  )

  // GET /inbox/reports/me?days=7|30|90 — desempenho pessoal do agente
  // autenticado (qualquer papel). Escopado a agent.id: conversas atribuídas,
  // resolvidas no período, 1ª resposta, mensagens enviadas, transferências e
  // CSAT das notas atribuídas a ele.
  .get(
    '/inbox/reports/me',
    async ({ agent, query, set }) => {
      if (!agent) {
        set.status = 401
        return { message: 'Não autenticado.' }
      }

      const requested = query.days ?? 7
      const days = ALLOWED_DAYS.includes(requested as (typeof ALLOWED_DAYS)[number]) ? requested : 7
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

      // Conversas atualmente atribuídas a mim, por status (snapshot).
      const assignedByStatus = await db
        .select({ status: conversations.status, value: count() })
        .from(conversations)
        .where(and(eq(conversations.workspaceId, agent.workspaceId), eq(conversations.assignedAgentId, agent.id)))
        .groupBy(conversations.status)

      // Resolvidas por mim no período (resolvedAt no intervalo).
      const [{ value: resolvedCount }] = await db
        .select({ value: count() })
        .from(conversations)
        .where(
          and(
            eq(conversations.workspaceId, agent.workspaceId),
            eq(conversations.assignedAgentId, agent.id),
            eq(conversations.status, 'resolved'),
            gte(conversations.resolvedAt, since),
          ),
        )

      // Mensagens que eu enviei no período (outbound com o meu agent_id).
      const [{ value: messagesSent }] = await db
        .select({ value: count() })
        .from(messages)
        .innerJoin(conversations, eq(messages.conversationId, conversations.id))
        .where(
          and(
            eq(conversations.workspaceId, agent.workspaceId),
            eq(messages.direction, 'outbound'),
            eq(messages.agentId, agent.id),
            gte(messages.sentAt, since),
          ),
        )

      // Transferências que eu iniciei no período.
      const [{ value: transfersMade }] = await db
        .select({ value: count() })
        .from(conversationTransfers)
        .where(
          and(
            eq(conversationTransfers.workspaceId, agent.workspaceId),
            eq(conversationTransfers.transferredByAgentId, agent.id),
            gte(conversationTransfers.createdAt, since),
          ),
        )

      // 1ª resposta média nas conversas em que EU dei a primeira resposta
      // (mesmas CTEs do relatório geral, filtradas pelo meu agent_id).
      const firstResponseRows = await db.execute<{ avg_seconds: number | null; conversations: number }>(sql`
        with first_inbound as (
          select conversation_id, min(sent_at) as first_at
          from messages
          group by conversation_id
        ),
        first_response as (
          select m.conversation_id, min(m.sent_at) as first_at
          from messages m
          join first_inbound fi on fi.conversation_id = m.conversation_id
          where m.direction = 'outbound' and m.agent_id is not null and m.sent_at > fi.first_at
          group by m.conversation_id
        )
        select avg(extract(epoch from (fr.first_at - fi.first_at)))::float8 as avg_seconds,
               count(*)::int as conversations
        from first_response fr
        join first_inbound fi on fi.conversation_id = fr.conversation_id
        join messages m
          on m.conversation_id = fr.conversation_id
         and m.sent_at = fr.first_at
         and m.direction = 'outbound'
         and m.agent_id = ${agent.id}
        join conversations c on c.id = fr.conversation_id
        where c.workspace_id = ${agent.workspaceId}
          and fr.first_at >= ${since.toISOString()}::timestamptz
      `)

      // CSAT das notas atribuídas a mim no período.
      const csatDistributionRows = await db
        .select({ score: conversationRatings.score, value: count() })
        .from(conversationRatings)
        .where(
          and(
            eq(conversationRatings.workspaceId, agent.workspaceId),
            eq(conversationRatings.agentId, agent.id),
            gte(conversationRatings.createdAt, since),
          ),
        )
        .groupBy(conversationRatings.score)

      const csatTotalRatings = csatDistributionRows.reduce((acc, r) => acc + r.value, 0)
      const csatScoreSum = csatDistributionRows.reduce((acc, r) => acc + r.score * r.value, 0)
      const firstResponse = firstResponseRows[0]

      return {
        periodDays: days,
        assignedByStatus: assignedByStatus.map((r) => ({ status: r.status, count: r.value })),
        resolvedCount,
        messagesSent,
        transfersMade,
        firstResponse: {
          avgSeconds:
            firstResponse && firstResponse.avg_seconds != null ? Math.round(firstResponse.avg_seconds) : null,
          conversations: firstResponse?.conversations ?? 0,
        },
        csat: {
          averageScore: csatTotalRatings === 0 ? null : Math.round((csatScoreSum / csatTotalRatings) * 10) / 10,
          totalRatings: csatTotalRatings,
          distribution: [1, 2, 3, 4, 5].map((score) => ({
            score,
            count: csatDistributionRows.find((r) => r.score === score)?.value ?? 0,
          })),
        },
      }
    },
    {
      query: t.Object({ days: t.Optional(t.Numeric()) }),
    },
  )
