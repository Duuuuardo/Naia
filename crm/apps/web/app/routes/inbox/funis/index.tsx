import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { KanbanSquare } from 'lucide-react'
import { InboxShell } from '../../../components/inbox-shell'
import { Button, EmptyState, Modal } from '../../../components/ui'
import { createPipeline, fetchPipelines, getInboxAgent } from '../../../lib/inbox-session'
import { createHeadConfig } from '../../../lib/seo'

export const Route = createFileRoute('/inbox/funis/')({
  head: () => createHeadConfig('Funis — Naia CRM'),
  beforeLoad: async () => {
    const agent = await getInboxAgent()
    if (!agent) throw redirect({ to: '/inbox/login' })
  },
  loader: async () => {
    const agent = (await getInboxAgent())!
    const pipelines = await fetchPipelines()
    // Com funis existentes, /inbox/funis é só um atalho para o primeiro.
    if (pipelines.length > 0) {
      throw redirect({ to: '/inbox/funis/$pipelineId', params: { pipelineId: pipelines[0].id } })
    }
    return { agent }
  },
  component: FunisIndex,
})

function FunisIndex() {
  const { agent } = Route.useLoaderData()
  const router = useRouter()
  const [modalOpen, setModalOpen] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    const pipeline = await createPipeline({ data: { name: name.trim() } })
    setSaving(false)
    if (pipeline) {
      router.navigate({ to: '/inbox/funis/$pipelineId', params: { pipelineId: pipeline.id } })
    }
  }

  return (
    <InboxShell agentName={agent.name} role={agent.role}>
      <div className="grid h-full place-items-center bg-neutral-0 p-6">
        <EmptyState
          icon={KanbanSquare}
          title="Nenhum funil ainda."
          description={
            agent.role === 'superadmin'
              ? 'Crie seu primeiro funil de vendas para acompanhar os deals do time.'
              : 'Peça a um superadmin para criar o primeiro funil de vendas.'
          }
          action={
            agent.role === 'superadmin' ? (
              <Button size="sm" onClick={() => setModalOpen(true)}>
                Criar funil
              </Button>
            ) : undefined
          }
        />
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Criar funil"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button size="sm" loading={saving} onClick={handleCreate} disabled={!name.trim()}>
              Criar funil
            </Button>
          </>
        }
      >
        <form onSubmit={handleCreate} className="space-y-2">
          <label htmlFor="pipeline-name" className="block text-sm font-medium text-dark-800">
            Nome do funil
          </label>
          <input
            id="pipeline-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Vendas WhatsApp"
            autoFocus
            className="h-10 w-full rounded-md border border-neutral-300 bg-neutral-0 px-3 text-sm text-dark-800 placeholder:text-neutral-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </form>
      </Modal>
    </InboxShell>
  )
}
