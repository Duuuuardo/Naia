import { ProductTopbar } from './ui'
import { NotificationBell } from './notification-bell'
import { logout } from '../lib/vianova'
import { requireEnv } from '../lib/env'
import type { SessionUser } from '../lib/session'

const VIANOVA_WEB_URL = requireEnv('VITE_VIANOVA_WEB_URL')
const CAMPAIGNS_WEB_URL = requireEnv('VITE_NAIA_WEB_URL')
const CRM_WEB_URL = requireEnv('VITE_CRM_WEB_URL')

export function Topbar({
  user,
  workspaceName,
  workspaceAvatarUrl,
  mobileNav,
}: {
  user: SessionUser
  workspaceName?: string
  workspaceAvatarUrl?: string | null
  mobileNav?: React.ReactNode
}) {
  return (
    <ProductTopbar
      product={{ id: 'crm', label: 'CRM' }}
      user={user}
      workspaceName={workspaceName}
      workspaceAvatarUrl={workspaceAvatarUrl}
      mobileNav={mobileNav}
      notifications={<NotificationBell />}
      accountHref={VIANOVA_WEB_URL}
      products={[
        {
          id: 'campaigns',
          name: 'Naia Campanhas',
          description: 'Disparo em massa',
          href: CAMPAIGNS_WEB_URL,
        },
        {
          id: 'crm',
          name: 'Naia CRM',
          description: 'Atendimento multicanal',
          href: CRM_WEB_URL,
        },
      ]}
      onLogout={async () => {
        const { endSessionUrl } = await logout()
        window.location.href = endSessionUrl
      }}
    />
  )
}
