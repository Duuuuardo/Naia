import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { MessageSquareText, Save, Star, ThumbsUp } from 'lucide-react'
import { InboxShell } from '../../../components/inbox-shell'
import { Button } from '../../../components/ui'
import { fetchAdminSettings, getInboxAgent, updateAdminSettings } from '../../../lib/inbox-session'
import { createHeadConfig } from '../../../lib/seo'

export const Route = createFileRoute('/inbox/admin/avaliacao')({
  head: () => createHeadConfig('Avaliação de atendimento — Naia CRM'),
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
  component: AdminCsat,
})

// Textos padrão (espelham CSAT_DEFAULT_MESSAGE / CSAT_DEFAULT_THANK_YOU_MESSAGE
// do backend) — usados como placeholder quando o workspace não customizou.
const DEFAULT_CSAT_MESSAGE = 'Seu atendimento foi finalizado. De 1 a 5, como você avalia o atendimento?'
const DEFAULT_THANK_YOU_MESSAGE = 'Obrigado pela sua avaliação!'

const textareaClass =
  'w-full resize-none rounded-md border border-neutral-300 bg-neutral-0 px-3 py-2 text-sm text-dark-800 outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20'

function AdminCsat() {
  const initial = Route.useLoaderData()
  const { settings } = initial

  const [enabled, setEnabled] = useState(settings.csatEnabled)
  const [message, setMessage] = useState(settings.csatMessage ?? '')
  const [thankYouMessage, setThankYouMessage] = useState(settings.csatThankYouMessage ?? '')
  const [saving, setSaving] = useState(false)
  const [savedOk, setSavedOk] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setError(null)
    setSavedOk(false)
    setSaving(true)
    // Texto vazio volta para null (o backend usa o texto padrão).
    const result = await updateAdminSettings({
      data: {
        csatEnabled: enabled,
        csatMessage: message.trim() || null,
        csatThankYouMessage: thankYouMessage.trim() || null,
      },
    })
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
              Avaliação de atendimento
            </h1>
            <p className="mt-1 text-sm text-neutral-500">
              Pesquisa de satisfação (CSAT) enviada ao contato quando a conversa é resolvida.
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
                <Star size={16} aria-hidden="true" />
                Pesquisa de satisfação
              </h2>
              <p className="mt-0.5 text-xs text-neutral-500">
                Ao resolver um atendimento, o contato recebe a pergunta e responde com uma nota de 1 a 5. A nota
                não reabre a conversa e aparece nos relatórios. Cada atendimento (ciclo resolver → reabrir) tem
                sua própria pesquisa.
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
                    Enviar pesquisa automaticamente ao finalizar
                  </span>
                  <span className="mt-0.5 block text-xs text-neutral-500">
                    Sempre que um atendimento é resolvido, a pesquisa é enviada (uma vez por atendimento). Se o
                    contato responder qualquer outra coisa, o atendimento reabre normalmente.
                  </span>
                </span>
              </label>

              {enabled && (
                <>
                  <div>
                    <label
                      htmlFor="csat-message"
                      className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-dark-800"
                    >
                      <MessageSquareText size={14} aria-hidden="true" className="text-neutral-400" />
                      Mensagem da pesquisa
                    </label>
                    <textarea
                      id="csat-message"
                      value={message}
                      onChange={(e) => {
                        setMessage(e.target.value)
                        setSavedOk(false)
                      }}
                      placeholder={DEFAULT_CSAT_MESSAGE}
                      rows={3}
                      maxLength={1000}
                      className={textareaClass}
                    />
                    <p className="mt-1.5 text-xs text-neutral-500">
                      Enviada automaticamente ao contato assim que a conversa é resolvida. Vazio = texto padrão.
                    </p>
                  </div>

                  <div>
                    <label
                      htmlFor="csat-thank-you"
                      className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-dark-800"
                    >
                      <ThumbsUp size={14} aria-hidden="true" className="text-neutral-400" />
                      Mensagem de agradecimento
                    </label>
                    <textarea
                      id="csat-thank-you"
                      value={thankYouMessage}
                      onChange={(e) => {
                        setThankYouMessage(e.target.value)
                        setSavedOk(false)
                      }}
                      placeholder={DEFAULT_THANK_YOU_MESSAGE}
                      rows={2}
                      maxLength={1000}
                      className={textareaClass}
                    />
                    <p className="mt-1.5 text-xs text-neutral-500">
                      Enviada quando o contato responde com a nota. Vazio = texto padrão.
                    </p>
                  </div>
                </>
              )}

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
