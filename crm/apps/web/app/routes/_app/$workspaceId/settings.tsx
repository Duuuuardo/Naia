import { createFileRoute, useLoaderData, useRouter } from '@tanstack/react-router'
import { Globe, Inbox, Lock } from 'lucide-react'
import { Badge, Card, PageHeader, WorkspaceSettingsView } from '../../../components/ui'
import { updateWorkspaceSettings } from '../../../lib/actions'
import { createHeadConfig } from '../../../lib/seo'

export const Route = createFileRoute('/_app/$workspaceId/settings')({
  head: () => createHeadConfig('Configurações — Naia CRM'),
  component: SettingsPage,
})

function SettingsPage() {
  const { workspace, entitlements } = useLoaderData({ from: '/_app/$workspaceId' })
  const { workspaceId } = Route.useParams()
  const router = useRouter()
  const isScale = entitlements?.plan === 'scale'

  return (
    <WorkspaceSettingsView
      initialValues={{
        name: workspace.name,
        description: workspace.description ?? '',
        location: workspace.location ?? '',
        industry: workspace.industry ?? '',
        avatarUrl: workspace.avatarUrl ?? '',
      }}
      onSave={async (values) => {
        const result = await updateWorkspaceSettings({ data: { workspaceId, ...values } })
        return 'error' in result
          ? { error: result.error ?? 'Não foi possível salvar as configurações.' }
          : {}
      }}
      onSaved={() => router.invalidate()}
    >
      <div className="mt-10">
        <PageHeader
          title="Inbox"
          subtitle="Endereço que os agentes usam para acessar o atendimento."
        />
        <Card className="mt-5 p-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-dark-800">
            <Inbox size={14} className="text-brand-500" aria-hidden="true" />
            Endereço do inbox
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">
            Compartilhe esta URL com a equipe de atendimento.
          </p>
          <div className="mt-3 flex items-center rounded-md border border-neutral-300 bg-neutral-50 px-3 text-sm text-neutral-500">
            <span className="py-2.5 font-medium text-dark-800">{workspace.slug}</span>
            <span className="py-2.5">.crm.naia.website</span>
          </div>
        </Card>
      </div>

      <div className="mt-10">
        <PageHeader
          title="Domínio customizado"
          subtitle="Use o domínio e a identidade visual da sua empresa no inbox."
        />
        <Card className="mt-5 p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-dark-800">
              <Globe size={14} className="text-brand-500" aria-hidden="true" />
              Domínio próprio
            </p>
            {isScale ? (
              <Badge className="border-warning-200 bg-warning-50 text-warning-600">Em breve</Badge>
            ) : (
              <Badge className="border-neutral-200 bg-neutral-100 text-neutral-500">
                <Lock size={10} aria-hidden="true" />
                Plano Scale
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            {isScale
              ? 'Aponte seu domínio para o inbox e personalize a experiência da equipe. Disponível em breve.'
              : 'No plano Scale, sua equipe usa o próprio domínio e a identidade visual da empresa no inbox.'}
          </p>
        </Card>
      </div>
    </WorkspaceSettingsView>
  )
}
