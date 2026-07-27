import { createFileRoute, redirect, Link, useRouter } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ArrowLeft,
  ArrowRight,
  KanbanSquare,
  MoreVertical,
  Pencil,
  Plus,
  Settings2,
  Trash2,
  Trophy,
  XCircle,
} from 'lucide-react'
import { InboxShell } from '../../../components/inbox-shell'
import { Badge, Button, EmptyState, ErrorNote, Modal, getInitials } from '../../../components/ui'
import {
  createDeal,
  createPipeline,
  createStage,
  deleteDeal,
  deletePipeline,
  deleteStage,
  fetchAgentsAdmin,
  fetchContacts,
  fetchConversations,
  fetchPipelineDeals,
  fetchPipelines,
  fetchQueues,
  getInboxAgent,
  moveDeal,
  moveStage,
  updateDeal,
  updatePipeline,
  updateStage,
  type ContactListItem,
  type ConversationListItem,
  type KanbanDealItem,
  type PipelineItem,
  type PipelineRow,
  type PipelineStageItem,
  type QueueItem,
} from '../../../lib/inbox-session'
import { useInboxSocket } from '../../../lib/use-inbox-socket'
import { createHeadConfig } from '../../../lib/seo'

type StageBoard = PipelineStageItem & { deals: KanbanDealItem[] }
type AgentOption = { id: string; name: string }
type StageKind = 'open' | 'won' | 'lost'

export const Route = createFileRoute('/inbox/funis/$pipelineId')({
  head: () => createHeadConfig('Funis — Naia CRM'),
  beforeLoad: async () => {
    const agent = await getInboxAgent()
    if (!agent) throw redirect({ to: '/inbox/login' })
  },
  loader: async ({ params }) => {
    const agent = (await getInboxAgent())!
    const [pipelines, board, queues] = await Promise.all([
      fetchPipelines(),
      fetchPipelineDeals({ data: { pipelineId: params.pipelineId } }),
      fetchQueues(),
    ])
    if (!board.pipeline) throw redirect({ to: '/inbox/funis' })
    // Responsáveis: rota admin (superadmin) com fallback nos membros das filas.
    const adminAgents = await fetchAgentsAdmin().catch(() => [])
    let agents: AgentOption[] = adminAgents.map((a) => ({ id: a.id, name: a.name }))
    if (agents.length === 0) {
      const seen = new Map<string, string>()
      for (const queue of queues) {
        for (const member of queue.members) seen.set(member.agentId, member.agentName)
      }
      agents = [...seen.entries()].map(([id, name]) => ({ id, name }))
    }
    return { agent, pipelines, pipeline: board.pipeline, stages: board.stages, queues, agents }
  },
  component: FunisBoard,
})

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const formatCents = (cents: number) => brl.format(cents / 100)

const stageKindLabel: Record<StageKind, string> = { open: 'Em aberto', won: 'Ganho', lost: 'Perdido' }

function FunisBoard() {
  const { pipelineId } = Route.useParams()
  const initial = Route.useLoaderData()
  const router = useRouter()
  const { agent, queues, agents } = initial
  const isSuperadmin = agent.role === 'superadmin'

  const [stages, setStages] = useState<StageBoard[]>(initial.stages)
  const [pipelines, setPipelines] = useState<PipelineItem[]>(initial.pipelines)
  const [activeDeal, setActiveDeal] = useState<KanbanDealItem | null>(null)
  const [dealModal, setDealModal] = useState<
    { kind: 'create'; stageId: string } | { kind: 'edit'; deal: KanbanDealItem } | null
  >(null)
  const [pipelineModal, setPipelineModal] = useState<'create' | 'manage' | null>(null)
  const [stageModal, setStageModal] = useState<{ kind: 'create' } | { kind: 'edit'; stage: StageBoard } | null>(null)

  useEffect(() => {
    setStages(initial.stages)
    setPipelines(initial.pipelines)
  }, [initial])

  async function reload() {
    const board = await fetchPipelineDeals({ data: { pipelineId } })
    if (board.pipeline) setStages(board.stages)
  }

  async function reloadPipelines() {
    setPipelines(await fetchPipelines())
  }

  // Tempo real: deals e funis atualizados por outros agentes.
  useInboxSocket((event) => {
    if (
      event.type === 'deal:new' ||
      event.type === 'deal:moved' ||
      event.type === 'deal:updated' ||
      event.type === 'pipeline:updated'
    ) {
      reload()
      if (event.type === 'pipeline:updated') reloadPipelines()
    }
  })

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id)
    const deal = stages.flatMap((s) => s.deals).find((d) => d.id === id)
    setActiveDeal(deal ?? null)
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveDeal(null)
    const { active, over } = event
    if (!over) return
    const dealId = String(active.id)
    const overId = String(over.id)
    if (dealId === overId) return

    const fromStage = stages.find((s) => s.deals.some((d) => d.id === dealId))
    const deal = fromStage?.deals.find((d) => d.id === dealId)
    if (!fromStage || !deal) return

    // Alvo: a coluna (droppable) ou um card dentro dela (sortable).
    const overStage = stages.find((s) => s.id === overId)
    let toStageId: string
    let toIndex: number
    if (overStage) {
      toStageId = overStage.id
      toIndex = overStage.deals.filter((d) => d.id !== dealId).length
    } else {
      const targetStage = stages.find((s) => s.deals.some((d) => d.id === overId))
      if (!targetStage) return
      toStageId = targetStage.id
      toIndex = targetStage.deals.findIndex((d) => d.id === overId)
      if (toStageId === fromStage.id && toIndex === fromStage.deals.findIndex((d) => d.id === dealId)) return
    }

    // Otimista: remove e reinsere na posição; rollback recarregando em erro.
    const prevStages = stages
    const next = stages.map((s) => ({ ...s, deals: s.deals.filter((d) => d.id !== dealId) }))
    const target = next.find((s) => s.id === toStageId)!
    const insertAt = Math.min(toIndex, target.deals.length)
    target.deals.splice(insertAt, 0, { ...deal, stageId: toStageId })
    setStages([...next])

    const moved = await moveDeal({ data: { dealId, stageId: toStageId, position: insertAt } })
    if (!moved) setStages(prevStages)
  }

  const wonStage = stages.find((s) => s.kind === 'won')
  const lostStage = stages.find((s) => s.kind === 'lost')

  return (
    <InboxShell agentName={agent.name} role={agent.role}>
      <div className="flex h-full flex-col bg-neutral-0">
        {/* Seletor de funil + ações de superadmin */}
        <div className="flex items-center gap-2 overflow-x-auto border-b border-neutral-100 p-2">
          <div className="flex min-w-0 flex-1 gap-1">
            {pipelines.map((p) => (
              <Link
                key={p.id}
                to="/inbox/funis/$pipelineId"
                params={{ pipelineId: p.id }}
                className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  p.id === pipelineId ? 'bg-brand-50 text-brand-600' : 'text-neutral-500 hover:bg-neutral-100'
                }`}
              >
                {p.name}
              </Link>
            ))}
          </div>
          {isSuperadmin && (
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setPipelineModal('manage')}
                aria-label="Gerenciar funil"
                className="grid size-8 place-items-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-dark-800"
              >
                <Settings2 size={16} aria-hidden="true" />
              </button>
              <Button variant="secondary" size="sm" icon={Plus} onClick={() => setPipelineModal('create')}>
                Novo funil
              </Button>
            </div>
          )}
        </div>

        {/* Kanban: colunas em scroll horizontal */}
        {stages.length === 0 ? (
          <div className="grid flex-1 place-items-center p-6">
            <EmptyState
              icon={KanbanSquare}
              title="Nenhum estágio ainda."
              description={
                isSuperadmin
                  ? 'Adicione o primeiro estágio para começar a montar o funil.'
                  : 'Peça a um superadmin para configurar os estágios deste funil.'
              }
              action={
                isSuperadmin ? (
                  <Button size="sm" icon={Plus} onClick={() => setStageModal({ kind: 'create' })}>
                    Adicionar estágio
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <div className="flex-1 overflow-x-auto overflow-y-hidden">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={() => setActiveDeal(null)}
            >
              <div className="flex h-full items-start gap-3 p-4">
                {stages.map((stage, index) => (
                  <StageColumn
                    key={stage.id}
                    stage={stage}
                    isSuperadmin={isSuperadmin}
                    canMoveLeft={index > 0}
                    canMoveRight={index < stages.length - 1}
                    onNewDeal={() => setDealModal({ kind: 'create', stageId: stage.id })}
                    onOpenDeal={(deal) => setDealModal({ kind: 'edit', deal })}
                    onEditStage={() => setStageModal({ kind: 'edit', stage })}
                    onMoveStage={async (direction) => {
                      await moveStage({ data: { stageId: stage.id, direction } })
                      reload()
                    }}
                    onDeleteStage={async () => {
                      await deleteStage({ data: { stageId: stage.id } })
                      reload()
                    }}
                  />
                ))}
                {isSuperadmin && (
                  <button
                    type="button"
                    onClick={() => setStageModal({ kind: 'create' })}
                    className="flex w-72 shrink-0 items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-300 px-4 py-3 text-sm font-semibold text-neutral-500 transition-colors hover:border-brand-300 hover:text-brand-600"
                  >
                    <Plus size={16} aria-hidden="true" />
                    Adicionar estágio
                  </button>
                )}
              </div>
              <DragOverlay>{activeDeal ? <DealCardContent deal={activeDeal} dragging /> : null}</DragOverlay>
            </DndContext>
          </div>
        )}
      </div>

      {dealModal && (
        <DealModal
          key={dealModal.kind === 'edit' ? dealModal.deal.id : `new-${dealModal.stageId}`}
          mode={dealModal}
          pipelineId={pipelineId}
          stages={stages}
          agents={agents}
          queues={queues}
          wonStageId={wonStage?.id ?? null}
          lostStageId={lostStage?.id ?? null}
          onClose={() => setDealModal(null)}
          onSaved={() => {
            setDealModal(null)
            reload()
          }}
        />
      )}

      {pipelineModal === 'create' && (
        <PipelineFormModal
          onClose={() => setPipelineModal(null)}
          onSaved={(pipeline) => {
            setPipelineModal(null)
            router.navigate({ to: '/inbox/funis/$pipelineId', params: { pipelineId: pipeline.id } })
          }}
        />
      )}

      {pipelineModal === 'manage' && (
        <PipelineManageModal
          pipeline={initial.pipeline}
          onClose={() => setPipelineModal(null)}
          onRenamed={() => {
            setPipelineModal(null)
            reloadPipelines()
          }}
          onDeleted={() => {
            setPipelineModal(null)
            router.navigate({ to: '/inbox/funis' })
          }}
        />
      )}

      {stageModal && (
        <StageFormModal
          key={stageModal.kind === 'edit' ? stageModal.stage.id : 'new-stage'}
          mode={stageModal}
          pipelineId={pipelineId}
          onClose={() => setStageModal(null)}
          onSaved={() => {
            setStageModal(null)
            reload()
          }}
        />
      )}
    </InboxShell>
  )
}

// ─── Coluna (estágio) ─────────────────────────────────────────────────────────

function StageColumn({
  stage,
  isSuperadmin,
  canMoveLeft,
  canMoveRight,
  onNewDeal,
  onOpenDeal,
  onEditStage,
  onMoveStage,
  onDeleteStage,
}: {
  stage: StageBoard
  isSuperadmin: boolean
  canMoveLeft: boolean
  canMoveRight: boolean
  onNewDeal: () => void
  onOpenDeal: (deal: KanbanDealItem) => void
  onEditStage: () => void
  onMoveStage: (direction: 'up' | 'down') => void
  onDeleteStage: () => Promise<void>
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function onClick(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [menuOpen])

  const totalCents = stage.deals.reduce((sum, d) => sum + d.valueCents, 0)
  const KindIcon = stage.kind === 'won' ? Trophy : stage.kind === 'lost' ? XCircle : null

  async function handleDelete() {
    setDeleting(true)
    setDeleteError(null)
    await onDeleteStage()
    setDeleting(false)
    // Se o estágio continua na lista (a API recusa excluir com deals), avisa.
    setConfirmDelete(false)
  }

  return (
    <section
      ref={setNodeRef}
      className={`flex max-h-full w-72 shrink-0 flex-col rounded-xl border bg-neutral-50 transition-colors ${
        isOver ? 'border-brand-300' : 'border-neutral-200'
      }`}
    >
      <header className="flex items-center gap-2 px-3 pb-2 pt-3">
        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} aria-hidden="true" />
        {KindIcon && (
          <KindIcon
            size={14}
            className={stage.kind === 'won' ? 'shrink-0 text-success-500' : 'shrink-0 text-error-500'}
            aria-hidden="true"
          />
        )}
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-dark-800">{stage.name}</h2>
        <span className="shrink-0 rounded-full bg-neutral-200/70 px-1.5 text-[10px] font-bold leading-4 text-neutral-500">
          {stage.deals.length}
        </span>
        {isSuperadmin && (
          <div className="relative shrink-0" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={`Opções do estágio ${stage.name}`}
              aria-expanded={menuOpen}
              className="grid size-7 place-items-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-200/60 hover:text-dark-800"
            >
              <MoreVertical size={14} aria-hidden="true" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-30 mt-1 w-48 overflow-hidden rounded-lg border border-neutral-200 bg-neutral-0 py-1 text-sm shadow-lg">
                <MenuItem icon={Pencil} label="Editar estágio" onClick={() => { setMenuOpen(false); onEditStage() }} />
                <MenuItem
                  icon={ArrowLeft}
                  label="Mover para a esquerda"
                  disabled={!canMoveLeft}
                  onClick={() => { setMenuOpen(false); onMoveStage('up') }}
                />
                <MenuItem
                  icon={ArrowRight}
                  label="Mover para a direita"
                  disabled={!canMoveRight}
                  onClick={() => { setMenuOpen(false); onMoveStage('down') }}
                />
                <MenuItem
                  icon={Trash2}
                  label="Excluir estágio"
                  danger
                  onClick={() => { setMenuOpen(false); setDeleteError(null); setConfirmDelete(true) }}
                />
              </div>
            )}
          </div>
        )}
      </header>
      <p className="px-3 pb-2 text-xs font-medium text-neutral-400">{formatCents(totalCents)}</p>

      <SortableContext items={stage.deals.map((d) => d.id)} strategy={verticalListSortingStrategy}>
        <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
          {stage.deals.map((deal) => (
            <SortableDealCard key={deal.id} deal={deal} onOpen={() => onOpenDeal(deal)} />
          ))}
          {stage.deals.length === 0 && (
            <p className="rounded-lg border border-dashed border-neutral-200 px-3 py-6 text-center text-xs text-neutral-400">
              Arraste um deal para cá
            </p>
          )}
        </div>
      </SortableContext>

      <button
        type="button"
        onClick={onNewDeal}
        className="m-2 flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold text-neutral-500 transition-colors hover:bg-neutral-200/60 hover:text-dark-800"
      >
        <Plus size={14} aria-hidden="true" />
        Novo deal
      </button>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Excluir estágio "${stage.name}"?`}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
              Cancelar
            </Button>
            <Button variant="danger" size="sm" loading={deleting} onClick={handleDelete}>
              Excluir estágio
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-neutral-500">
            Estágios com deals não podem ser excluídos. Mova ou remova os deals antes.
          </p>
          {deleteError && <ErrorNote>{deleteError}</ErrorNote>}
        </div>
      </Modal>
    </section>
  )
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  danger = false,
}: {
  icon: typeof Pencil
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold transition-colors disabled:pointer-events-none disabled:opacity-40 ${
        danger ? 'text-error-500 hover:bg-error-500/5' : 'text-dark-800 hover:bg-neutral-50'
      }`}
    >
      <Icon size={14} aria-hidden="true" />
      {label}
    </button>
  )
}

// ─── Card do deal ─────────────────────────────────────────────────────────────

function SortableDealCard({ deal, onOpen }: { deal: KanbanDealItem; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: deal.id,
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      className={`cursor-grab touch-none active:cursor-grabbing ${isDragging ? 'opacity-40' : ''}`}
    >
      <DealCardContent deal={deal} />
    </div>
  )
}

function DealCardContent({ deal, dragging = false }: { deal: KanbanDealItem; dragging?: boolean }) {
  return (
    <div
      className={`rounded-lg border border-neutral-200 bg-neutral-0 p-3 ${
        dragging ? 'rotate-1 shadow-lg' : 'shadow-2xs transition-shadow hover:shadow-sm'
      }`}
    >
      <p className="text-sm font-semibold text-dark-800">{deal.title}</p>
      <p className="mt-0.5 truncate text-xs text-neutral-500">{deal.contactName}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-dark-800">{formatCents(deal.valueCents)}</span>
        {deal.agentName && (
          <span
            title={deal.agentName}
            className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-100 text-[10px] font-bold text-brand-600"
          >
            {getInitials(deal.agentName)}
          </span>
        )}
      </div>
      {deal.queueName && (
        <div className="mt-2">
          <Badge className="border-neutral-200 bg-neutral-50 text-[10px] text-neutral-500">{deal.queueName}</Badge>
        </div>
      )}
    </div>
  )
}

// ─── Modal do deal (criar / editar) ──────────────────────────────────────────

const inputClass =
  'h-10 w-full rounded-md border border-neutral-300 bg-neutral-0 px-3 text-sm text-dark-800 placeholder:text-neutral-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20'
const labelClass = 'block text-sm font-medium text-dark-800'

function DealModal({
  mode,
  pipelineId,
  stages,
  agents,
  queues,
  wonStageId,
  lostStageId,
  onClose,
  onSaved,
}: {
  mode: { kind: 'create'; stageId: string } | { kind: 'edit'; deal: KanbanDealItem }
  pipelineId: string
  stages: StageBoard[]
  agents: AgentOption[]
  queues: QueueItem[]
  wonStageId: string | null
  lostStageId: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const editing = mode.kind === 'edit' ? mode.deal : null
  const [title, setTitle] = useState(editing?.title ?? '')
  const [contact, setContact] = useState<{ id: string; name: string } | null>(
    editing ? { id: editing.contactId, name: editing.contactName } : null,
  )
  const [contactQuery, setContactQuery] = useState(editing?.contactName ?? '')
  const [contactResults, setContactResults] = useState<ContactListItem[]>([])
  const [contactOpen, setContactOpen] = useState(false)
  const [valueCents, setValueCents] = useState(editing?.valueCents ?? 0)
  const [assignedAgentId, setAssignedAgentId] = useState(editing?.assignedAgentId ?? '')
  const [queueId, setQueueId] = useState(editing?.queueId ?? '')
  const [conversationId, setConversationId] = useState(editing?.conversationId ?? '')
  const [conversations, setConversations] = useState<ConversationListItem[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lostStep, setLostStep] = useState(false)
  const [lostReason, setLostReason] = useState(editing?.lostReason ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Busca de contatos com debounce.
  useEffect(() => {
    if (!contactOpen) return
    const timer = setTimeout(async () => {
      const results = await fetchContacts({ data: { search: contactQuery.trim() || undefined } })
      setContactResults(results)
    }, 250)
    return () => clearTimeout(timer)
  }, [contactQuery, contactOpen])

  // Conversas para o vínculo opcional (carregadas uma vez ao abrir).
  useEffect(() => {
    fetchConversations({ data: { filter: 'all' } })
      .then(setConversations)
      .catch(() => {})
  }, [])

  const canSave = title.trim().length > 0 && contact !== null

  async function handleSave() {
    if (!canSave || !contact) return
    setSaving(true)
    setError(null)
    if (mode.kind === 'create') {
      const created = await createDeal({
        data: {
          pipelineId,
          title: title.trim(),
          contactId: contact.id,
          stageId: mode.stageId,
          valueCents,
          assignedAgentId: assignedAgentId || undefined,
          queueId: queueId || undefined,
          conversationId: conversationId || undefined,
        },
      })
      if (!created) {
        setSaving(false)
        setError('Não foi possível criar o deal. Tente novamente.')
        return
      }
    } else {
      const updated = await updateDeal({
        data: {
          dealId: mode.deal.id,
          title: title.trim(),
          valueCents,
          assignedAgentId: assignedAgentId || null,
          queueId: queueId || null,
          conversationId: conversationId || null,
        },
      })
      if (!updated) {
        setSaving(false)
        setError('Não foi possível salvar as alterações. Tente novamente.')
        return
      }
    }
    setSaving(false)
    onSaved()
  }

  async function handleWon() {
    if (!editing || !wonStageId) return
    setSaving(true)
    await moveDeal({ data: { dealId: editing.id, stageId: wonStageId, position: 0 } })
    setSaving(false)
    onSaved()
  }

  async function handleLost() {
    if (!editing || !lostStageId) return
    setSaving(true)
    await updateDeal({ data: { dealId: editing.id, lostReason: lostReason.trim() || null } })
    await moveDeal({ data: { dealId: editing.id, stageId: lostStageId, position: 0 } })
    setSaving(false)
    onSaved()
  }

  async function handleDelete() {
    if (!editing) return
    setDeleting(true)
    await deleteDeal({ data: { dealId: editing.id } })
    setDeleting(false)
    setConfirmDelete(false)
    onSaved()
  }

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={editing ? 'Editar deal' : 'Novo deal'}
        footer={
          <div className="flex w-full items-center justify-between gap-2">
            <div>
              {editing && (
                <Button variant="danger" size="sm" icon={Trash2} onClick={() => setConfirmDelete(true)}>
                  Excluir
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {editing && editing.status === 'open' && wonStageId && (
                <Button variant="secondary" size="sm" icon={Trophy} loading={saving} onClick={handleWon}>
                  Ganho
                </Button>
              )}
              {editing && editing.status === 'open' && lostStageId && (
                <Button variant="secondary" size="sm" icon={XCircle} onClick={() => setLostStep(true)}>
                  Perdido
                </Button>
              )}
              <Button size="sm" loading={saving} disabled={!canSave} onClick={handleSave}>
                {editing ? 'Salvar' : 'Criar deal'}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="deal-title" className={labelClass}>
              Título
            </label>
            <input
              id="deal-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Plano anual — ACME"
              autoFocus
              className={inputClass}
            />
          </div>

          <div className="relative space-y-1.5">
            <label htmlFor="deal-contact" className={labelClass}>
              Contato
            </label>
            <input
              id="deal-contact"
              value={contactQuery}
              onChange={(e) => {
                setContactQuery(e.target.value)
                setContact(null)
                setContactOpen(true)
              }}
              onFocus={() => setContactOpen(true)}
              onBlur={() => setTimeout(() => setContactOpen(false), 150)}
              placeholder="Buscar contato por nome…"
              className={inputClass}
            />
            {contactOpen && contactResults.length > 0 && (
              <div className="absolute inset-x-0 top-full z-30 mt-1 max-h-48 overflow-y-auto rounded-lg border border-neutral-200 bg-neutral-0 py-1 shadow-lg">
                {contactResults.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setContact({ id: c.id, name: c.name })
                      setContactQuery(c.name)
                      setContactOpen(false)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-neutral-50"
                  >
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-neutral-100 text-[10px] font-bold text-dark-800">
                      {getInitials(c.name)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-dark-800">{c.name}</span>
                    {c.primaryChannelIdentifier && (
                      <span className="shrink-0 text-xs text-neutral-400">{c.primaryChannelIdentifier}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="deal-value" className={labelClass}>
              Valor
            </label>
            <input
              id="deal-value"
              inputMode="numeric"
              value={valueCents > 0 ? formatCents(valueCents) : ''}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, '')
                setValueCents(digits ? Number(digits) : 0)
              }}
              placeholder="R$ 0,00"
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="deal-agent" className={labelClass}>
                Responsável
              </label>
              <select
                id="deal-agent"
                value={assignedAgentId}
                onChange={(e) => setAssignedAgentId(e.target.value)}
                className={inputClass}
              >
                <option value="">Sem responsável</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="deal-queue" className={labelClass}>
                Fila
              </label>
              <select
                id="deal-queue"
                value={queueId}
                onChange={(e) => setQueueId(e.target.value)}
                className={inputClass}
              >
                <option value="">Sem fila</option>
                {queues.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="deal-conversation" className={labelClass}>
              Conversa vinculada <span className="font-normal text-neutral-400">(opcional)</span>
            </label>
            <select
              id="deal-conversation"
              value={conversationId}
              onChange={(e) => setConversationId(e.target.value)}
              className={inputClass}
            >
              <option value="">Nenhuma</option>
              {conversations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.contactName} · {c.status}
                </option>
              ))}
            </select>
            {editing?.conversationId && (
              <Link
                to="/inbox/c/$conversationId"
                params={{ conversationId: editing.conversationId }}
                className="inline-block text-xs font-semibold text-brand-600 hover:text-brand-700"
              >
                Abrir conversa vinculada
              </Link>
            )}
          </div>

          {error && <ErrorNote>{error}</ErrorNote>}
        </div>
      </Modal>

      {/* Motivo da perda */}
      <Modal
        open={lostStep}
        onClose={() => setLostStep(false)}
        title="Marcar como perdido"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setLostStep(false)}>
              Voltar
            </Button>
            <Button size="sm" loading={saving} onClick={handleLost}>
              Confirmar perda
            </Button>
          </>
        }
      >
        <div className="space-y-1.5">
          <label htmlFor="lost-reason" className={labelClass}>
            Motivo da perda
          </label>
          <textarea
            id="lost-reason"
            value={lostReason}
            onChange={(e) => setLostReason(e.target.value)}
            placeholder="Ex.: Cliente escolheu o concorrente"
            rows={3}
            autoFocus
            className="w-full rounded-md border border-neutral-300 bg-neutral-0 px-3 py-2 text-sm text-dark-800 placeholder:text-neutral-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
      </Modal>

      {/* Confirmação de exclusão */}
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Excluir deal?"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
              Cancelar
            </Button>
            <Button variant="danger" size="sm" loading={deleting} onClick={handleDelete}>
              Excluir deal
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-500">
          Essa ação é irreversível. O deal "{editing?.title}" será removido do funil.
        </p>
      </Modal>
    </>
  )
}

// ─── Modais de funil (superadmin) ────────────────────────────────────────────

function PipelineFormModal({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: (pipeline: PipelineRow) => void
}) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    const pipeline = await createPipeline({ data: { name: name.trim() } })
    setSaving(false)
    if (pipeline) onSaved(pipeline)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Novo funil"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button size="sm" loading={saving} disabled={!name.trim()} onClick={handleSave}>
            Criar funil
          </Button>
        </>
      }
    >
      <div className="space-y-1.5">
        <label htmlFor="new-pipeline-name" className={labelClass}>
          Nome do funil
        </label>
        <input
          id="new-pipeline-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex.: Vendas WhatsApp"
          autoFocus
          className={inputClass}
        />
      </div>
    </Modal>
  )
}

function PipelineManageModal({
  pipeline,
  onClose,
  onRenamed,
  onDeleted,
}: {
  pipeline: PipelineRow
  onClose: () => void
  onRenamed: () => void
  onDeleted: () => void
}) {
  const [name, setName] = useState(pipeline.name)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleRename() {
    if (!name.trim() || name.trim() === pipeline.name) return
    setSaving(true)
    setError(null)
    const updated = await updatePipeline({ data: { pipelineId: pipeline.id, name: name.trim() } })
    setSaving(false)
    if (!updated) {
      setError('Não foi possível renomear o funil. Tente novamente.')
      return
    }
    onRenamed()
  }

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    await deletePipeline({ data: { pipelineId: pipeline.id } })
    // A API recusa excluir funil com deals — confere se ele realmente saiu.
    const remaining = await fetchPipelines()
    if (remaining.some((p) => p.id === pipeline.id)) {
      setDeleting(false)
      setConfirmDelete(false)
      setError('Não foi possível excluir: ainda há deals neste funil. Remova-os antes de excluir.')
      return
    }
    setDeleting(false)
    onDeleted()
  }

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title="Gerenciar funil"
        footer={
          <div className="flex w-full items-center justify-between gap-2">
            <Button variant="danger" size="sm" icon={Trash2} onClick={() => { setError(null); setConfirmDelete(true) }}>
              Excluir funil
            </Button>
            <Button size="sm" loading={saving} disabled={!name.trim() || name.trim() === pipeline.name} onClick={handleRename}>
              Salvar nome
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="pipeline-rename" className={labelClass}>
              Nome do funil
            </label>
            <input
              id="pipeline-rename"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
        </div>
      </Modal>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Excluir funil "${pipeline.name}"?`}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
              Cancelar
            </Button>
            <Button variant="danger" size="sm" loading={deleting} onClick={handleDelete}>
              Excluir funil
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-500">
          Essa ação é irreversível. Funis com deals não podem ser excluídos.
        </p>
      </Modal>
    </>
  )
}

// ─── Modal de estágio (superadmin) ───────────────────────────────────────────

function StageFormModal({
  mode,
  pipelineId,
  onClose,
  onSaved,
}: {
  mode: { kind: 'create' } | { kind: 'edit'; stage: StageBoard }
  pipelineId: string
  onClose: () => void
  onSaved: () => void
}) {
  const editing = mode.kind === 'edit' ? mode.stage : null
  const [name, setName] = useState(editing?.name ?? '')
  const [color, setColor] = useState(editing?.color ?? '#DD5973')
  const [kind, setKind] = useState<StageKind>(editing?.kind ?? 'open')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    const result =
      mode.kind === 'create'
        ? await createStage({ data: { pipelineId, name: name.trim(), color, kind } })
        : await updateStage({ data: { stageId: mode.stage.id, name: name.trim(), color, kind } })
    setSaving(false)
    if (!result) {
      setError('Não foi possível salvar o estágio. Tente novamente.')
      return
    }
    onSaved()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? 'Editar estágio' : 'Adicionar estágio'}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button size="sm" loading={saving} disabled={!name.trim()} onClick={handleSave}>
            {editing ? 'Salvar' : 'Adicionar estágio'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="stage-name" className={labelClass}>
            Nome do estágio
          </label>
          <input
            id="stage-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Negociação"
            autoFocus
            className={inputClass}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="stage-color" className={labelClass}>
              Cor
            </label>
            <div className="flex items-center gap-2">
              <input
                id="stage-color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-12 cursor-pointer rounded-md border border-neutral-300 bg-neutral-0 p-1"
              />
              <span className="text-sm text-neutral-500">{color.toUpperCase()}</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="stage-kind" className={labelClass}>
              Tipo
            </label>
            <select
              id="stage-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as StageKind)}
              className={inputClass}
            >
              {(Object.keys(stageKindLabel) as StageKind[]).map((k) => (
                <option key={k} value={k}>
                  {stageKindLabel[k]}
                </option>
              ))}
            </select>
          </div>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  )
}
