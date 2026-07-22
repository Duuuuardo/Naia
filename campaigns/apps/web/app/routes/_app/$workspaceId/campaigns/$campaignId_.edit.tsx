import { createFileRoute, redirect, useLoaderData, useRouteContext } from '@tanstack/react-router'
import { fetchCampaign, fetchConnections, fetchContactTags } from '../../../../lib/actions'
import { CampaignWizard } from '../../../../components/campaign-wizard'
import { draftFromCampaign } from '../../../../components/campaign-wizard/types'
import { createHeadConfig } from '~/lib/seo'

export const Route = createFileRoute('/_app/$workspaceId/campaigns/$campaignId_/edit')({
  head: () => createHeadConfig('Editar Campanha — Naia Campanhas'),
  loader: async ({ params }) => {
    const [result, connections, tagsRes] = await Promise.all([
      fetchCampaign({ data: { workspaceId: params.workspaceId, campaignId: params.campaignId } }),
      fetchConnections({ data: params.workspaceId }),
      fetchContactTags({ data: { workspaceId: params.workspaceId } }),
    ])
    if (!result?.campaign) {
      throw redirect({ to: '/$workspaceId/campaigns', params: { workspaceId: params.workspaceId } })
    }
    if (!['draft', 'scheduled', 'paused'].includes(result.campaign.status)) {
      throw redirect({
        to: '/$workspaceId/campaigns/$campaignId',
        params: { workspaceId: params.workspaceId, campaignId: params.campaignId },
      })
    }
    return {
      campaign: result.campaign,
      campaignConnections: result.connections,
      variants: result.variants,
      connections,
      availableTags: tagsRes.tags,
    }
  },
  component: EditCampaignPage,
})

function EditCampaignPage() {
  const { campaign, campaignConnections, variants, connections, availableTags } = Route.useLoaderData()
  const { workspaceId, campaignId } = Route.useParams()
  const { entitlements, permissions } = useLoaderData({ from: '/_app/$workspaceId' })
  const { user } = useRouteContext({ from: '/_app' })

  return (
    <CampaignWizard
      key={campaignId}
      workspaceId={workspaceId}
      connections={connections}
      availableTags={availableTags}
      tier={entitlements?.tier ?? 'free'}
      campaignId={campaignId}
      canDispatch={campaign.status !== 'paused'}
      initialDraft={draftFromCampaign({
        campaign,
        connections: campaignConnections,
        variants,
        tier: entitlements?.tier ?? 'free',
      })}
      userId={user.id}
      permissions={permissions}
    />
  )
}
