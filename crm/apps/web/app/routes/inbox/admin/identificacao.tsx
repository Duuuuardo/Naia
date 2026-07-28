import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { IdCard, Save } from 'lucide-react'
import { InboxShell } from '../../../components/inbox-shell'
import { Button } from '../../../components/ui'
import { fetchAdminSettings, getInboxAgent, updateAdminSettings } from '../../../lib/inbox-session'
import { createHeadConfig } from '../../../lib/seo'

export const Route = createFileRoute('/inbox/admin/identificacao')({
  head: () => createHeadConfig('Identificação do atendente — Naia CRM'),
  beforeLoad: async () => {
    const agent = await getInboxAgent()
    if (!agent) throw redirect({ to: '/inbox/login' })
    if (agent.role !== 'superadmin') throw redirect({ to: '/inbox' })
  },
  loader: async () => {
    const agent = (await getInboxAgent())!
    const settings = await fetchAdminSettings()
    return { agent, settings }
  },
  component: AdminIdentity,
})

function AdminIdentity() {
  const initial = Route.useLoaderData()
  const firstName = initial.agent.name.trim().split(/\s+/)[0] || initial.agent.name

  const [enabled, setEnabled] = useState(initial.settings.identifyAgent)
  const [saving, setSaving] = useState(false)
  const [savedOk, setSavedOk] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setError(null)
    setSavedOk(false)
    setSaving(true)
    const result = await updateAdminSettings({ data: { identifyAgent: enabled } })
    setSaving(false)
    if (!result) {
      setError('Não foi possível salvar a configuração. Tente novamente.')
      return
    }
    setSavedOk(true)
  }

  return (
    <InboxShell agentName={initial.agent.name} role={initial.agent.role}>
      <div className="h-full overflow-y-auto bg-neutral-50">
        <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
          <div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-dark-800">
              Identificação do atendente
            </h1>
            <p className="mt-1 text-sm text-neutral-500">
              Mostra ao contato qual atendente está respondendo, em cada mensagem enviada.
            </p>
          </div>

          {error && (
            <div className="rounded-lg border border-error-500/30 bg-error-500/10 px-4 py-3 text-sm font-medium text-error-500">
              {error}
            </div>
          )}

          <div className="overflow-hidden rounded-lg border border-neutral-200 bg-neutral-0">
            <div className="border-b border-neutral-200 bg-neutral-50 px-5 py-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-dark-800">
                <IdCard size={16} aria-hidden="true" />
                Nome do atendente nas mensagens
              </h2>
              <p className="mt-0.5 text-xs text-neutral-500">
                Quando ligado, o primeiro nome do atendente é adicionado, em negrito, antes de cada mensagem
                manual enviada ao contato. Não afeta mensagens de bot nem automáticas.
              </p>
            </div>

            <div className="space-y-5 px-5 py-5">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => {
                    setEnabled(e.target.checked)
                    setSavedOk(false)
                  }}
                  className="mt-0.5 size-4 accent-brand-500"
                />
                <span>
                  <span className="block text-sm font-medium text-dark-800">
                    Identificar o atendente nas mensagens enviadas
                  </span>
                  <span className="mt-0.5 block text-xs text-neutral-500">
                    O contato passa a ver quem está falando com ele em cada resposta da equipe.
                  </span>
                </span>
              </label>

              <div>
                <p className="mb-1.5 text-xs font-medium text-dark-800">Prévia</p>
                <div className="max-w-xs rounded-lg rounded-tr-sm bg-brand-500 px-3 py-2 text-sm text-white">
                  {enabled && <span className="font-bold">{firstName}:</span>}
                  {enabled && <br />}
                  Olá! Como posso ajudar?
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-neutral-100 pt-4">
                {savedOk && <span className="text-xs font-medium text-success-500">Configuração salva.</span>}
                <Button icon={Save} onClick={handleSave} loading={saving}>
                  Salvar
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </InboxShell>
  )
}
