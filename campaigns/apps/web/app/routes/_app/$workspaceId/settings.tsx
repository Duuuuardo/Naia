import { createFileRoute, useLoaderData, useRouteContext, useRouter } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { Briefcase, Building2, Camera, CheckCircle2, Mail, MapPin, ShieldAlert, Trash2 } from 'lucide-react'
import { updateWorkspaceSettings, fetchNotificationPreferences, updateNotificationPreferences, type NotificationPreferences } from '../../../lib/actions'
import { Button, Card, ErrorNote, PageHeader } from '../../../components/ui'

export const Route = createFileRoute('/_app/$workspaceId/settings')({
  component: SettingsPage,
})

// Redimensiona a imagem no cliente pra caber com folga no limite da API.
async function fileToAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const size = 192
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const scale = Math.max(size / bitmap.width, size / bitmap.height)
  const w = bitmap.width * scale
  const h = bitmap.height * scale
  ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h)
  return canvas.toDataURL('image/jpeg', 0.85)
}

function SettingsPage() {
  const { workspace, permissions } = useLoaderData({ from: '/_app/$workspaceId' })
  const { workspaceId } = Route.useParams()
  const router = useRouter()

  const [name, setName] = useState(workspace.name)
  const [description, setDescription] = useState(('description' in workspace && workspace.description) || '')
  const [location, setLocation] = useState(('location' in workspace && workspace.location) || '')
  const [industry, setIndustry] = useState(('industry' in workspace && workspace.industry) || '')
  const [avatarUrl, setAvatarUrl] = useState<string>(
    ('avatarUrl' in workspace && (workspace.avatarUrl as string | null)) || '',
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  if (!permissions.settings) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center">
        <ShieldAlert size={32} className="mx-auto text-neutral-300" aria-hidden="true" />
        <h1 className="mt-4 text-lg font-bold text-dark-800">Sem acesso às configurações</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Seu papel neste workspace não inclui esta área. Fale com o Owner se precisar de acesso.
        </p>
      </div>
    )
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    try {
      setAvatarUrl(await fileToAvatarDataUrl(file))
    } catch {
      setError('Não foi possível ler a imagem. Tente outro arquivo.')
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSaved(false)

    const result = await updateWorkspaceSettings({
      data: { workspaceId, name, description, location, industry, avatarUrl },
    })

    setSaving(false)
    if ('error' in result) {
      setError(result.error ?? 'Erro ao salvar configurações.')
      return
    }
    setSaved(true)
    router.invalidate()
  }

  return (
    <div className="max-w-2xl mx-auto py-2 font-sans">
      <PageHeader
        title="Configurações do workspace"
        subtitle="Identidade e informações básicas deste workspace."
      />

      <form onSubmit={handleSave} className="mt-6 space-y-6">
        <Card className="p-5">
          <div className="flex flex-col sm:flex-row items-center sm:items-center gap-5">
            <div className="relative shrink-0">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="Avatar do workspace"
                  className="size-20 rounded-xl object-cover border border-neutral-200"
                />
              ) : (
                <div className="grid size-20 place-items-center rounded-xl bg-brand-50 border border-brand-100 text-2xl font-bold text-brand-600 uppercase">
                  {name[0] || '?'}
                </div>
              )}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                aria-label="Trocar avatar do workspace"
                className="absolute -bottom-1.5 -right-1.5 grid size-7 place-items-center rounded-full bg-dark-800 text-white shadow-sm hover:bg-dark-700 transition-colors"
              >
                <Camera size={13} aria-hidden="true" />
              </button>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-dark-800">Avatar do workspace</p>
              <p className="text-xs text-neutral-500 mt-0.5 leading-relaxed">
                Aparece no topo do app e ajuda a distinguir workspaces. PNG ou JPG, recortada em quadrado.
              </p>
              {avatarUrl && (
                <button
                  type="button"
                  onClick={() => setAvatarUrl('')}
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-neutral-500 hover:text-error-600 transition-colors"
                >
                  <Trash2 size={12} aria-hidden="true" />
                  Remover avatar
                </button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
          </div>
        </Card>

        <Card className="p-5 space-y-4">
          <div>
            <label htmlFor="ws-name" className="block text-sm font-semibold text-dark-800 mb-1.5">
              Nome
            </label>
            <input
              id="ws-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={1}
              className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-white text-sm text-dark-800 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none transition-colors"
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="ws-location" className="flex items-center gap-1.5 text-sm font-semibold text-dark-800 mb-1.5">
                <MapPin size={14} className="text-neutral-400" aria-hidden="true" />
                Localização
              </label>
              <input
                id="ws-location"
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="São Paulo, Brasil"
                className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-white text-sm text-dark-800 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none transition-colors"
              />
            </div>
            <div>
              <label htmlFor="ws-industry" className="flex items-center gap-1.5 text-sm font-semibold text-dark-800 mb-1.5">
                <Briefcase size={14} className="text-neutral-400" aria-hidden="true" />
                Área de atuação
              </label>
              <input
                id="ws-industry"
                type="text"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="Varejo, educação, serviços…"
                className="w-full h-10 px-3 rounded-md border border-neutral-300 bg-white text-sm text-dark-800 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none transition-colors"
              />
            </div>
          </div>

          <div>
            <label htmlFor="ws-description" className="flex items-center gap-1.5 text-sm font-semibold text-dark-800 mb-1.5">
              <Building2 size={14} className="text-neutral-400" aria-hidden="true" />
              Descrição
            </label>
            <textarea
              id="ws-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Ex: empresa, projeto ou time específico."
              className="w-full px-3 py-2 rounded-md border border-neutral-300 bg-white text-sm text-dark-800 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none transition-colors resize-none"
            />
          </div>
        </Card>

        {error && <ErrorNote>{error}</ErrorNote>}
        {saved && (
          <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-3.5 py-2.5 text-sm font-medium text-success-600">
            <CheckCircle2 size={15} aria-hidden="true" />
            Configurações salvas.
          </div>
        )}

        <div className="flex justify-end">
          <Button type="submit" loading={saving}>
            Salvar alterações
          </Button>
        </div>
      </form>

      <NotificationPreferencesSection workspaceId={workspaceId} />
    </div>
  )
}

function NotificationPreferencesSection({ workspaceId }: { workspaceId: string }) {
  const { user } = useRouteContext({ from: '/_app' })
  const { workspace } = useLoaderData({ from: '/_app/$workspaceId' })
  const isOwner = workspace.ownerUserId === user.id
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    if (!isOwner) return
    fetchNotificationPreferences({ data: workspaceId })
      .then(setPreferences)
      .catch(() => setPreferences(null))
  }, [workspaceId, isOwner])

  async function toggle(key: keyof NotificationPreferences) {
    if (!preferences || saving) return
    const next = { ...preferences, [key]: !preferences[key] }
    setSaving(key)
    try {
      const updated = await updateNotificationPreferences({ data: { workspaceId, preferences: { [key]: next[key] } } })
      setPreferences(updated)
    } finally {
      setSaving(null)
    }
  }

  if (!isOwner) return null

  const items: { key: keyof NotificationPreferences; label: string; description: string }[] = [
    {
      key: 'emailOnCampaignCompleted',
      label: 'Campanha concluída',
      description: 'Receber email quando uma campanha terminar de enviar.',
    },
    {
      key: 'emailOnCampaignFailed',
      label: 'Campanha falhou',
      description: 'Receber email quando uma campanha falhar por falta de conexão ativa.',
    },
    {
      key: 'emailOnCreditsExhausted',
      label: 'Créditos esgotados',
      description: 'Receber email quando os créditos do workspace acabarem no meio de uma campanha.',
    },
    {
      key: 'emailOnConnectionDisconnected',
      label: 'Conexão desconectada',
      description: 'Receber email quando uma conexão WhatsApp ou Telegram for desconectada.',
    },
  ]

  return (
    <div className="mt-10">
      <PageHeader
        title="Notificações por email"
        subtitle="Escolha quais eventos do workspace também enviam email para você."
      />
      <Card className="mt-5 p-5">
        {!preferences ? (
          <div className="text-sm text-neutral-500">Carregando preferências…</div>
        ) : (
          <div className="space-y-4">
            {items.map((item) => (
              <label
                key={item.key}
                className="flex items-start justify-between gap-4 rounded-lg border border-neutral-200 p-3 hover:border-brand-200 transition-colors cursor-pointer"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-dark-800 flex items-center gap-2">
                    <Mail size={14} className="text-brand-500" />
                    {item.label}
                  </p>
                  <p className="text-xs text-neutral-500 mt-0.5">{item.description}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={preferences[item.key]}
                  disabled={saving === item.key}
                  onClick={() => toggle(item.key)}
                  className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
                    preferences[item.key] ? 'bg-brand-500' : 'bg-neutral-200'
                  } disabled:opacity-60`}
                >
                  <span
                    className={`inline-block size-5 rounded-full bg-white shadow-sm transition-transform ${
                      preferences[item.key] ? 'translate-x-6' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </label>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
