import { createFileRoute, useLoaderData, useRouteContext, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Mail, ShieldAlert } from 'lucide-react'
import { updateWorkspaceSettings, fetchNotificationPreferences, updateNotificationPreferences, type NotificationPreferences } from '../../../lib/actions'
import { Card, PageHeader, WorkspaceSettingsView } from '../../../components/ui'
import { createHeadConfig } from '~/lib/seo'

export const Route = createFileRoute('/_app/$workspaceId/settings')({ head: () => createHeadConfig('Configurações — Naia Campanhas'),
  component: SettingsPage,
})

function SettingsPage() {
  const { workspace, permissions } = useLoaderData({ from: '/_app/$workspaceId' })
  const { workspaceId } = Route.useParams()
  const router = useRouter()

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

  return (
    <WorkspaceSettingsView
      initialValues={{
        name: workspace.name,
        description: ('description' in workspace && workspace.description) || '',
        location: ('location' in workspace && workspace.location) || '',
        industry: ('industry' in workspace && workspace.industry) || '',
        avatarUrl: ('avatarUrl' in workspace && (workspace.avatarUrl as string | null)) || '',
      }}
      onSave={async (values) => {
        const result = await updateWorkspaceSettings({ data: { workspaceId, ...values } })
        return 'error' in result
          ? { error: result.error ?? 'Erro ao salvar configurações.' }
          : {}
      }}
      onSaved={() => router.invalidate()}
    >
      <NotificationPreferencesSection workspaceId={workspaceId} />
    </WorkspaceSettingsView>
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
