import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { Bot, Pause, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { InboxShell } from '../../../components/inbox-shell'
import { Button, Card, EmptyState, ErrorNote, Modal, PageHeader } from '../../../components/ui'
import {
  createBot,
  deleteBot,
  fetchBots,
  getInboxAgent,
  pauseBot,
  publishBot,
  type BotListItem,
  type BotStatus,
} from '../../../lib/inbox-session'
import { createHeadConfig } from '../../../lib/seo'

export const Route = createFileRoute('/inbox/bot/')({
  head: () => createHeadConfig('Bot — Naia CRM'),
  beforeLoad: async () => {
    const agent = await getInboxAgent()
    if (!agent) throw redirect({ to: '/inbox/login' })
  },
  loader: async () => {
    const agent = (await getInboxAgent())!
    const bots = await fetchBots()
    return { agent, bots }
  },
  component: BotListPage,
})

const statusMeta: Record<BotStatus, { label: string; className: string }> = {
  draft: { label: 'Rascunho', className: 'bg-neutral-100 text-neutral-500' },
  active: { label: 'Ativo', className: 'bg-success-500/10 text-success-500' },
  paused: { label: 'Pausado', className: 'bg-warning-500/10 text-warning-600' },
}

function triggerLabel(bot: BotListItem): string {
  if (bot.triggerKind === 'new_conversation') return 'Nova conversa'
  if (bot.triggerKind === 'always') return 'Sempre'
  return bot.triggerKeywords.length > 0
    ? `Palavra-chave: ${bot.triggerKeywords.join(', ')}`
    : 'Palavra-chave'
}

function BotListPage() {
  const { agent, bots: initialBots } = Route.useLoaderData()
  const router = useRouter()
  const [bots, setBots] = useState<BotListItem[]>(initialBots)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<BotListItem | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function handleCreate() {
    setCreating(true)
    setError(null)
    const bot = await createBot({
      data: {
        name: 'Novo fluxo',
        triggerKind: 'new_conversation',
        definition: {
          nodes: [{ id: 'start', kind: 'start', position: { x: 0, y: 0 }, data: {} }],
          edges: [],
        },
      },
    })
    if (!bot) {
      setCreating(false)
      setError('Não foi possível criar o fluxo. Tente novamente.')
      return
    }
    router.navigate({ to: '/inbox/bot/$botId', params: { botId: bot.id } })
  }

  async function handlePublish(bot: BotListItem) {
    setBusyId(bot.id)
    setError(null)
    const updated = await publishBot({ data: { botId: bot.id } })
    setBusyId(null)
    if (!updated) {
      setError(
        'Não foi possível publicar o fluxo. Verifique o limite de bots ativos do seu plano ou se você tem permissão de superadmin.',
      )
      return
    }
    setBots((list) => list.map((b) => (b.id === bot.id ? updated : b)))
  }

  async function handlePause(bot: BotListItem) {
    setBusyId(bot.id)
    setError(null)
    const updated = await pauseBot({ data: { botId: bot.id } })
    setBusyId(null)
    if (!updated) {
      setError('Não foi possível pausar o fluxo. Tente novamente.')
      return
    }
    setBots((list) => list.map((b) => (b.id === bot.id ? updated : b)))
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setError(null)
    await deleteBot({ data: { botId: deleteTarget.id } })
    setBots((list) => list.filter((b) => b.id !== deleteTarget.id))
    setDeleting(false)
    setDeleteTarget(null)
  }

  return (
    <InboxShell agentName={agent.name} role={agent.role}>
      <div className="h-full overflow-y-auto bg-neutral-50">
        <div className="mx-auto w-full max-w-4xl p-4 md:p-8">
          <PageHeader
            title="Bot"
            subtitle="Fluxos de chatbot que respondem conversas automaticamente."
          >
            {agent.role === 'superadmin' && (
              <Button icon={Plus} loading={creating} onClick={handleCreate}>
                Novo fluxo
              </Button>
            )}
          </PageHeader>

          {error && (
            <div className="mb-4">
              <ErrorNote>{error}</ErrorNote>
            </div>
          )}

          {bots.length === 0 ? (
            <EmptyState
              icon={Bot}
              title="Nenhum fluxo criado"
              description="Crie um fluxo para o bot responder conversas automaticamente."
              action={
                agent.role === 'superadmin' ? (
                  <Button icon={Plus} loading={creating} onClick={handleCreate}>
                    Novo fluxo
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {bots.map((bot) => {
                const status = statusMeta[bot.status]
                return (
                  <Card key={bot.id} className="flex flex-col gap-3 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-semibold text-dark-800">{bot.name}</p>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${status.className}`}
                      >
                        {status.label}
                      </span>
                    </div>
                    <p className="truncate text-xs text-neutral-400">{triggerLabel(bot)}</p>
                    <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-neutral-100 pt-3">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={Pencil}
                        onClick={() =>
                          router.navigate({ to: '/inbox/bot/$botId', params: { botId: bot.id } })
                        }
                      >
                        Editar
                      </Button>
                      {bot.status !== 'active' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={Play}
                          loading={busyId === bot.id}
                          onClick={() => handlePublish(bot)}
                        >
                          Publicar
                        </Button>
                      )}
                      {bot.status === 'active' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={Pause}
                          loading={busyId === bot.id}
                          onClick={() => handlePause(bot)}
                        >
                          Pausar
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="danger"
                        icon={Trash2}
                        onClick={() => setDeleteTarget(bot)}
                      >
                        Excluir
                      </Button>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Excluir fluxo"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancelar
            </Button>
            <Button variant="danger" icon={Trash2} loading={deleting} onClick={handleDelete}>
              Excluir
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-500">
          Tem certeza que deseja excluir o fluxo{' '}
          <span className="font-semibold text-dark-800">{deleteTarget?.name}</span>? Essa ação não
          pode ser desfeita.
        </p>
      </Modal>
    </InboxShell>
  )
}
