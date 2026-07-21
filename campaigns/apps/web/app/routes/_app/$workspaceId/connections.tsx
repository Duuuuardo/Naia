import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import QRCode from 'react-qr-code'
import {
  ArrowLeft,
  Check,
  CheckSquare,
  FolderPlus,
  Info,
  KeyRound,
  Loader2,
  MessageCircle,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Send,
  Smartphone,
  Square,
  Tag,
  Trash2,
  TriangleAlert,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import {
  fetchConnections,
  createTelegramUserConnection,
  createWhatsAppConnection,
  deleteConnection,
  reconnectWhatsApp,
  submitTelegramLoginCode,
  submitTelegramLoginPassword,
  fetchConnectionContactsSync,
  fetchConnectionGroupsSync,
  importConnectionContacts,
  importConnectionGroups,
  importGroupMembers,
} from '../../../lib/actions'
import { Button, StatusBadge, ChannelBadge, formatChannelName } from '../../../components/ui'
import { createHeadConfig } from '../../lib/seo'

export const Route = createFileRoute('/_app/$workspaceId/connections')({ head: () => createHeadConfig('Conexões — Naia Campanhas'),
  loader: ({ params }) => fetchConnections({ data: params.workspaceId }),
  component: ConnectionsPage,
})

const channelIcon = {
  telegram: Send,
  whatsapp: MessageCircle,
} as const

interface PlatformOption {
  id: 'whatsapp' | 'telegram_user'
  name: string
  channel: string
  description: string
  icon: typeof MessageCircle
}

const PLATFORMS: PlatformOption[] = [
  {
    id: 'whatsapp',
    name: 'WhatsApp Business / Pessoal',
    channel: 'Sessão Multi-Device (QR Code)',
    description: 'Disparo automatizado de mensagens e campanhas através de pareamento seguro por QR Code.',
    icon: MessageCircle,
  },
  {
    id: 'telegram_user',
    name: 'Telegram Conta Pessoal',
    channel: 'Login por Telefone (código no app)',
    description: 'Dispare campanhas pela sua própria conta do Telegram. Informe o número, confirme o código recebido no app e pronto.',
    icon: Send,
  },
]

function ConnectionsPage() {
  const connections = Route.useLoaderData()
  const { workspaceId } = Route.useParams()
  const router = useRouter()

  const [adding, setAdding] = useState(false)
  const [step, setStep] = useState<'platform' | 'form'>('platform')
  const [selectedChannel, setSelectedChannel] = useState<'whatsapp' | 'telegram_user' | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Modals de importação
  const [activeImportContactsConn, setActiveImportContactsConn] = useState<{ id: string; name: string; channel: string } | null>(null)
  const [activeImportGroupsConn, setActiveImportGroupsConn] = useState<{ id: string; name: string; channel: string } | null>(null)

  useEffect(() => {
    const hasWaitingWhatsApp = connections.some(
      (c) =>
        (c.channel === 'whatsapp' || (c as any).kind === 'user') &&
        (c.status !== 'active' || (c as any).socketStatus !== 'connected'),
    )
    if (!hasWaitingWhatsApp && !adding) return

    const interval = setInterval(() => {
      router.invalidate()
    }, 2500)

    return () => clearInterval(interval)
  }, [connections, adding, router])

  async function refresh() {
    await router.invalidate()
  }

  function handleStartAdd() {
    setAdding(true)
    setStep('platform')
    setSelectedChannel(null)
    setName('')
    setPhone('')
    setError(null)
  }

  function handleSelectPlatform(plat: PlatformOption) {
    setSelectedChannel(plat.id)
    setStep('form')
    setError(null)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedChannel) return
    setSaving(true)
    setError(null)
    const result = selectedChannel === 'telegram_user'
      ? await createTelegramUserConnection({ data: { workspaceId, name, phone } })
      : await createWhatsAppConnection({ data: { workspaceId, name } })
    setSaving(false)
    if (result && 'error' in result) {
      setError(result.error ?? 'Erro inesperado ao conectar.')
      return
    }
    setName('')
    setPhone('')
    setSelectedChannel(null)
    setAdding(false)
    await refresh()
  }

  async function handleDelete(connectionId: string) {
    await deleteConnection({ data: { workspaceId, connectionId } })
    await refresh()
  }

  async function handleReconnect(connectionId: string) {
    await reconnectWhatsApp({ data: { workspaceId, connectionId } })
    await refresh()
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-20">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-neutral-200 pb-5">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-dark-800 tracking-tight">
            Canais & Conexões
          </h1>
          <p className="text-sm text-neutral-500 mt-1 max-w-xl">
            Conecte e gerencie seus números de WhatsApp, contas pessoais e bots do Telegram, sincronize contatos e importe grupos para disparos.
          </p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0 w-full md:w-auto">
          {!adding && (
            <Button className="w-full md:w-auto" icon={Plus} onClick={handleStartAdd}>
              Adicionar Canal
            </Button>
          )}
        </div>
      </div>

      {/* Add Connection Drawer */}
      {adding && (
        <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-2xs space-y-6 animate-in">
          {step === 'platform' && (
            <div>
              <div className="flex items-center justify-between border-b border-neutral-100 pb-4 mb-5">
                <div>
                  <h2 className="font-display text-base font-bold text-dark-800">
                    Selecione a plataforma para conectar
                  </h2>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Apenas canais nativos suportados pelo motor de envio em tempo real
                  </p>
                </div>
                <button onClick={() => setAdding(false)} className="text-neutral-400 hover:text-dark-800">
                  <X size={18} />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
                {PLATFORMS.map((plat) => {
                  const Icon = plat.icon
                  const chipStyle =
                    plat.id === 'whatsapp'
                      ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                      : 'bg-sky-50 text-sky-600 border-sky-200'
                  return (
                    <div
                      key={plat.id}
                      onClick={() => handleSelectPlatform(plat)}
                      className="group cursor-pointer rounded-2xl border border-neutral-200 bg-neutral-50/50 hover:bg-white hover:border-dark-800 p-5 transition-all shadow-2xs flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <span className={`grid size-11 place-items-center rounded-xl border ${chipStyle}`}>
                            <Icon size={22} />
                          </span>
                          <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-neutral-100 text-neutral-600 group-hover:bg-dark-800 group-hover:text-white transition-colors">
                            Conectar ›
                          </span>
                        </div>
                        <h3 className="font-bold text-dark-800 text-base">{plat.name}</h3>
                        <p className="text-xs font-mono text-neutral-400 mt-0.5">{plat.channel}</p>
                        <p className="text-xs text-neutral-600 mt-3 leading-relaxed">{plat.description}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {step === 'form' && selectedChannel && (
            <div>
              <div className="flex items-center justify-between border-b border-neutral-100 pb-4 mb-5">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setStep('platform')}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-neutral-500 hover:text-dark-800 transition-colors"
                  >
                    <ArrowLeft size={16} /> Voltar
                  </button>
                  <div className="h-4 w-px bg-neutral-200" />
                  <h2 className="font-display text-base font-bold text-dark-800 flex items-center gap-2">
                    {selectedChannel === 'whatsapp' ? (
                      <MessageCircle size={18} className="text-emerald-600" />
                    ) : (
                      <Send size={18} className="text-sky-500" />
                    )}
                    <span>
                      Configurar {selectedChannel === 'whatsapp' ? 'WhatsApp' : 'Conta do Telegram'}
                    </span>
                  </h2>
                </div>
                <button onClick={() => setAdding(false)} className="text-neutral-400 hover:text-dark-800">
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleCreate} className="space-y-4 max-w-xl">
                <div>
                  <label htmlFor="conn-name" className="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1.5">
                    Nome de identificação *
                  </label>
                  <input
                    id="conn-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={
                      selectedChannel === 'whatsapp'
                        ? 'Ex: WhatsApp Comercial (+55 11...)'
                        : 'Ex: Telegram Pessoal (+55 11...)'
                    }
                    className="w-full h-10 px-3.5 rounded-xl border border-neutral-200 text-sm font-medium focus:border-dark-800 outline-none transition-all"
                    required
                  />
                  <p className="text-xs text-neutral-400 mt-1">
                    Nome exibido na hora de selecionar o canal durante a criação de campanhas.
                  </p>
                </div>

                {selectedChannel === 'telegram_user' && (
                  <>
                    <div>
                      <label htmlFor="conn-phone" className="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1.5">
                        Número do Telegram (com DDI) *
                      </label>
                      <input
                        id="conn-phone"
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="Ex: +5511999999999"
                        className="w-full h-10 px-3.5 rounded-xl border border-neutral-200 text-sm font-mono focus:border-dark-800 outline-none transition-all"
                        required
                      />
                      <p className="text-xs text-neutral-400 mt-1">
                        O código de confirmação chega no app do Telegram deste número.
                      </p>
                    </div>

                    <div className="flex items-start gap-3 rounded-xl bg-neutral-50 border border-neutral-200 p-3.5 text-xs text-neutral-700">
                      <Info size={16} className="text-sky-600 shrink-0 mt-0.5" />
                      <div>
                        <strong className="font-bold text-dark-800">Login pela sua conta:</strong> Ao salvar, o Telegram envia um código de confirmação no app deste número. Digite o código (e a senha de duas etapas, se houver) na tela seguinte para conectar.
                      </div>
                    </div>
                  </>
                )}

                {selectedChannel === 'whatsapp' && (
                  <div className="flex items-start gap-3 rounded-xl bg-neutral-50 border border-neutral-200 p-3.5 text-xs text-neutral-700">
                    <Info size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <strong className="font-bold text-dark-800">Sincronização por QR Code:</strong> Ao clicar em salvar, iniciaremos a sessão multi-device. O QR Code aparecerá na tela para pareamento instantâneo pelo celular.
                    </div>
                  </div>
                )}

                {error && (
                  <div className="rounded-xl bg-error-50 border border-error-200 p-3 text-xs text-error-700 font-semibold flex items-center gap-2">
                    <TriangleAlert size={15} />
                    <span>{error}</span>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-3 border-t border-neutral-100">
                  <button
                    type="button"
                    onClick={() => setAdding(false)}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-neutral-500 hover:bg-neutral-100 transition-colors"
                  >
                    Cancelar
                  </button>
                  <Button type="submit" loading={saving}>
                    Conectar {selectedChannel === 'whatsapp' ? 'WhatsApp' : 'Conta Telegram'}
                  </Button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {/* Active & Pending Connections List */}
      {connections.length === 0 && !adding ? (
        <div className="rounded-2xl border border-neutral-200 bg-white p-16 text-center space-y-3 shadow-2xs">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-neutral-100 text-dark-800">
            <Plug size={22} />
          </div>
          <p className="font-bold text-dark-800 text-sm">Nenhum canal conectado no momento</p>
          <p className="text-xs text-neutral-400 max-w-sm mx-auto">
            Adicione uma conexão do WhatsApp ou Telegram para habilitar o envio automatizado de mensagens e importação de grupos.
          </p>
          <div className="pt-2">
            <Button icon={Plus} onClick={handleStartAdd}>
              Adicionar Canal
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {connections.map((c) => {
            const isTgUser = (c as any).kind === 'user'
            const Icon = channelIcon[c.channel as keyof typeof channelIcon] ?? Plug
            const isWa = c.channel === 'whatsapp'
            const isWhatsAppWaiting = isWa && c.status !== 'active'
            const isTgUserWaiting = isTgUser && c.status !== 'active'
            const isReconnecting =
              (isWa || isTgUser) && c.status === 'active' && (c as any).socketStatus !== 'connected'

            return (
              <div
                key={c.id}
                className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-2xs transition-all space-y-5"
              >
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-3.5">
                    <span
                      className={`grid size-11 shrink-0 place-items-center rounded-xl border ${
                        isWa
                          ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                          : isTgUser
                            ? 'bg-sky-50 text-sky-600 border-sky-200'
                            : 'bg-blue-50 text-blue-600 border-blue-200'
                      }`}
                    >
                      <Icon size={22} />
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-dark-800 text-base">{c.name}</span>
                        <ChannelBadge channel={c.channel} />
                        {c.channel === 'telegram' && (
                          <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-sky-600 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded">
                            conta
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <StatusBadge status={c.status} />
                        {isReconnecting ? (
                          <span className="text-xs text-warning-600 font-semibold flex items-center gap-1">
                            <Loader2 size={12} className="animate-spin" />
                            Reconectando...
                          </span>
                        ) : isWa && c.status === 'active' ? (
                          <span className="text-xs text-success-600 font-semibold flex items-center gap-1">
                            • Pareado e Sincronizado
                          </span>
                        ) : null}
                      </div>
                      {c.lastErrorMessage && (
                        <div className="mt-2.5 inline-flex items-center gap-1.5 text-xs text-error-600 bg-error-50 px-2.5 py-1 rounded-md border border-error-200 font-medium">
                          <TriangleAlert size={13} className="shrink-0" />
                          <span>{c.lastErrorMessage}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 self-end sm:self-center">
                    {c.status === 'active' && (
                      <>
                        <button
                          onClick={() => setActiveImportContactsConn({ id: c.id, name: c.name, channel: c.channel })}
                          className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold text-dark-800 bg-neutral-100 hover:bg-neutral-200 transition-colors shadow-2xs border border-neutral-200/80"
                        >
                          <UserPlus size={14} className="text-emerald-600" />
                          Importar Contatos
                        </button>
                        <button
                          onClick={() => setActiveImportGroupsConn({ id: c.id, name: c.name, channel: c.channel })}
                          className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold text-dark-800 bg-neutral-100 hover:bg-neutral-200 transition-colors shadow-2xs border border-neutral-200/80"
                        >
                          <Users size={14} className="text-blue-600" />
                          Importar Grupos
                        </button>
                      </>
                    )}
                    {(isWa || isTgUser) && (
                      <button
                        onClick={() => handleReconnect(c.id)}
                        className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-dark-800 bg-neutral-100 hover:bg-neutral-200 transition-colors"
                      >
                        <RefreshCw size={14} />
                        Reconectar
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(c.id)}
                      className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-neutral-400 hover:text-error-600 hover:bg-error-50 transition-colors"
                    >
                      <Trash2 size={14} />
                      Remover
                    </button>
                  </div>
                </div>

                {/* WhatsApp QR Pairing Box */}
                {isWhatsAppWaiting && (
                  <div className="pt-5 border-t border-neutral-100">
                    <div className="rounded-xl border border-neutral-200 bg-neutral-50/70 p-5 flex flex-col md:flex-row items-center gap-6">
                      {c.qr ? (
                        <div className="flex flex-col items-center shrink-0 bg-white p-4 rounded-xl border border-neutral-200 shadow-2xs">
                          <QRCode value={c.qr} size={160} />
                          <span className="mt-2 text-[11px] font-bold text-emerald-600 flex items-center gap-1.5">
                            <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                            Aguardando Leitura
                          </span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center shrink-0 w-[194px] h-[194px] bg-white rounded-xl border border-neutral-200 p-4 text-center">
                          <span className="size-7 animate-spin rounded-full border-2 border-dark-800 border-t-transparent mb-3" />
                          <p className="text-xs font-bold text-dark-800">Gerando QR Code...</p>
                          <p className="text-[11px] text-neutral-400 mt-1">Conectando com o servidor de sessão.</p>
                        </div>
                      )}

                      <div className="space-y-3 flex-1">
                        <div className="flex items-center gap-2 text-dark-800 font-bold text-sm">
                          <MessageCircle size={16} className="text-emerald-600" />
                          <span>Instruções de Pareamento WhatsApp:</span>
                        </div>
                        <ol className="text-xs text-neutral-600 space-y-2 list-decimal list-inside leading-relaxed bg-white p-3.5 rounded-xl border border-neutral-200/80 font-medium">
                          <li>Abra o aplicativo <strong>WhatsApp</strong> no seu smartphone.</li>
                          <li>Toque nas <strong>Configurações</strong> ou no menu <strong>Mais opções (⋮)</strong>.</li>
                          <li>Selecione <strong>Dispositivos Conectados</strong> e clique em <strong>Conectar um aparelho</strong>.</li>
                          <li>Aponte a câmera para o código QR à esquerda.</li>
                        </ol>
                      </div>
                    </div>
                  </div>
                )}

                {/* Telegram Account Login Box */}
                {isTgUserWaiting && (
                  <TelegramLoginBox
                    workspaceId={workspaceId}
                    connectionId={c.id}
                    auth={(c as any).telegramAuth ?? null}
                    onRefresh={refresh}
                    onRetry={() => handleReconnect(c.id)}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Modal de Importar Contatos */}
      {activeImportContactsConn && (
        <ImportContactsModal
          workspaceId={workspaceId}
          connection={activeImportContactsConn}
          onClose={() => setActiveImportContactsConn(null)}
          onImported={refresh}
        />
      )}

      {/* Modal de Importar Grupos */}
      {activeImportGroupsConn && (
        <ImportGroupsModal
          workspaceId={workspaceId}
          connection={activeImportGroupsConn}
          onClose={() => setActiveImportGroupsConn(null)}
          onImported={refresh}
        />
      )}
    </div>
  )
}

// ─── Caixa de Login da Conta do Telegram (código + senha 2FA) ────────────────

function TelegramLoginBox({
  workspaceId,
  connectionId,
  auth,
  onRefresh,
  onRetry,
}: {
  workspaceId: string
  connectionId: string
  auth: { phase: 'connecting' | 'awaiting_code' | 'awaiting_password' | 'error'; error: string | null } | null
  onRefresh: () => Promise<void>
  onRetry: () => void
}) {
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const phase = auth?.phase ?? 'connecting'
  const serverError = auth?.error ?? null

  async function handleSubmitCode(e: React.FormEvent) {
    e.preventDefault()
    if (!code.trim()) return
    setSubmitting(true)
    setLocalError(null)
    const res = await submitTelegramLoginCode({ data: { workspaceId, connectionId, code: code.trim() } })
    setSubmitting(false)
    if (res && 'error' in res && res.error) {
      setLocalError(res.error)
      return
    }
    setCode('')
    await onRefresh()
  }

  async function handleSubmitPassword(e: React.FormEvent) {
    e.preventDefault()
    if (!password) return
    setSubmitting(true)
    setLocalError(null)
    const res = await submitTelegramLoginPassword({ data: { workspaceId, connectionId, password } })
    setSubmitting(false)
    if (res && 'error' in res && res.error) {
      setLocalError(res.error)
      return
    }
    setPassword('')
    await onRefresh()
  }

  const errorMsg = localError ?? serverError

  return (
    <div className="pt-5 border-t border-neutral-100">
      <div className="rounded-xl border border-neutral-200 bg-neutral-50/70 p-5 flex flex-col md:flex-row items-center gap-6">
        <div className="flex flex-col justify-center shrink-0 w-full md:w-[280px] min-h-[194px] bg-white rounded-xl border border-neutral-200 p-5">
          {phase === 'connecting' && (
            <div className="flex flex-col items-center text-center gap-3">
              <span className="size-7 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
              <p className="text-xs font-bold text-dark-800">Conectando ao Telegram...</p>
              <p className="text-[11px] text-neutral-400">Validando os dados com o servidor de sessão.</p>
            </div>
          )}

          {phase === 'awaiting_code' && (
            <form onSubmit={handleSubmitCode} className="space-y-3">
              <div className="flex items-center gap-2 text-dark-800 font-bold text-xs">
                <Smartphone size={15} className="text-sky-600" />
                <span>Código de confirmação</span>
              </div>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="• • • • •"
                className="w-full h-11 px-3.5 rounded-xl border border-neutral-200 text-center text-lg font-mono font-bold tracking-[0.4em] focus:border-sky-500 outline-none transition-all"
                autoFocus
              />
              <Button type="submit" loading={submitting} disabled={!code.trim()} className="w-full">
                Confirmar código
              </Button>
            </form>
          )}

          {phase === 'awaiting_password' && (
            <form onSubmit={handleSubmitPassword} className="space-y-3">
              <div className="flex items-center gap-2 text-dark-800 font-bold text-xs">
                <KeyRound size={15} className="text-sky-600" />
                <span>Senha de duas etapas (2FA)</span>
              </div>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Sua senha do Telegram"
                className="w-full h-11 px-3.5 rounded-xl border border-neutral-200 text-sm focus:border-sky-500 outline-none transition-all"
                autoFocus
              />
              <Button type="submit" loading={submitting} disabled={!password} className="w-full">
                Confirmar senha
              </Button>
            </form>
          )}

          {phase === 'error' && (
            <div className="flex flex-col items-center text-center gap-3">
              <span className="grid size-9 place-items-center rounded-xl bg-error-50 text-error-600 border border-error-200">
                <TriangleAlert size={18} />
              </span>
              <p className="text-xs font-bold text-error-700">{errorMsg ?? 'Falha no login do Telegram.'}</p>
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-dark-800 bg-neutral-100 hover:bg-neutral-200 transition-colors"
              >
                <RefreshCw size={14} />
                Tentar novamente
              </button>
            </div>
          )}

          {errorMsg && phase !== 'error' && (
            <p className="mt-3 text-[11px] font-bold text-error-600 flex items-center gap-1.5">
              <TriangleAlert size={13} className="shrink-0" />
              <span>{errorMsg}</span>
            </p>
          )}
        </div>

        <div className="space-y-3 flex-1">
          <div className="flex items-center gap-2 text-dark-800 font-bold text-sm">
            <Send size={16} className="text-sky-600" />
            <span>Instruções de Login do Telegram:</span>
          </div>
          <ol className="text-xs text-neutral-600 space-y-2 list-decimal list-inside leading-relaxed bg-white p-3.5 rounded-xl border border-neutral-200/80 font-medium">
            <li>Abra o <strong>Telegram</strong> no celular (ou desktop) da conta informada.</li>
            <li>Você vai receber um <strong>código de login</strong> na conversa oficial "Telegram".</li>
            <li>Digite o código no campo ao lado e confirme.</li>
            <li>Se a conta tiver <strong>senha de duas etapas</strong>, informe-a quando for pedida.</li>
          </ol>
        </div>
      </div>
    </div>
  )
}

// ─── Modal de Importar Contatos da Conexão ───────────────────────────────────

function ImportContactsModal({
  workspaceId,
  connection,
  onClose,
  onImported,
}: {
  workspaceId: string
  connection: { id: string; name: string; channel: string }
  onClose: () => void
  onImported: () => Promise<void>
}) {
  const [loading, setLoading] = useState(true)
  const [contactsList, setContactsList] = useState<Array<{ id: string; name: string; phone: string; avatarUrl?: string | null }>>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [tagsInput, setTagsInput] = useState('origem:conexao')
  const [importing, setImporting] = useState(false)
  const [resultMsg, setResultMsg] = useState<string | null>(null)

  useEffect(() => {
    fetchConnectionContactsSync({ data: { workspaceId, connectionId: connection.id } })
      .then((res) => {
        if ('error' in res && res.error) {
          setResultMsg(res.error)
        } else if ('contacts' in res && res.contacts) {
          setContactsList(res.contacts)
          setSelected(new Set(res.contacts.map((c: any) => c.phone || c.id)))
        }
      })
      .finally(() => setLoading(false))
  }, [workspaceId, connection.id])

  const filtered = contactsList.filter((c) => {
    if (!search) return true
    const q = search.toLowerCase()
    return c.name.toLowerCase().includes(q) || c.phone.includes(q)
  })

  function handleToggleAll() {
    if (selected.size === filtered.length && filtered.length > 0) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map((c) => c.phone || c.id)))
    }
  }

  function handleToggleOne(phoneOrId: string) {
    const next = new Set(selected)
    if (next.has(phoneOrId)) next.delete(phoneOrId)
    else next.add(phoneOrId)
    setSelected(next)
  }

  async function handleImport() {
    if (selected.size === 0) return
    setImporting(true)
    setResultMsg(null)

    const toImport = contactsList
      .filter((c) => selected.has(c.phone || c.id))
      .map((c) => ({
        name: c.name,
        phoneOrId: c.phone || c.id,
        avatarUrl: c.avatarUrl || null,
      }))

    const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean)

    const res = await importConnectionContacts({
      data: {
        workspaceId,
        connectionId: connection.id,
        contacts: toImport,
        tags,
      },
    })

    setImporting(false)
    if (res && 'error' in res && res.error) {
      setResultMsg(res.error)
    } else if (res && 'importedCount' in res) {
      setResultMsg(`Sucesso! ${res.importedCount} novos contatos importados, ${res.updatedCount} atualizados.`)
      await onImported()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in">
      <div className="bg-white rounded-3xl border border-neutral-200 shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden">
        <div className="p-5 border-b border-neutral-100 flex items-center justify-between bg-neutral-50/50 shrink-0">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200">
              <UserPlus size={20} />
            </span>
            <div>
              <h3 className="font-display font-extrabold text-base text-dark-800">
                Importar Contatos da Conexão
              </h3>
              <p className="text-xs text-neutral-500">
                {connection.name} • Sincronizado do aparelho/sessão
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-dark-800 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 flex-1 overflow-y-auto space-y-4 min-h-0">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome ou número..."
                className="w-full h-10 pl-9 pr-3 rounded-xl border border-neutral-200 text-xs focus:border-dark-800 outline-none transition-all"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleToggleAll}
                className="px-3.5 h-10 rounded-xl text-xs font-bold text-dark-800 bg-neutral-100 hover:bg-neutral-200 transition-colors shrink-0"
              >
                {selected.size === filtered.length && filtered.length > 0 ? 'Desmarcar Todos' : 'Selecionar Todos'}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-200 overflow-hidden bg-white">
            {loading ? (
              <div className="p-12 text-center flex flex-col items-center justify-center text-neutral-400 gap-2">
                <Loader2 size={24} className="animate-spin text-dark-800" />
                <span className="text-xs font-bold text-dark-800">Lendo contatos do aparelho...</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-10 text-center text-xs text-neutral-500 font-medium space-y-2">
                {contactsList.length === 0 ? (
                  <>
                    <p className="font-bold text-neutral-600">Nenhum contato carregado na sessão ainda.</p>
                    <p className="max-w-sm mx-auto leading-relaxed">O cache de contatos é populado em tempo real pelo WhatsApp após a sessão conectar. Aguarde alguns segundos e reabra este modal, ou comece a conversar via WhatsApp para acionar a sincronização.</p>
                  </>
                ) : (
                  <p>Nenhum contato corresponde à busca.</p>
                )}
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto divide-y divide-neutral-100 text-xs">
                {filtered.map((c) => {
                  const key = c.phone || c.id
                  const isSel = selected.has(key)
                  return (
                    <div
                      key={key}
                      onClick={() => handleToggleOne(key)}
                      className={`flex items-center justify-between p-3.5 cursor-pointer hover:bg-neutral-50 transition-colors ${
                        isSel ? 'bg-emerald-50/30' : ''
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-neutral-600">
                          {isSel ? (
                            <CheckSquare size={18} className="text-emerald-600" />
                          ) : (
                            <Square size={18} className="text-neutral-300" />
                          )}
                        </span>
                        {c.avatarUrl ? (
                          <img src={c.avatarUrl} alt={c.name} className="size-8 rounded-full object-cover shrink-0" />
                        ) : (
                          <div className="size-8 rounded-full bg-neutral-100 flex items-center justify-center font-bold text-xs text-neutral-600 shrink-0">
                            {c.name.substring(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <p className="font-bold text-dark-800 text-sm">{c.name}</p>
                          <p className="font-mono text-[11px] text-neutral-400 mt-0.5">
                            {connection.channel === 'whatsapp' ? `+${c.phone}` : c.phone}
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-neutral-600 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <Tag size={14} className="text-neutral-400" />
              Tags para aplicar aos contatos importados
            </label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="Ex: origem:whatsapp, clientes-2026 (separados por vírgula)"
              className="w-full h-10 px-3.5 rounded-xl border border-neutral-200 text-xs font-medium focus:border-dark-800 outline-none transition-all"
            />
          </div>

          {resultMsg && (
            <div
              className={`rounded-xl p-3 text-xs font-bold ${
                resultMsg.includes('Sucesso')
                  ? 'bg-success-50 border border-success-200 text-success-800'
                  : 'bg-error-50 border border-error-200 text-error-800'
              }`}
            >
              {resultMsg}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-neutral-100 flex items-center justify-between bg-neutral-50/50 shrink-0">
          <span className="text-xs font-bold text-neutral-500">
            {selected.size} contatos selecionados
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-bold text-neutral-500 hover:bg-neutral-100 transition-colors"
            >
              Fechar
            </button>
            <Button onClick={handleImport} loading={importing} disabled={selected.size === 0 || loading}>
              Importar {selected.size > 0 ? `${selected.size} contatos` : ''}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Modal de Importar Grupos da Conexão ─────────────────────────────────────

function ImportGroupsModal({
  workspaceId,
  connection,
  onClose,
  onImported,
}: {
  workspaceId: string
  connection: { id: string; name: string; channel: string }
  onClose: () => void
  onImported: () => Promise<void>
}) {
  const [loading, setLoading] = useState(true)
  const [groupsList, setGroupsList] = useState<Array<{
    id: string
    subject: string
    size: number
    desc?: string
    participants?: Array<{ id: string; admin?: string | null }>
  }>>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [tagsInput, setTagsInput] = useState('grupo')
  const [importing, setImporting] = useState(false)
  const [importingMembersFor, setImportingMembersFor] = useState<string | null>(null)
  const [resultMsg, setResultMsg] = useState<string | null>(null)

  useEffect(() => {
    fetchConnectionGroupsSync({ data: { workspaceId, connectionId: connection.id } })
      .then((res) => {
        if ('error' in res && res.error) {
          setResultMsg(res.error)
        } else if ('groups' in res && res.groups) {
          setGroupsList(res.groups)
          setSelected(new Set(res.groups.map((g: any) => g.id)))
        }
      })
      .finally(() => setLoading(false))
  }, [workspaceId, connection.id])

  const filtered = groupsList.filter((g) => {
    if (!search) return true
    const q = search.toLowerCase()
    return g.subject.toLowerCase().includes(q) || g.id.includes(q) || (g.desc && g.desc.toLowerCase().includes(q))
  })

  function handleToggleAll() {
    if (selected.size === filtered.length && filtered.length > 0) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map((g) => g.id)))
    }
  }

  function handleToggleOne(groupId: string) {
    const next = new Set(selected)
    if (next.has(groupId)) next.delete(groupId)
    else next.add(groupId)
    setSelected(next)
  }

  async function handleImportGroups() {
    if (selected.size === 0) return
    setImporting(true)
    setResultMsg(null)

    const toImport = groupsList.filter((g) => selected.has(g.id))
    const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean)

    const res = await importConnectionGroups({
      data: {
        workspaceId,
        connectionId: connection.id,
        groups: toImport,
        tags,
      },
    })

    setImporting(false)
    if (res && 'error' in res && res.error) {
      setResultMsg(res.error)
    } else if (res && 'importedGroupsCount' in res) {
      setResultMsg(`Sucesso! ${res.importedGroupsCount} grupos salvos no Campaigns para envio de campanhas.`)
      await onImported()
    }
  }

  async function handleImportGroupMembersNow(g: { id: string; subject: string }) {
    setImportingMembersFor(g.id)
    setResultMsg(null)

    const tags = Array.from(new Set(['origem:grupo', ...tagsInput.split(',').map((t) => t.trim()).filter(Boolean)]))

    const res = await importGroupMembers({
      data: {
        workspaceId,
        connectionId: connection.id,
        groupJid: g.id,
        tags,
      },
    })

    setImportingMembersFor(null)
    if (res && 'error' in res && res.error) {
      setResultMsg(`Erro no grupo "${g.subject}": ${res.error}`)
    } else if (res && 'importedMembersCount' in res) {
      const warning = 'warning' in res && res.warning ? `\n⚠️ ${res.warning}` : ''
      setResultMsg(`Sucesso! ${res.importedMembersCount} novos membros do grupo "${g.subject}" importados como contatos individuais.${warning}`)
      await onImported()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in">
      <div className="bg-white rounded-3xl border border-neutral-200 shadow-xl max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden">
        <div className="p-5 border-b border-neutral-100 flex items-center justify-between bg-neutral-50/50 shrink-0">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-blue-600 border border-blue-200">
              <FolderPlus size={20} />
            </span>
            <div>
              <h3 className="font-display font-extrabold text-base text-dark-800">
                Importar Grupos da Conexão
              </h3>
              <p className="text-xs text-neutral-500">
                {connection.name} • Sincronizado do WhatsApp/Telegram
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-dark-800 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 flex-1 overflow-y-auto space-y-4 min-h-0">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome ou descrição do grupo..."
                className="w-full h-10 pl-9 pr-3 rounded-xl border border-neutral-200 text-xs focus:border-dark-800 outline-none transition-all"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleToggleAll}
                className="px-3.5 h-10 rounded-xl text-xs font-bold text-dark-800 bg-neutral-100 hover:bg-neutral-200 transition-colors shrink-0"
              >
                {selected.size === filtered.length && filtered.length > 0 ? 'Desmarcar Todos' : 'Selecionar Todos'}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-200 overflow-hidden bg-white">
            {loading ? (
              <div className="p-12 text-center flex flex-col items-center justify-center text-neutral-400 gap-2">
                <Loader2 size={24} className="animate-spin text-dark-800" />
                <span className="text-xs font-bold text-dark-800">Consultando grupos no WhatsApp...</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-10 text-center text-xs text-neutral-500 font-medium">
                {groupsList.length === 0
                  ? 'Nenhum grupo encontrado nesta conta do WhatsApp ou Telegram.'
                  : 'Nenhum grupo corresponde à busca.'}
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto divide-y divide-neutral-100 text-xs">
                {filtered.map((g) => {
                  const isSel = selected.has(g.id)
                  const isImportingThisMembers = importingMembersFor === g.id
                  return (
                    <div
                      key={g.id}
                      className={`flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 gap-3 transition-colors ${
                        isSel ? 'bg-blue-50/30' : ''
                      }`}
                    >
                      <div
                        onClick={() => handleToggleOne(g.id)}
                        className="flex items-start gap-3 cursor-pointer flex-1"
                      >
                        <span className="text-neutral-600 mt-0.5">
                          {isSel ? (
                            <CheckSquare size={18} className="text-blue-600" />
                          ) : (
                            <Square size={18} className="text-neutral-300" />
                          )}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-bold text-dark-800 text-sm">{g.subject}</p>
                            <span className="text-[11px] font-bold bg-neutral-100 text-neutral-600 px-2 py-0.5 rounded-full">
                              {g.size} {g.size === 1 ? 'membro' : 'membros'}
                            </span>
                          </div>
                          {g.desc && (
                            <p className="text-[11px] text-neutral-500 line-clamp-1 mt-1 max-w-md">{g.desc}</p>
                          )}
                          <p className="font-mono text-[10px] text-neutral-400 mt-1">{g.id}</p>
                        </div>
                      </div>

                      <div className="shrink-0 self-end sm:self-center">
                        <button
                          type="button"
                          onClick={() => handleImportGroupMembersNow(g)}
                          disabled={isImportingThisMembers || loading}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-dark-800 bg-neutral-100 hover:bg-neutral-200 transition-colors border border-neutral-200"
                          title="Importar todos os membros individuais deste grupo agora"
                        >
                          {isImportingThisMembers ? (
                            <Loader2 size={14} className="animate-spin text-dark-800" />
                          ) : (
                            <UserPlus size={14} className="text-emerald-600" />
                          )}
                          <span>Importar Membros ({g.size})</span>
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-neutral-600 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <Tag size={14} className="text-neutral-400" />
              Tags para aplicar aos grupos importados
            </label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="Ex: grupo, comunidade, clientes (separados por vírgula)"
              className="w-full h-10 px-3.5 rounded-xl border border-neutral-200 text-xs font-medium focus:border-dark-800 outline-none transition-all"
            />
          </div>

          {resultMsg && (
            <div
              className={`rounded-xl p-3 text-xs font-bold ${
                resultMsg.includes('Sucesso')
                  ? 'bg-success-50 border border-success-200 text-success-800'
                  : 'bg-error-50 border border-error-200 text-error-800'
              }`}
            >
              {resultMsg}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-neutral-100 flex items-center justify-between bg-neutral-50/50 shrink-0">
          <span className="text-xs font-bold text-neutral-500">
            {selected.size} grupos selecionados para importação
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-bold text-neutral-500 hover:bg-neutral-100 transition-colors"
            >
              Fechar
            </button>
            <Button onClick={handleImportGroups} loading={importing} disabled={selected.size === 0 || loading}>
              Salvar Grupos no Campaigns ({selected.size})
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

