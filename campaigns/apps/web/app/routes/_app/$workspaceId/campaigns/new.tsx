import { createFileRoute, useLoaderData, useRouteContext } from '@tanstack/react-router'
import { fetchConnections, fetchContactTags } from '../../../../lib/actions'
import { CampaignWizard } from '../../../../components/campaign-wizard'
import { emptyDraft } from '../../../../components/campaign-wizard/types'

export const Route = createFileRoute('/_app/$workspaceId/campaigns/new')({
  loader: async ({ params }) => {
    const [connections, tagsRes] = await Promise.all([
      fetchConnections({ data: params.workspaceId }),
      fetchContactTags({ data: { workspaceId: params.workspaceId } }),
    ])
    return { connections, availableTags: tagsRes.tags }
  },
  component: NewCampaignPage,
})

function NewCampaignPage() {
  const { connections, availableTags } = Route.useLoaderData()
  const { workspaceId } = Route.useParams()
  const { entitlements, permissions } = useLoaderData({ from: '/_app/$workspaceId' })
  const { user } = useRouteContext({ from: '/_app' })

  return (
    <CampaignWizard
      workspaceId={workspaceId}
      connections={connections}
      availableTags={availableTags}
      tier={entitlements?.tier ?? 'free'}
      initialDraft={emptyDraft()}
      userId={user.id}
      permissions={permissions}
    />
  )
}
