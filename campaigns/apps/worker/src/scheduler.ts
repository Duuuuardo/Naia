// Tick do agendador (30s): varre o Postgres por campanhas com next_run_at
// vencido e automações devidas, e pede à API para iniciar o run — a resolução
// de audiência vive lá porque expandir grupos exige o socket Baileys (mesmo
// motivo do /internal/whatsapp-send). BullMQ repeatables foram descartados de
// propósito: o estado de agendamento mora só no banco, então pause/edit/cancel
// nunca dessincroniza e um tick perdido se recupera sozinho no seguinte.

import { db, campaigns, automations } from '@naia/db'
import { sql, eq, and } from 'drizzle-orm'
import { dayKeyInTz, isPastTimeOfDay } from '@naia/scheduling'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`[worker:scheduler] Variável de ambiente obrigatória ausente: ${name}`)
  }
  return value
}

const API_URL = requireEnv('NAIA_API_URL')
const INTERNAL_SECRET = requireEnv('NAIA_INTERNAL_SECRET')

async function callInternal(path: string, body: unknown): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': INTERNAL_SECRET,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  })
  return { ok: res.ok, status: res.status }
}

async function tickDueCampaigns(): Promise<void> {
  // Claim atômico: zera next_run_at ao reivindicar, devolvendo o valor antigo.
  // Se a chamada à API falhar, restauramos o horário pro próximo tick tentar.
  const due = (await db.execute(sql`
    WITH due AS (
      SELECT id, next_run_at FROM campaigns
      WHERE status = 'scheduled' AND next_run_at IS NOT NULL AND next_run_at <= now()
      FOR UPDATE SKIP LOCKED
    )
    UPDATE campaigns c SET next_run_at = NULL, updated_at = now()
    FROM due WHERE c.id = due.id
    RETURNING c.id, due.next_run_at AS "scheduledFor"
  `)) as unknown as Array<{ id: string; scheduledFor: Date | string }>

  for (const row of due) {
    const scheduledFor = new Date(row.scheduledFor)
    try {
      console.log(`[scheduler] campanha ${row.id} devida (${scheduledFor.toISOString()}) — iniciando run`)
      const res = await callInternal(`/internal/campaigns/${row.id}/start-run`, {
        scheduledFor: scheduledFor.toISOString(),
      })
      if (!res.ok) throw new Error(`API retornou ${res.status}`)
    } catch (err) {
      console.error(`[scheduler] falha ao iniciar run da campanha ${row.id} — restaurando agendamento:`, err)
      await db
        .update(campaigns)
        .set({ nextRunAt: scheduledFor, updatedAt: new Date() })
        .where(sql`${campaigns.id} = ${row.id} AND ${campaigns.status} = 'scheduled' AND ${campaigns.nextRunAt} IS NULL`)
    }
  }
}

async function tickDueAutomations(): Promise<void> {
  // Só aniversário passa pelo fluxo diário de evaluate — os outros gatilhos
  // (webhook, tag_added, contact_created) entram pela régua (tickDueEnrollments)
  const now = new Date()
  const active = await db
    .select()
    .from(automations)
    .where(and(eq(automations.active, true), eq(automations.type, 'birthday')))

  for (const automation of active) {
    const today = dayKeyInTz(now, automation.timezone)
    // Guarda de idempotência: uma avaliação por dia (no fuso da automação)
    if (automation.lastEvaluatedDate === today) continue
    if (!isPastTimeOfDay(now, automation.timezone, automation.sendTime)) continue

    try {
      console.log(`[scheduler] automação ${automation.id} (${automation.name}) devida — avaliando`)
      const res = await callInternal(`/internal/automations/${automation.id}/evaluate`, {})
      if (!res.ok) throw new Error(`API retornou ${res.status}`)
    } catch (err) {
      // lastEvaluatedDate só é escrito pelo evaluate na API — falha aqui
      // significa retry no próximo tick, o que é o comportamento desejado.
      console.error(`[scheduler] falha ao avaliar automação ${automation.id}:`, err)
    }
  }
}

async function tickDueEnrollments(): Promise<void> {
  // Claim com lease: empurra next_step_at +5min ao reivindicar — se a chamada
  // à API falhar (ou o worker morrer no meio), o lease expira e o próximo
  // tick tenta de novo sozinho. Automação inativa não é reivindicada: a régua
  // fica pausada e retoma quando reativarem.
  const due = (await db.execute(sql`
    WITH due AS (
      SELECT e.id, e.automation_id FROM automation_enrollments e
      JOIN automations a ON a.id = e.automation_id
      WHERE e.status = 'active' AND e.next_step_at <= now() AND a.active = true
      ORDER BY e.next_step_at
      LIMIT 200
      FOR UPDATE OF e SKIP LOCKED
    )
    UPDATE automation_enrollments e SET next_step_at = now() + interval '5 minutes', updated_at = now()
    FROM due WHERE e.id = due.id
    RETURNING e.id, due.automation_id AS "automationId"
  `)) as unknown as Array<{ id: string; automationId: string }>
  if (due.length === 0) return

  const byAutomation = new Map<string, string[]>()
  for (const row of due) {
    const ids = byAutomation.get(row.automationId) ?? []
    ids.push(row.id)
    byAutomation.set(row.automationId, ids)
  }

  for (const [automationId, enrollmentIds] of byAutomation) {
    try {
      console.log(`[scheduler] automação ${automationId} — ${enrollmentIds.length} inscrição(ões) devida(s) na régua`)
      const res = await callInternal(`/internal/automations/${automationId}/execute-steps`, { enrollmentIds })
      if (!res.ok) throw new Error(`API retornou ${res.status}`)
    } catch (err) {
      // lease de 5min reagenda sozinho — só logar
      console.error(`[scheduler] falha ao executar passos da automação ${automationId}:`, err)
    }
  }
}

export async function schedulerTick(): Promise<void> {
  try {
    await tickDueCampaigns()
    await tickDueAutomations()
    await tickDueEnrollments()
  } catch (err) {
    console.error('[scheduler] erro no tick:', err)
  }
}
