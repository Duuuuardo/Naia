// Tick do agendador (30s): varre o Postgres por campanhas com next_run_at
// vencido e automações devidas, e pede à API para iniciar o run — a resolução
// de audiência vive lá porque expandir grupos exige o socket Baileys (mesmo
// motivo do /internal/whatsapp-send). BullMQ repeatables foram descartados de
// propósito: o estado de agendamento mora só no banco, então pause/edit/cancel
// nunca dessincroniza e um tick perdido se recupera sozinho no seguinte.

import { db, campaigns, automations } from '@naia/db'
import { sql, eq } from 'drizzle-orm'
import { dayKeyInTz, isPastTimeOfDay } from '@naia/scheduling'

const API_URL = process.env.NAIA_API_URL ?? 'http://localhost:4001'
const INTERNAL_SECRET = process.env.NAIA_INTERNAL_SECRET ?? ''

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
  const now = new Date()
  const active = await db.select().from(automations).where(eq(automations.active, true))

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

export async function schedulerTick(): Promise<void> {
  try {
    await tickDueCampaigns()
    await tickDueAutomations()
  } catch (err) {
    console.error('[scheduler] erro no tick:', err)
  }
}
