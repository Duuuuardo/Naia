import { useEffect, useRef, useState } from 'react'
import {
  CheckSquare,
  FileSpreadsheet,
  Loader2,
  MessageCircle,
  Plus,
  Square,
  Tag,
  Trash2,
  UserPen,
  Users,
  UsersRound,
} from 'lucide-react'
import { fetchConnectionGroupsSync, fetchContacts } from '../../lib/actions'
import type { AudienceMode, WizardConnection, WizardDraft } from './types'

const MODES: Array<{ id: AudienceMode; title: string; hint: string; icon: typeof Users }> = [
  { id: 'all', title: 'Todo meu público', hint: 'Todos os contatos com opt-in ativo', icon: UsersRound },
  { id: 'tags', title: 'Por tags', hint: 'Contatos com as tags escolhidas', icon: Tag },
  { id: 'groups', title: 'Grupos do WhatsApp', hint: 'Grupos da conexão ou seus membros', icon: Users },
  { id: 'manual', title: 'Manualmente', hint: 'Digitar nomes e números na hora', icon: UserPen },
  { id: 'file', title: 'Arquivo (csv ou xlsx)', hint: 'Carregue um arquivo com seus leads', icon: FileSpreadsheet },
]

export function StepAudience({
  draft,
  patch,
  connections,
  workspaceId,
  availableTags,
  file,
  setFile,
}: {
  draft: WizardDraft
  patch: (partial: Partial<WizardDraft>) => void
  connections: WizardConnection[]
  workspaceId: string
  availableTags: string[]
  file: File | null
  setFile: (f: File | null) => void
}) {
  return (
    <div>
      <div className="mb-4 flex items-baseline gap-3 border-b border-neutral-100 pb-3">
        <h2 className="text-base font-bold text-dark-800">Selecionar público</h2>
        <p className="text-xs text-neutral-500">Para quem esta campanha será enviada?</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
        <div className="flex flex-col gap-2" role="radiogroup" aria-label="Tipo de público">
          {MODES.map((mode) => {
            const active = draft.audienceMode === mode.id
            const Icon = mode.icon
            return (
              <button
                key={mode.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => patch({ audienceMode: mode.id })}
                className={`flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors duration-150 active:scale-[0.98] ${
                  active
                    ? 'border-brand-500 bg-brand-50/50 ring-1 ring-brand-500'
                    : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50'
                }`}
              >
                <span
                  className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border-2 ${
                    active ? 'border-brand-500' : 'border-neutral-300'
                  }`}
                  aria-hidden="true"
                >
                  {active && <span className="size-2 rounded-full bg-brand-500" />}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-xs font-bold text-dark-800">
                    <Icon size={13} className={active ? 'text-brand-600' : 'text-neutral-400'} aria-hidden="true" />
                    {mode.title}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-neutral-500">{mode.hint}</span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="min-w-0">
          {draft.audienceMode === 'all' && <AllPane />}
          {draft.audienceMode === 'tags' && <TagsPane draft={draft} patch={patch} availableTags={availableTags} />}
          {draft.audienceMode === 'groups' && (
            <GroupsPane draft={draft} patch={patch} connections={connections} workspaceId={workspaceId} />
          )}
          {draft.audienceMode === 'manual' && <ManualPane draft={draft} patch={patch} />}
          {draft.audienceMode === 'file' && <FilePane file={file} setFile={setFile} />}

          <div className="mt-5 border-t border-neutral-100 pt-4">
            <label htmlFor="apply-tag" className="flex items-center gap-1.5">
              <Tag size={14} className="text-brand-500" aria-hidden="true" />
              Aplicar tag ao público desta campanha (opcional)
            </label>
            <input
              id="apply-tag"
              type="text"
              value={draft.applyTag}
              onChange={(e) => patch({ applyTag: e.target.value })}
              placeholder="Ex: lancamento-julho"
              className="max-w-sm"
            />
            <p className="mt-1 text-[11px] text-neutral-500">
              Cada contato atingido pelo disparo recebe essa tag. Útil para segmentar as próximas campanhas.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function AllPane() {
  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-5 text-sm text-neutral-600">
      <p className="font-semibold text-dark-800">Todos os contatos elegíveis do workspace.</p>
      <p className="mt-1 text-xs leading-relaxed">
        Contatos que se descadastraram (opt-out) ficam de fora automaticamente. Essa regra vale para qualquer
        público e não pode ser desativada.
      </p>
    </div>
  )
}

function TagsPane({
  draft,
  patch,
  availableTags,
}: {
  draft: WizardDraft
  patch: (partial: Partial<WizardDraft>) => void
  availableTags: string[]
}) {
  const [input, setInput] = useState('')

  function addTag(tag: string) {
    const clean = tag.trim()
    if (!clean || draft.tags.includes(clean)) return
    patch({ tags: [...draft.tags, clean] })
    setInput('')
  }

  const suggestions = availableTags.filter(
    (t) => !draft.tags.includes(t) && (!input || t.toLowerCase().includes(input.toLowerCase())),
  )

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="tag-input">Tags do público</label>
        <div className="flex max-w-md gap-2">
          <input
            id="tag-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addTag(input)
              }
            }}
            placeholder="Digite e pressione Enter"
          />
          <button
            type="button"
            onClick={() => addTag(input)}
            className="grid size-10 shrink-0 place-items-center rounded-md border border-neutral-300 text-neutral-500 transition-colors duration-150 hover:border-brand-500 hover:text-brand-600 active:scale-[0.95]"
            aria-label="Adicionar tag"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      {draft.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {draft.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-brand-100 py-1 pl-2.5 pr-1 text-xs font-semibold text-brand-700"
            >
              {tag}
              <button
                type="button"
                onClick={() => patch({ tags: draft.tags.filter((t) => t !== tag) })}
                className="grid size-4 place-items-center rounded-full transition-colors hover:bg-brand-200"
                aria-label={`Remover tag ${tag}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {suggestions.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-neutral-400">
            Tags existentes no workspace
          </p>
          <div className="flex max-w-lg flex-wrap gap-1.5">
            {suggestions.slice(0, 16).map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => addTag(tag)}
                className="rounded-full border border-neutral-200 px-2.5 py-1 text-xs text-neutral-600 transition-colors duration-150 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="text-[11px] text-neutral-500">O contato entra no público se tiver qualquer uma das tags.</p>
    </div>
  )
}

function GroupsPane({
  draft,
  patch,
  connections,
  workspaceId,
}: {
  draft: WizardDraft
  patch: (partial: Partial<WizardDraft>) => void
  connections: WizardConnection[]
  workspaceId: string
}) {
  const [groups, setGroups] = useState<Array<{ id: string; subject: string; size: number; fromSaved: boolean }>>([])
  const [loading, setLoading] = useState(false)
  const selectedWhatsapp = connections.filter(
    (c) => draft.connectionIds.includes(c.id) && c.channel === 'whatsapp' && c.status === 'active',
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      fetchContacts({ data: { workspaceId, isGroup: 'true' } }).catch(() => ({ contacts: [] as any[] })),
      ...selectedWhatsapp.map((conn) =>
        fetchConnectionGroupsSync({ data: { workspaceId, connectionId: conn.id } }).catch(() => ({ groups: [] })),
      ),
    ]).then(([crmRes, ...connResults]) => {
      if (cancelled) return
      const map = new Map<string, { id: string; subject: string; size: number; fromSaved: boolean }>()
      for (const c of (crmRes as { contacts: any[] }).contacts ?? []) {
        const id = c.whatsappPhone || c.id
        map.set(id, {
          id,
          subject: c.name,
          size: c.customFields?.groupParticipants?.length ?? 0,
          fromSaved: true,
        })
      }
      for (const res of connResults) {
        const list = 'groups' in res && Array.isArray(res.groups) ? res.groups : []
        for (const g of list as any[]) {
          const existing = map.get(g.id)
          if (existing) {
            existing.size = existing.size || g.size || 0
          } else {
            map.set(g.id, { id: g.id, subject: g.subject, size: g.size ?? 0, fromSaved: false })
          }
        }
      }
      setGroups(Array.from(map.values()))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, draft.connectionIds.join(',')])

  const allSelected = groups.length > 0 && draft.groupIds.length === groups.length

  return (
    <div className="space-y-4">
      <div>
        <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-neutral-500">
          Modo de envio
        </span>
        <div className="grid gap-3 sm:grid-cols-2">
          <ModeCard
            active={draft.groupTargetMode === 'members'}
            onClick={() => patch({ groupTargetMode: 'members' })}
            icon={<Users size={15} className="text-emerald-600" aria-hidden="true" />}
            title="Membros do grupo"
            badge="Recomendado"
            description="Mensagem no privado de cada participante. Os contatos são salvos no workspace conforme o disparo avança."
          />
          <ModeCard
            active={draft.groupTargetMode === 'group'}
            onClick={() => patch({ groupTargetMode: 'group' })}
            icon={<MessageCircle size={15} className="text-sky-600" aria-hidden="true" />}
            title="Chat do grupo"
            description="Uma única mensagem publicada na conversa de cada grupo selecionado."
          />
        </div>
      </div>

      {draft.groupTargetMode === 'members' && (
        <div>
          <label htmlFor="group-tag" className="flex items-center gap-1.5">
            <Tag size={13} className="text-emerald-600" aria-hidden="true" />
            Tags para os novos contatos criados
          </label>
          <input
            id="group-tag"
            type="text"
            value={draft.groupTagOnCreate}
            onChange={(e) => patch({ groupTagOnCreate: e.target.value })}
            placeholder="Ex: campanha-julho, leads-grupo"
            className="max-w-md"
          />
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-bold text-dark-800">
            Grupos ({draft.groupIds.length} de {groups.length} selecionados)
          </span>
          {groups.length > 0 && (
            <button
              type="button"
              onClick={() => patch({ groupIds: allSelected ? [] : groups.map((g) => g.id) })}
              className="text-xs font-bold text-brand-600 hover:text-brand-700"
            >
              {allSelected ? 'Desmarcar todos' : 'Selecionar todos'}
            </button>
          )}
        </div>

        <div className="max-h-56 divide-y divide-neutral-100 overflow-y-auto rounded-lg border border-neutral-200">
          {loading ? (
            <div className="flex flex-col items-center gap-2 p-8 text-neutral-500">
              <Loader2 size={18} className="animate-spin" aria-hidden="true" />
              <span className="text-xs font-medium">Carregando grupos das conexões selecionadas…</span>
            </div>
          ) : selectedWhatsapp.length === 0 ? (
            <p className="p-6 text-center text-xs text-neutral-500">
              Selecione ao menos uma conexão WhatsApp ativa no passo Canais para listar grupos.
            </p>
          ) : groups.length === 0 ? (
            <p className="p-6 text-center text-xs text-neutral-500">
              Nenhum grupo encontrado nas conexões selecionadas. Sincronize na aba Conexões.
            </p>
          ) : (
            groups.map((g) => {
              const selected = draft.groupIds.includes(g.id)
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() =>
                    patch({
                      groupIds: selected ? draft.groupIds.filter((id) => id !== g.id) : [...draft.groupIds, g.id],
                    })
                  }
                  className={`flex w-full items-center justify-between p-3 text-left transition-colors duration-150 hover:bg-neutral-50 ${
                    selected ? 'bg-brand-50/40' : ''
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    {selected ? (
                      <CheckSquare size={16} className="shrink-0 text-brand-600" aria-hidden="true" />
                    ) : (
                      <Square size={16} className="shrink-0 text-neutral-300" aria-hidden="true" />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-bold text-dark-800">{g.subject}</span>
                      <span className="block truncate font-mono text-[10px] text-neutral-500">
                        {g.id.includes('@') ? g.id.replace(/@.*$/, '') : g.id}
                      </span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {g.fromSaved && (
                      <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                        Salvo
                      </span>
                    )}
                    {g.size > 0 && (
                      <span className="rounded bg-neutral-100 px-2 py-0.5 text-[10px] font-bold text-neutral-600">
                        {g.size} {g.size === 1 ? 'membro' : 'membros'}
                      </span>
                    )}
                  </span>
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

function ModeCard({
  active,
  onClick,
  icon,
  title,
  badge,
  description,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  title: string
  badge?: string
  description: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg border p-3.5 text-left transition-colors duration-150 active:scale-[0.98] ${
        active ? 'border-brand-500 bg-neutral-0 ring-1 ring-brand-500' : 'border-neutral-200 hover:bg-neutral-50'
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-bold text-dark-800">
          {icon}
          {title}
        </span>
        {badge && (
          <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
            {badge}
          </span>
        )}
      </span>
      <span className="mt-1 block text-[11px] leading-relaxed text-neutral-600">{description}</span>
    </button>
  )
}

function ManualPane({
  draft,
  patch,
}: {
  draft: WizardDraft
  patch: (partial: Partial<WizardDraft>) => void
}) {
  function updateRow(index: number, field: 'name' | 'phone', value: string) {
    const rows = draft.manualRows.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    patch({ manualRows: rows })
  }

  return (
    <div>
      <p className="mb-3 text-sm font-bold text-dark-800">Para quem quer enviar?</p>
      <div className="space-y-2">
        {draft.manualRows.map((row, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              type="text"
              value={row.name}
              onChange={(e) => updateRow(index, 'name', e.target.value)}
              placeholder="Nome"
              aria-label={`Nome do contato ${index + 1}`}
            />
            <input
              type="tel"
              value={row.phone}
              onChange={(e) => updateRow(index, 'phone', e.target.value)}
              placeholder="+55 (11) 91234-5678"
              aria-label={`Número do contato ${index + 1}`}
            />
            <button
              type="button"
              onClick={() => patch({ manualRows: draft.manualRows.filter((_, i) => i !== index) })}
              disabled={draft.manualRows.length === 1}
              className="grid size-9 shrink-0 place-items-center rounded-md text-neutral-400 transition-colors duration-150 hover:bg-error-500/10 hover:text-error-500 disabled:opacity-30"
              aria-label={`Remover contato ${index + 1}`}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => patch({ manualRows: [...draft.manualRows, { name: '', phone: '' }] })}
        className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-brand-600 hover:text-brand-700"
      >
        <Plus size={14} aria-hidden="true" />
        Adicionar número
      </button>
      <p className="mt-3 text-[11px] text-neutral-500">
        Os números são salvos como contatos do workspace com a tag <code className="rounded bg-neutral-100 px-1 font-mono">origem:manual</code>.
      </p>
    </div>
  )
}

function FilePane({ file, setFile }: { file: File | null; setFile: (f: File | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={`flex w-full max-w-lg flex-col items-center gap-2 rounded-lg border-2 border-dashed p-8 transition-colors duration-150 ${
          file ? 'border-brand-300 bg-brand-50/40' : 'border-neutral-300 hover:border-brand-300 hover:bg-neutral-50'
        }`}
      >
        <FileSpreadsheet size={28} className={file ? 'text-brand-500' : 'text-neutral-400'} aria-hidden="true" />
        {file ? (
          <>
            <span className="text-sm font-bold text-dark-800">{file.name}</span>
            <span className="text-xs text-neutral-500">{(file.size / 1024).toFixed(0)} KB · clique para trocar</span>
          </>
        ) : (
          <>
            <span className="text-sm font-bold text-dark-800">Carregar arquivo com seus leads</span>
            <span className="text-xs text-neutral-500">CSV ou XLSX com cabeçalho (colunas nome e telefone)</span>
          </>
        )}
      </button>
      {file && (
        <button
          type="button"
          onClick={() => {
            setFile(null)
            if (inputRef.current) inputRef.current.value = ''
          }}
          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-neutral-500 hover:text-error-500"
        >
          <Trash2 size={12} aria-hidden="true" />
          Remover arquivo
        </button>
      )}
      <p className="mt-3 max-w-lg text-[11px] leading-relaxed text-neutral-500">
        Os contatos do arquivo são importados para o workspace com uma tag própria. A campanha usa essa tag
        como público. Duplicados são reaproveitados, não recriados.
      </p>
    </div>
  )
}
