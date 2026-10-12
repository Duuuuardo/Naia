
import { describe, expect, it, beforeAll, beforeEach, mock } from 'bun:test'

process.env.NAIA_DATABASE_URL = process.env.NAIA_TEST_DATABASE_URL ?? 'postgres://naia:naia_secret@localhost:5435/naia_test'
process.env.NAIA_REDIS_URL = process.env.NAIA_TEST_REDIS_URL ?? 'redis://:naia_redis_secret@localhost:6381/7'
process.env.NAIA_INTERNAL_SECRET ??= 'test-internal-secret'
process.env.NAIA_WEB_URL ??= 'http://localhost:3001'
process.env.NAIA_API_URL ??= 'http://localhost:4001'
process.env.VIANOVA_API_URL ??= 'http://localhost:4000'
process.env.SESSION_HOST_BASE_URL ??= 'http://localhost:4010'
process.env.SESSION_HOST_SCALE_URL ??= 'http://localhost:4011'

class MockSendError extends Error {
  readonly retryable: boolean
  constructor(message: string, retryable: boolean) {
    super(message)
    this.retryable = retryable
  }
}

type SendCall = { channel: 'whatsapp' | 'telegram'; connectionId: string; target: string; content: string }
const sendLog: SendCall[] = []
let sendScript:
  | ((call: SendCall) => Promise<{ externalMessageId: string }> | { externalMessageId: string })
  | { error: MockSendError } = (call) => ({ externalMessageId: `ext-${call.channel}-${sendLog.length}` })

mock.module('@naia/session-host-client', () => ({
  sendWhatsAppMessage: async (connectionId: string, phone: string, content: string) => {
    const call: SendCall = { channel: 'whatsapp', connectionId, target: phone, content }
    sendLog.push(call)
    if ('error' in sendScript) throw sendScript.error
    return sendScript(call)
  },
  sendTelegramUserMessage: async (connectionId: string, target: string, content: string) => {
    const call: SendCall = { channel: 'telegram', connectionId, target, content }
    sendLog.push(call)
    if ('error' in sendScript) throw sendScript.error
    return sendScript(call)
  },
  isRetryableSendError: (err: unknown) => (err instanceof MockSendError ? err.retryable : true),
}))

type Db = typeof import('@naia/db')
type WhatsappHandler = typeof import('../src/handlers/whatsapp')
type PacerHandler = typeof import('../src/handlers/pacer')
type WebhookHandler = typeof import('../src/handlers/status-webhook')
type Recovery = typeof import('../src/recovery')
type QueuePkg = typeof import('@naia/queue')
type FailedLib = typeof import('../src/lib/outbound-failed')

let dbmod: Db
let wa: WhatsappHandler
let pacer: PacerHandler
let webhook: WebhookHandler
let recovery: Recovery
let queuepkg: QueuePkg
let failedLib: FailedLib

const { randomUUID } = await import('node:crypto')
const id = () => randomUUID().replace(/-/g, '').slice(0, 24)

async function provision(): Promise<{ workspaceId: string; connectionId: string; contactId: string }> {
  const { db, workspaces, entitlements, connections, contacts } = dbmod
  const workspaceId = `ws-${id()}`
  const connectionId = `conn-${id()}`
  const contactId = `ct-${id()}`
  await db.insert(workspaces).values({ id: workspaceId, name: 'WS Teste', slug: `ws-${id()}`, ownerUserId: 'user-1' })
  await db.insert(entitlements).values({ workspaceId, tier: 'starter', status: 'active', creditsBalance: 10_000 })
  await db.insert(connections).values({ id: connectionId, workspaceId, channel: 'whatsapp', name: 'WhatsApp Teste', status: 'active' })
  await db.insert(contacts).values({ id: contactId, workspaceId, name: 'Contato Teste', whatsappPhone: '5511999000001', isGroup: true, optInStatus: true })
  return { workspaceId, connectionId, contactId }
}

async function provisionCampaign(opts?: { status?: string }) {
  const base = await provision()
  const { db, campaigns, campaignConnections, campaignVariants, campaignRuns, campaignMessages } = dbmod
  const campaignId = `camp-${id()}`
  const runId = `run-${id()}`
  const messageId = `msg-${id()}`
  const variantId = `var-${id()}`
  await db.insert(campaigns).values({
    id: campaignId,
    workspaceId: base.workspaceId,
    name: 'Campanha Teste',
    channel: 'whatsapp',
    status: opts?.status ?? 'running',
    consentAt: new Date(),
  })
  await db.insert(campaignConnections).values({ campaignId, connectionId: base.connectionId, position: 0 })
  await db.insert(campaignVariants).values({ id: variantId, campaignId, position: 0, body: 'Olá {{name}}' })
  await db.insert(campaignRuns).values({
    id: runId,
    campaignId,
    runNumber: 1,
    status: 'running',
    scheduledFor: new Date(),
    startedAt: new Date(),
    totalContacts: 1,
  })
  await db.insert(campaignMessages).values({
    id: messageId,
    campaignId,
    runId,
    contactId: base.contactId,
    channel: 'whatsapp',
    status: 'queued',
    variantId,
  })
  return { ...base, campaignId, runId, messageId, variantId }
}

async function getMessage(messageId: string) {
  const [msg] = await dbmod.db
    .select()
    .from(dbmod.campaignMessages)
    .where((await import('drizzle-orm')).eq(dbmod.campaignMessages.id, messageId))
    .limit(1)
  return msg
}

async function getCampaign(campaignId: string) {
  const { eq } = await import('drizzle-orm')
  const [row] = await dbmod.db.select().from(dbmod.campaigns).where(eq(dbmod.campaigns.id, campaignId)).limit(1)
  return row
}

async function getCredits(workspaceId: string) {
  const { eq } = await import('drizzle-orm')
  const [row] = await dbmod.db
    .select({ creditsBalance: dbmod.entitlements.creditsBalance })
    .from(dbmod.entitlements)
    .where(eq(dbmod.entitlements.workspaceId, workspaceId))
    .limit(1)
  return row?.creditsBalance ?? null
}

async function getRun(runId: string) {
  const { eq } = await import('drizzle-orm')
  const [row] = await dbmod.db.select().from(dbmod.campaignRuns).where(eq(dbmod.campaignRuns.id, runId)).limit(1)
  return row
}

async function getEntitlements(workspaceId: string) {
  const { eq } = await import('drizzle-orm')
  const [row] = await dbmod.db.select().from(dbmod.entitlements).where(eq(dbmod.entitlements.workspaceId, workspaceId)).limit(1)
  return row
}

async function waitFor(cond: () => Promise<boolean>, timeoutMs = 8000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await cond()) return
    await Bun.sleep(50)
  }
  throw new Error('waitFor timeout')
}

beforeAll(async () => {
  dbmod = await import('@naia/db')
  queuepkg = await import('@naia/queue')
  wa = await import('../src/handlers/whatsapp')
  pacer = await import('../src/handlers/pacer')
  webhook = await import('../src/handlers/status-webhook')
  recovery = await import('../src/recovery')
  failedLib = await import('../src/lib/outbound-failed')

  try {
    const { sql } = await import('drizzle-orm')
    await dbmod.db.execute(sql`SELECT 1`)
    await queuepkg.getRedis().ping()
  } catch (err) {
    throw new Error(
      `[pipeline.test] Postgres/Redis de teste inalcançáveis (${process.env.NAIA_DATABASE_URL}) — ` +
      `suba com \`docker compose up -d postgres redis\` e crie o banco: ` +
      `\`docker exec naia-postgres-1 psql -U naia -c "CREATE DATABASE naia_test"\`. ` +
      `Erro original: ${err instanceof Error ? err.message : err}`,
    )
  }

  const { migrate } = await import('drizzle-orm/postgres-js/migrator')
  const migrationsFolder = new URL('../../../packages/db/drizzle', import.meta.url).pathname
  await migrate(dbmod.db, { migrationsFolder })
})

beforeEach(async () => {
  sendLog.length = 0
  sendScript = (call) => ({ externalMessageId: `ext-${call.channel}-${sendLog.length}` })
  const names = [
    queuepkg.QUEUES.WHATSAPP_OUTBOUND_BASE,
    queuepkg.QUEUES.TELEGRAM_OUTBOUND_BASE,
    queuepkg.QUEUES.STATUS_WEBHOOK,
    queuepkg.QUEUES.CAMPAIGN_PACER,
  ]
  for (const name of names) {
    await queuepkg.getQueue(name).obliterate({ force: true })
  }
  const { sql } = await import('drizzle-orm')
  const tables = (await dbmod.db.execute(sql`
    SELECT tablename AS name FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '__drizzle_migrations'
  `)) as unknown as Array<{ name: string }>
  if (tables.length > 0) {
    const quoted = tables.map((t) => `"${t.name.replaceAll('"', '""')}"`).join(', ')
    await dbmod.db.execute(sql.raw(`TRUNCATE TABLE ${quoted} CASCADE`))
  }
})

describe('send handler (WhatsApp, mocked provider)', () => {
  it('marks a queued message as sent and updates counters', async () => {
    const fx = await provisionCampaign()
    const { eq } = await import('drizzle-orm')
    await dbmod.db.update(dbmod.campaignMessages).set({ status: 'sending' })
      .where(eq(dbmod.campaignMessages.id, fx.messageId))

    await wa.handleWhatsAppSend({
      campaignId: fx.campaignId,
      campaignMessageId: fx.messageId,
      contactId: fx.contactId,
      channel: 'whatsapp',
      connectionId: fx.connectionId,
      content: 'Olá',
      kind: 'campaign',
      runId: fx.runId,
    })

    const msg = await getMessage(fx.messageId)
    expect(msg?.status).toBe('sent')
    expect(msg?.externalMessageId).toBeTruthy()
    expect(sendLog.length).toBe(1)
    expect(sendLog[0]!.target).toBe('5511999000001')
    expect((await getCampaign(fx.campaignId))?.sentCount).toBe(1)
    expect((await getRun(fx.runId))?.sentCount).toBe(1)
  })

  it('duplicate job does not resend or recount (status != sending → no-op)', async () => {
    const fx = await provisionCampaign()
    const { eq } = await import('drizzle-orm')
    await dbmod.db.update(dbmod.campaignMessages).set({ status: 'sending' })
      .where(eq(dbmod.campaignMessages.id, fx.messageId))

    const job = {
      campaignId: fx.campaignId,
      campaignMessageId: fx.messageId,
      contactId: fx.contactId,
      channel: 'whatsapp' as const,
      connectionId: fx.connectionId,
      content: 'Olá',
      kind: 'campaign' as const,
      runId: fx.runId,
    }
    await wa.handleWhatsAppSend(job)
    await wa.handleWhatsAppSend(job)

    expect(sendLog.length).toBe(1)
    expect((await getCampaign(fx.campaignId))?.sentCount).toBe(1)
    expect((await getRun(fx.runId))?.sentCount).toBe(1)
  })

  it('transient failure rethrows to BullMQ and does NOT mark failed', async () => {
    const fx = await provisionCampaign()
    const { eq } = await import('drizzle-orm')
    await dbmod.db.update(dbmod.campaignMessages).set({ status: 'sending' })
      .where(eq(dbmod.campaignMessages.id, fx.messageId))
    sendScript = { error: new MockSendError('Conexão WhatsApp não está conectada no momento.', true) }

    await expect(
      wa.handleWhatsAppSend({
        campaignId: fx.campaignId,
        campaignMessageId: fx.messageId,
        contactId: fx.contactId,
        channel: 'whatsapp',
        connectionId: fx.connectionId,
        content: 'Olá',
        kind: 'campaign',
        runId: fx.runId,
      }),
    ).rejects.toThrow()

    const msg = await getMessage(fx.messageId)
    expect(msg?.status).toBe('sending')
    expect((await getRun(fx.runId))?.failedCount).toBe(0)
  })

  it('permanent failure marks failed immediately, no retry', async () => {
    const fx = await provisionCampaign()
    const { eq } = await import('drizzle-orm')
    await dbmod.db.update(dbmod.campaignMessages).set({ status: 'sending' })
      .where(eq(dbmod.campaignMessages.id, fx.messageId))
    sendScript = { error: new MockSendError('PEER_ID_INVALID', false) }

    await wa.handleWhatsAppSend({
      campaignId: fx.campaignId,
      campaignMessageId: fx.messageId,
      contactId: fx.contactId,
      channel: 'whatsapp',
      connectionId: fx.connectionId,
      content: 'Olá',
      kind: 'campaign',
      runId: fx.runId,
    })

    const msg = await getMessage(fx.messageId)
    expect(msg?.status).toBe('failed')
    expect((await getRun(fx.runId))?.failedCount).toBe(1)
  })

  it('opt-out contact: permanent failure without calling the provider', async () => {
    const fx = await provisionCampaign()
    const { eq } = await import('drizzle-orm')
    await dbmod.db.update(dbmod.contacts).set({ optInStatus: false }).where(eq(dbmod.contacts.id, fx.contactId))
    await dbmod.db.update(dbmod.campaignMessages).set({ status: 'sending' })
      .where(eq(dbmod.campaignMessages.id, fx.messageId))

    await wa.handleWhatsAppSend({
      campaignId: fx.campaignId,
      campaignMessageId: fx.messageId,
      contactId: fx.contactId,
      channel: 'whatsapp',
      connectionId: fx.connectionId,
      content: 'Olá',
      kind: 'campaign',
      runId: fx.runId,
    })

    expect(sendLog.length).toBe(0)
    const msg = await getMessage(fx.messageId)
    expect(msg?.status).toBe('failed')
    expect(msg?.failureReason).toContain('Opt-out')
  })

  it('inactive connection: requeue with refund instead of sending or failing', async () => {
    const fx = await provisionCampaign()
    const { eq } = await import('drizzle-orm')
    await dbmod.db.update(dbmod.connections).set({ status: 'disconnected' }).where(eq(dbmod.connections.id, fx.connectionId))
    await dbmod.db.update(dbmod.campaignMessages).set({ status: 'sending' })
      .where(eq(dbmod.campaignMessages.id, fx.messageId))

    await wa.handleWhatsAppSend({
      campaignId: fx.campaignId,
      campaignMessageId: fx.messageId,
      contactId: fx.contactId,
      channel: 'whatsapp',
      connectionId: fx.connectionId,
      content: 'Olá',
      kind: 'campaign',
      runId: fx.runId,
    })

    expect(sendLog.length).toBe(0)
    expect((await getMessage(fx.messageId))?.status).toBe('queued')
    expect(await getCredits(fx.workspaceId)).toBe(10_001)
  })

  it('campaign paused mid-run: requeue with refund instead of sending', async () => {
    const fx = await provisionCampaign({ status: 'paused' })
    const { eq } = await import('drizzle-orm')
    await dbmod.db.update(dbmod.campaignMessages).set({ status: 'sending' })
      .where(eq(dbmod.campaignMessages.id, fx.messageId))

    await wa.handleWhatsAppSend({
      campaignId: fx.campaignId,
      campaignMessageId: fx.messageId,
      contactId: fx.contactId,
      channel: 'whatsapp',
      connectionId: fx.connectionId,
      content: 'Olá',
      kind: 'campaign',
      runId: fx.runId,
    })

    expect(sendLog.length).toBe(0)
    expect((await getMessage(fx.messageId))?.status).toBe('queued')
    expect(await getCredits(fx.workspaceId)).toBe(10_001)
  })

  it('campaign paused: an already persisted send (sent) is not reverted', async () => {
    const fx = await provisionCampaign({ status: 'paused' })
    const { eq } = await import('drizzle-orm')
    await dbmod.db.update(dbmod.campaignMessages)
      .set({ status: 'sent', sentAt: new Date() })
      .where(eq(dbmod.campaignMessages.id, fx.messageId))

    await wa.handleWhatsAppSend({
      campaignId: fx.campaignId,
      campaignMessageId: fx.messageId,
      contactId: fx.contactId,
      channel: 'whatsapp',
      connectionId: fx.connectionId,
      content: 'Olá',
      kind: 'campaign',
      runId: fx.runId,
    })

    expect((await getMessage(fx.messageId))?.status).toBe('sent')
    expect(await getCredits(fx.workspaceId)).toBe(10_000)
  })

  it('conditional markFailed never downgrades an already sent message', async () => {
    const fx = await provisionCampaign()
    const { eq } = await import('drizzle-orm')
    await dbmod.db.update(dbmod.campaignMessages).set({ status: 'sent', sentAt: new Date() })
      .where(eq(dbmod.campaignMessages.id, fx.messageId))

    await wa.markFailed(fx.messageId, fx.campaignId, 'falha tardia', fx.runId)

    const msg = await getMessage(fx.messageId)
    expect(msg?.status).toBe('sent')
    expect((await getCampaign(fx.campaignId))?.failedCount).toBe(0)
  })
})

describe('pacer', () => {
  it('atomic token claim: two parallel pacers → only one send enqueued', async () => {
    const fx = await provisionCampaign()
    const { eq } = await import('drizzle-orm')
    await dbmod.db.update(dbmod.campaignRuns).set({ nextPacerAt: new Date() })
      .where(eq(dbmod.campaignRuns.id, fx.runId))

    const job = { runId: fx.runId, campaignId: fx.campaignId, sentInBurst: 0 }
    await Promise.all([pacer.handlePacerStep(job), pacer.handlePacerStep(job)])

    const [sending] = await dbmod.db
      .select({ count: (await import('drizzle-orm')).sql<number>`count(*)::int` })
      .from(dbmod.campaignMessages)
      .where((await import('drizzle-orm')).eq(dbmod.campaignMessages.runId, fx.runId))
    const sendingCount = sending?.count
    const outbound = queuepkg.getQueue(queuepkg.QUEUES.WHATSAPP_OUTBOUND_BASE)
    const counts = await outbound.getJobCounts('waiting', 'delayed', 'active')
    const totalOutbound = counts.waiting + counts.delayed + counts.active

    const msg = await getMessage(fx.messageId)
    expect(msg?.status).toBe('sending')
    expect(totalOutbound).toBe(1)
    void sendingCount
  })

  it('job without a token (next_pacer_at NULL) is discarded', async () => {
    const fx = await provisionCampaign()
    await pacer.handlePacerStep({ runId: fx.runId, campaignId: fx.campaignId, sentInBurst: 0 })

    const msg = await getMessage(fx.messageId)
    expect(msg?.status).toBe('queued')
    const outbound = queuepkg.getQueue(queuepkg.QUEUES.WHATSAPP_OUTBOUND_BASE)
    const counts = await outbound.getJobCounts('waiting', 'delayed')
    expect(counts.waiting + counts.delayed).toBe(0)
  })

  it('paused run: token consumed, no rescheduling', async () => {
    const fx = await provisionCampaign()
    const { eq } = await import('drizzle-orm')
    await dbmod.db.update(dbmod.campaignRuns).set({ status: 'paused', nextPacerAt: new Date() })
      .where(eq(dbmod.campaignRuns.id, fx.runId))

    await pacer.handlePacerStep({ runId: fx.runId, campaignId: fx.campaignId, sentInBurst: 0 })

    const msg = await getMessage(fx.messageId)
    expect(msg?.status).toBe('queued')
    const run = await getRun(fx.runId)
    expect(run?.nextPacerAt).toBeNull()
  })

  it('jobId dedup: re-add while the job is alive does not duplicate', async () => {
    const queue = queuepkg.getQueue(queuepkg.QUEUES.WHATSAPP_OUTBOUND_BASE)
    const payload = {
      campaignId: 'c1', campaignMessageId: 'm1', contactId: 'ct1',
      channel: 'whatsapp' as const, connectionId: 'conn1', content: 'x', kind: 'campaign' as const,
    }
    const first = await queue.add('send', payload, { jobId: 'send-m1', attempts: 1, removeOnFail: true })
    const second = await queue.add('send', payload, { jobId: 'send-m1', attempts: 1, removeOnFail: true })
    expect(second.id).toBe(first.id)
    const counts = await queue.getJobCounts('waiting')
    expect(counts.waiting).toBe(1)
  })
})

describe('status-webhook', () => {
  it('duplicate delivered counts only once', async () => {
    const fx = await provisionCampaign()
    const { eq } = await import('drizzle-orm')
    const extId = `ext-${id()}` // único por teste — o lookup por external_message_id não pode colidir com restos de runs anteriores
    await dbmod.db.update(dbmod.campaignMessages)
      .set({ status: 'sent', externalMessageId: extId, sentAt: new Date() })
      .where(eq(dbmod.campaignMessages.id, fx.messageId))

    const job = { source: 'whatsapp' as const, connectionId: fx.connectionId, externalMessageId: extId, status: 'delivered' as const, timestamp: new Date().toISOString() }
    await Promise.all([webhook.handleStatusWebhook(job), webhook.handleStatusWebhook(job)])
    await webhook.handleStatusWebhook(job)

    const msg = await getMessage(fx.messageId)
    expect(msg?.status).toBe('delivered')
    expect(msg?.deliveredAt).toBeTruthy()
    expect((await getCampaign(fx.campaignId))?.deliveredCount).toBe(1)
    expect((await getRun(fx.runId))?.deliveredCount).toBe(1)
  })

  it('read without a prior delivered counts both milestones', async () => {
    const fx = await provisionCampaign()
    const { eq } = await import('drizzle-orm')
    const extId = `ext-${id()}`
    await dbmod.db.update(dbmod.campaignMessages)
      .set({ status: 'sent', externalMessageId: extId, sentAt: new Date() })
      .where(eq(dbmod.campaignMessages.id, fx.messageId))

    await webhook.handleStatusWebhook({
      source: 'whatsapp', connectionId: fx.connectionId, externalMessageId: extId,
      status: 'read', timestamp: new Date().toISOString(),
    })

    const camp = await getCampaign(fx.campaignId)
    expect(camp?.deliveredCount).toBe(1)
    expect(camp?.readCount).toBe(1)
    expect((await getMessage(fx.messageId))?.status).toBe('read')
  })

  it('failed webhook: single transition even with concurrent events', async () => {
    const fx = await provisionCampaign()
    const { eq } = await import('drizzle-orm')
    const extId = `ext-${id()}`
    await dbmod.db.update(dbmod.campaignMessages)
      .set({ status: 'sent', externalMessageId: extId, sentAt: new Date() })
      .where(eq(dbmod.campaignMessages.id, fx.messageId))

    const job = { source: 'whatsapp' as const, connectionId: fx.connectionId, externalMessageId: extId, status: 'failed' as const, reason: 'bad number', timestamp: new Date().toISOString() }
    await Promise.all([webhook.handleStatusWebhook(job), webhook.handleStatusWebhook(job)])

    expect((await getMessage(fx.messageId))?.status).toBe('failed')
    expect((await getRun(fx.runId))?.failedCount).toBe(1)
  })

  it('failed is terminal: a late delivered/read does not revive the message', async () => {
    const fx = await provisionCampaign()
    const { eq } = await import('drizzle-orm')
    const extId = `ext-${id()}`
    await dbmod.db.update(dbmod.campaignMessages)
      .set({ status: 'failed', externalMessageId: extId, failureReason: 'bad number' })
      .where(eq(dbmod.campaignMessages.id, fx.messageId))

    await webhook.handleStatusWebhook({
      source: 'whatsapp', connectionId: fx.connectionId, externalMessageId: extId,
      status: 'delivered', timestamp: new Date().toISOString(),
    })
    await webhook.handleStatusWebhook({
      source: 'whatsapp', connectionId: fx.connectionId, externalMessageId: extId,
      status: 'read', timestamp: new Date().toISOString(),
    })

    expect((await getMessage(fx.messageId))?.status).toBe('failed')
    const camp = await getCampaign(fx.campaignId)
    expect(camp?.deliveredCount).toBe(0)
    expect(camp?.readCount).toBe(0)
  })

  it('a late failed does not downgrade delivered or read', async () => {
    const fx = await provisionCampaign()
    const { eq } = await import('drizzle-orm')
    const extId = `ext-${id()}`
    await dbmod.db.update(dbmod.campaignMessages)
      .set({ status: 'read', externalMessageId: extId, sentAt: new Date(), deliveredAt: new Date(), readAt: new Date() })
      .where(eq(dbmod.campaignMessages.id, fx.messageId))

    await webhook.handleStatusWebhook({
      source: 'whatsapp', connectionId: fx.connectionId, externalMessageId: extId,
      status: 'failed', reason: 'late failure', timestamp: new Date().toISOString(),
    })

    expect((await getMessage(fx.messageId))?.status).toBe('read')
    expect((await getRun(fx.runId))?.failedCount).toBe(0)
  })
})

describe('recovery', () => {
  it('a stuck sending message (>10min) returns to queued and refunds the credit', async () => {
    const fx = await provisionCampaign()
    const { eq } = await import('drizzle-orm')
    const stale = new Date(Date.now() - 20 * 60_000)
    await dbmod.db.update(dbmod.campaignMessages).set({ status: 'sending', updatedAt: stale })
      .where(eq(dbmod.campaignMessages.id, fx.messageId))
    const before = (await getEntitlements(fx.workspaceId))!.creditsBalance

    await recovery.resetStaleSending()

    const msg = await getMessage(fx.messageId)
    expect(msg?.status).toBe('queued')
    expect((await getEntitlements(fx.workspaceId))!.creditsBalance).toBe(before + 1)
  })

  it('a recent sending message is not reset (a legitimate send is in progress)', async () => {
    const fx = await provisionCampaign()
    const { eq } = await import('drizzle-orm')
    await dbmod.db.update(dbmod.campaignMessages).set({ status: 'sending', updatedAt: new Date() })
      .where(eq(dbmod.campaignMessages.id, fx.messageId))

    await recovery.resetStaleSending()
    expect((await getMessage(fx.messageId))?.status).toBe('sending')
  })

  it('a running run whose pacer expired >3min ago is re-enqueued', async () => {
    const fx = await provisionCampaign()
    const { eq } = await import('drizzle-orm')
    const past = new Date(Date.now() - 5 * 60_000)
    await dbmod.db.update(dbmod.campaignRuns).set({ nextPacerAt: past })
      .where(eq(dbmod.campaignRuns.id, fx.runId))

    await recovery.resurrectLostPacers()

    const pacerQueue = queuepkg.getQueue(queuepkg.QUEUES.CAMPAIGN_PACER)
    const counts = await pacerQueue.getJobCounts('waiting', 'delayed')
    expect(counts.waiting + counts.delayed).toBe(1)
    const run = await getRun(fx.runId)
    expect(run?.nextPacerAt).toBeTruthy()
  })

  it('a running run with NULL token and stale updated_at is also resurrected', async () => {
    const fx = await provisionCampaign()
    const { eq } = await import('drizzle-orm')
    const stale = new Date(Date.now() - 10 * 60_000)
    await dbmod.db.update(dbmod.campaignRuns).set({ nextPacerAt: null, updatedAt: stale })
      .where(eq(dbmod.campaignRuns.id, fx.runId))

    await recovery.resurrectLostPacers()
    const run = await getRun(fx.runId)
    expect(run?.nextPacerAt).toBeTruthy()
  })

  it('a running run with a fresh NULL token (pacer in flight) is NOT resurrected', async () => {
    const fx = await provisionCampaign()
    const { eq } = await import('drizzle-orm')
    await dbmod.db.update(dbmod.campaignRuns).set({ nextPacerAt: null, updatedAt: new Date() })
      .where(eq(dbmod.campaignRuns.id, fx.runId))

    await recovery.resurrectLostPacers()
    const run = await getRun(fx.runId)
    expect(run?.nextPacerAt).toBeNull()
  })
})

describe('scheduler', () => {
  it('two concurrent ticks do not start the same run twice', async () => {
    const fx = await provisionCampaign()
    const { eq } = await import('drizzle-orm')
    await dbmod.db.update(dbmod.campaigns)
      .set({ status: 'scheduled', nextRunAt: new Date(Date.now() - 60_000) })
      .where(eq(dbmod.campaigns.id, fx.campaignId))

    const scheduler = await import('../src/scheduler')
    const calls: string[] = []
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/internal/campaigns/')) {
        calls.push(url)
        return new Response(JSON.stringify({ started: true }), { status: 200 })
      }
      return realFetch(input as never, init)
    }) as typeof fetch

    try {
      await Promise.all([scheduler.schedulerTick(), scheduler.schedulerTick()])
    } finally {
      globalThis.fetch = realFetch
    }

    expect(calls.filter((u) => u.includes(`/campaigns/${fx.campaignId}/start-run`)).length).toBe(1)
    expect((await getCampaign(fx.campaignId))?.nextRunAt).toBeNull()
  })

  it('API failure restores next_run_at for the next tick', async () => {
    const fx = await provisionCampaign()
    const { eq } = await import('drizzle-orm')
    await dbmod.db.update(dbmod.campaigns)
      .set({ status: 'scheduled', nextRunAt: new Date(Date.now() - 60_000) })
      .where(eq(dbmod.campaigns.id, fx.campaignId))

    const scheduler = await import('../src/scheduler')
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response('boom', { status: 500 })) as typeof fetch
    try {
      await scheduler.schedulerTick()
    } finally {
      globalThis.fetch = realFetch
    }

    const camp = await getCampaign(fx.campaignId)
    expect(camp?.nextRunAt).toBeTruthy()
    expect(camp?.status).toBe('scheduled')
  })
})

describe('worker BullMQ end-to-end', () => {
  it('transient retry: fails 2x, exhausts attempts and marks failed once', async () => {
    const fx = await provisionCampaign()
    const { eq } = await import('drizzle-orm')
    await dbmod.db.update(dbmod.campaignMessages).set({ status: 'sending' })
      .where(eq(dbmod.campaignMessages.id, fx.messageId))
    sendScript = { error: new MockSendError('Conexão WhatsApp não está conectada no momento.', true) }

    const worker = queuepkg.createWorker<import('@naia/schemas').SendMessageJob>(
      queuepkg.QUEUES.WHATSAPP_OUTBOUND_BASE,
      async (job) => wa.handleWhatsAppSend(job.data),
      { concurrency: 1 },
    )
    worker.on('failed', failedLib.createOutboundFailedHandler(queuepkg.QUEUES.WHATSAPP_OUTBOUND_BASE, 'whatsapp'))
    try {
      const queue = queuepkg.getQueue<import('@naia/schemas').SendMessageJob>(queuepkg.QUEUES.WHATSAPP_OUTBOUND_BASE)
      await queue.add('send', {
        campaignId: fx.campaignId,
        campaignMessageId: fx.messageId,
        contactId: fx.contactId,
        channel: 'whatsapp',
        connectionId: fx.connectionId,
        content: 'Olá',
        kind: 'campaign',
        runId: fx.runId,
      }, { jobId: `send-${fx.messageId}`, attempts: 3, backoff: { type: 'fixed', delay: 50 }, removeOnComplete: true, removeOnFail: true })

      await waitFor(async () => (await getRun(fx.runId))?.failedCount === 1)
      expect((await getMessage(fx.messageId))?.status).toBe('failed')
      expect(sendLog.length).toBe(3)
    } finally {
      await worker.close()
    }
  }, 15_000)

  it('jobId dedup: re-add with the same id during processing does not duplicate the send', async () => {
    const fx = await provisionCampaign()
    const { eq } = await import('drizzle-orm')
    await dbmod.db.update(dbmod.campaignMessages).set({ status: 'sending' })
      .where(eq(dbmod.campaignMessages.id, fx.messageId))

    let resolveSend!: (v: { externalMessageId: string }) => void
    const gate = new Promise<{ externalMessageId: string }>((res) => { resolveSend = res })
    sendScript = () => gate

    const queue = queuepkg.getQueue<import('@naia/schemas').SendMessageJob>(queuepkg.QUEUES.WHATSAPP_OUTBOUND_BASE)
    const payload = {
      campaignId: fx.campaignId,
      campaignMessageId: fx.messageId,
      contactId: fx.contactId,
      channel: 'whatsapp' as const,
      connectionId: fx.connectionId,
      content: 'Olá',
      kind: 'campaign' as const,
      runId: fx.runId,
    }
    await queue.add('send', payload, { jobId: `send-${fx.messageId}`, attempts: 1, removeOnComplete: true })
    const readd = await queue.add('send', payload, { jobId: `send-${fx.messageId}`, attempts: 1, removeOnComplete: true })

    const worker = queuepkg.createWorker<import('@naia/schemas').SendMessageJob>(
      queuepkg.QUEUES.WHATSAPP_OUTBOUND_BASE,
      async (job) => wa.handleWhatsAppSend(job.data),
      { concurrency: 4 },
    )
    try {
      await Bun.sleep(150)
      const readdDuringProcessing = await queue.add('send', payload, { jobId: `send-${fx.messageId}`, attempts: 1, removeOnComplete: true })
      resolveSend({ externalMessageId: 'ext-dedup' })
      await waitFor(async () => (await getMessage(fx.messageId))?.status === 'sent')

      expect(readd.id).toBe(`send-${fx.messageId}`)
      expect(readdDuringProcessing.id).toBe(`send-${fx.messageId}`)
      expect(sendLog.length).toBe(1)
      expect((await getCampaign(fx.campaignId))?.sentCount).toBe(1)
    } finally {
      await worker.close()
    }
  }, 15_000)
})
