import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import type { RolePermissionMap } from '@naia/schemas'
import { ChevronLeft, ChevronRight, Save, Zap } from 'lucide-react'
import {
  bulkUpsertContacts,
  createCampaign,
  dispatchCampaign,
  importContactsFile,
  updateCampaign,
  type CampaignPayload,
} from '../../lib/actions'
import { Button, ErrorNote } from '../ui'
import { WizardStepper } from './stepper'
import { StepChannels } from './step-channels'
import { StepAudience } from './step-audience'
import { StepContent } from './step-content'
import { StepSettings } from './step-settings'
import type { WizardConnection, WizardDraft } from './types'
import { draftToSchedule, draftToVariants } from './types'

export function CampaignWizard({
  workspaceId,
  connections,
  availableTags,
  tier,
  initialDraft,
  campaignId,
  canDispatch = true,
  userId,
  permissions,
}: {
  workspaceId: string
  connections: WizardConnection[]
  availableTags: string[]
  tier: string
  initialDraft: WizardDraft
  /** Presente no modo edição — o submit vira PATCH em vez de POST. */
  campaignId?: string
  /** false quando o status atual não permite disparar (ex: pausada) — só salva. */
  canDispatch?: boolean
  userId: string
  permissions: RolePermissionMap
}) {
  const router = useRouter()
  const [draft, setDraft] = useState(initialDraft)
  const [step, setStep] = useState(0)
  const [furthest, setFurthest] = useState(campaignId ? 3 : 0)
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'draft' | 'dispatch' | null>(null)

  function patch(partial: Partial<WizardDraft>) {
    setDraft((d) => ({ ...d, ...partial }))
  }

  function validateStep(index: number): string | null {
    if (index === 0) {
      if (draft.connectionIds.length === 0) return 'Selecione ao menos uma conexão ativa para o disparo.'
    }
    if (index === 1) {
      if (draft.audienceMode === 'tags' && draft.tags.length === 0)
        return 'Adicione ao menos uma tag para definir o público.'
      if (draft.audienceMode === 'groups' && draft.groupIds.length === 0)
        return 'Selecione ao menos um grupo.'
      if (draft.audienceMode === 'manual' && !draft.manualRows.some((r) => r.phone.trim()))
        return 'Preencha ao menos um número de telefone.'
      if (draft.audienceMode === 'file' && !file && !draft.resolvedAudienceTag)
        return 'Carregue um arquivo CSV ou XLSX com seus leads.'
    }
    if (index === 2) {
      if (draftToVariants(draft).length === 0)
        return 'Escreva ao menos uma mensagem (ou anexe uma mídia).'
    }
    if (index === 3) {
      if (draft.scheduleType === 'once' && !draft.onceAt)
        return 'Informe a data e o horário do disparo agendado.'
      if (draft.scheduleType === 'recurring' && draft.recKind === 'weekly' && draft.recWeekdays.length === 0)
        return 'Escolha ao menos um dia da semana para a recorrência.'
      if (draft.speed.preset === 'manual' && !draft.speed.minSeconds)
        return 'Informe o intervalo mínimo da velocidade manual.'
    }
    return null
  }

  function goTo(next: number) {
    if (next > step) {
      for (let i = step; i < next; i++) {
        const problem = validateStep(i)
        if (problem) {
          setError(problem)
          return
        }
      }
    }
    setError(null)
    setStep(next)
    setFurthest((f) => Math.max(f, next))
  }

  /** Resolve o público em um segmentFilter — modos manual/arquivo materializam contatos antes. */
  async function resolveSegmentFilter(): Promise<{ filter: unknown } | { error: string }> {
    if (draft.audienceMode === 'all') return { filter: { type: 'all' } }
    if (draft.audienceMode === 'tags') return { filter: { type: 'tags', tags: draft.tags } }
    if (draft.audienceMode === 'groups') {
      return {
        filter: {
          type: 'groups',
          groupIds: draft.groupIds,
          targetMode: draft.groupTargetMode,
          tagOnCreate: draft.groupTagOnCreate.split(',').map((t) => t.trim()).filter(Boolean),
        },
      }
    }
    if (draft.audienceMode === 'manual') {
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
      const tag = `manual:${stamp}`
      const rows = draft.manualRows
        .map((r) => ({ name: r.name.trim(), phone: r.phone.trim() }))
        .filter((r) => r.phone)
      const result = await bulkUpsertContacts({ data: { workspaceId, rows, tags: [tag] } })
      if ('error' in result) return { error: result.error ?? 'Erro ao salvar o público manual.' }
      if (result.created + result.updated === 0) {
        return { error: `Nenhum número válido no público manual. ${result.errors[0] ?? ''}`.trim() }
      }
      return { filter: { type: 'tags', tags: [tag] } }
    }
    // arquivo
    if (!file) {
      if (draft.resolvedAudienceTag) return { filter: { type: 'tags', tags: [draft.resolvedAudienceTag] } }
      return { error: 'Carregue um arquivo com seus leads.' }
    }
    const buffer = await file.arrayBuffer()
    let binary = ''
    const bytes = new Uint8Array(buffer)
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    const result = await importContactsFile({
      data: {
        workspaceId,
        filename: file.name,
        mimeType: file.type || 'text/csv',
        contentBase64: btoa(binary),
      },
    })
    if ('error' in result) return { error: result.error ?? 'Erro ao importar o arquivo.' }
    patch({ resolvedAudienceTag: result.tag })
    setFile(null)
    return { filter: { type: 'tags', tags: [result.tag] } }
  }

  async function submit(mode: 'draft' | 'dispatch') {
    for (let i = 0; i <= (mode === 'dispatch' ? 3 : 2); i++) {
      const problem = validateStep(i)
      if (problem) {
        setError(problem)
        return
      }
    }
    if (!draft.name.trim()) {
      setError('Dê um nome à campanha.')
      return
    }
    if (mode === 'dispatch' && !draft.consent) {
      setError('Confirme que você tem o consentimento do público selecionado.')
      return
    }

    setBusy(mode)
    setError(null)
    try {
      const segment = await resolveSegmentFilter()
      if ('error' in segment) {
        setError(segment.error)
        return
      }

      const payload: CampaignPayload = {
        workspaceId,
        name: draft.name.trim(),
        connectionIds: draft.connectionIds,
        segmentFilter: segment.filter,
        variants: draftToVariants(draft),
        schedule: draftToSchedule(draft),
        speed: draft.speed,
        timezone: draft.timezone,
        applyTagOnDispatch: draft.applyTag.trim() || null,
      }

      const saved = campaignId
        ? await updateCampaign({ data: { ...payload, campaignId } })
        : await createCampaign({ data: payload })

      if ('error' in saved || !saved.campaign) {
        setError(('error' in saved ? saved.error : null) ?? 'Erro inesperado ao salvar a campanha.')
        return
      }

      const savedId = saved.campaign.id
      if (mode === 'dispatch' && ['draft', 'scheduled'].includes(saved.campaign.status)) {
        const dispatched = await dispatchCampaign({ data: { workspaceId, campaignId: savedId, consent: true } })
        if (dispatched && 'error' in dispatched && dispatched.error) {
          setError(dispatched.error)
          return
        }
      }

      router.navigate({ to: '/$workspaceId/campaigns/$campaignId', params: { workspaceId, campaignId: savedId } })
    } finally {
      setBusy(null)
    }
  }

  const isLast = step === 3
  const editing = Boolean(campaignId)

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col">
      {/* Cabeçalho: nome + stepper */}
      <div className="grid items-start gap-6 border-b border-neutral-100 pb-5 lg:grid-cols-[280px_1fr]">
        <div>
          <p className="font-display text-sm font-extrabold uppercase tracking-wide text-dark-800">
            {editing ? 'Editar' : 'Criar'} <span className="text-brand-600">campanha</span>
          </p>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="Digite o nome da campanha"
            aria-label="Nome da campanha"
            className="mt-2"
          />
        </div>
        <div className="max-w-2xl lg:justify-self-end lg:w-full">
          <WizardStepper current={step} furthest={furthest} onSelect={goTo} />
        </div>
      </div>

      {/* Conteúdo do passo */}
      <div key={step} className="wizard-step flex-1 py-6">
        {step === 0 && (
          <StepChannels draft={draft} patch={patch} connections={connections} workspaceId={workspaceId} />
        )}
        {step === 1 && (
          <StepAudience
            draft={draft}
            patch={patch}
            connections={connections}
            workspaceId={workspaceId}
            availableTags={availableTags}
            file={file}
            setFile={setFile}
          />
        )}
        {step === 2 && <StepContent draft={draft} patch={patch} workspaceId={workspaceId} userId={userId} permissions={permissions} />}
        {step === 3 && (
          <StepSettings
            draft={draft}
            patch={patch}
            connections={connections}
            tier={tier}
            workspaceId={workspaceId}
          />
        )}
      </div>

      {error && (
        <div className="mb-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {/* Rodapé persistente */}
      <div className="sticky bottom-0 -mx-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-t border-neutral-200 bg-neutral-0/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
        {canDispatch ? (
          <label className="flex max-w-sm cursor-pointer select-none items-start gap-2 text-xs text-neutral-600">
            <input
              type="checkbox"
              checked={draft.consent}
              onChange={(e) => patch({ consent: e.target.checked })}
              className="mt-0.5 size-4 shrink-0 accent-brand-500"
            />
            Tenho o consentimento para enviar mensagens ao público selecionado
          </label>
        ) : (
          <span />
        )}

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.navigate({ to: '/$workspaceId/campaigns', params: { workspaceId } })}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="secondary"
            icon={Save}
            loading={busy === 'draft'}
            disabled={busy !== null}
            onClick={() => submit('draft')}
          >
            {editing ? 'Salvar alterações' : 'Rascunho'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            icon={ChevronLeft}
            disabled={step === 0}
            onClick={() => goTo(step - 1)}
          >
            Anterior
          </Button>
          {isLast && canDispatch ? (
            <Button
              type="button"
              icon={Zap}
              loading={busy === 'dispatch'}
              disabled={busy !== null || !draft.consent}
              onClick={() => submit('dispatch')}
            >
              {draft.scheduleType === 'immediate' ? 'Iniciar disparo' : 'Agendar disparo'}
            </Button>
          ) : isLast ? null : (
            <Button type="button" onClick={() => goTo(step + 1)}>
              Próximo
              <ChevronRight size={16} aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
