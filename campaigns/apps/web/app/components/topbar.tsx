import { Link } from '@tanstack/react-router'
import { Zap } from 'lucide-react'
import { ProductTopbar } from './ui'
import { NotificationBell } from './notification-bell'
import { logout } from '../lib/vianova'
import { requireEnv } from '../lib/env'

const VIANOVA_WEB_URL = requireEnv('VITE_VIANOVA_WEB_URL')
const CAMPAIGNS_WEB_URL = requireEnv('VITE_NAIA_WEB_URL')

export function Topbar({
  user,
  workspaceName,
  workspaceAvatarUrl,
  credits,
  workspaceId,
  mobileNav,
}: {
  user: { name: string; picture?: string | null; pictureFrame?: string | null }
  workspaceName?: string
  workspaceAvatarUrl?: string | null
  credits?: { balance: number; perCycle: number }
  workspaceId?: string
  mobileNav?: React.ReactNode
}) {
  const low = Boolean(credits && credits.perCycle > 0 && credits.balance / credits.perCycle <= 0.1)
  const utility =
    credits && workspaceId ? (
      <Link
        to="/$workspaceId/billing"
        params={{ workspaceId }}
        title={`${credits.balance.toLocaleString('pt-BR')} créditos restantes`}
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-colors duration-150 ${
          low
            ? 'border-error-200 bg-error-50 text-error-600 hover:bg-error-100'
            : 'border-neutral-200 bg-neutral-50 text-neutral-600 hover:bg-neutral-100'
        }`}
      >
        <Zap size={12} aria-hidden="true" className={low ? 'text-error-500' : 'text-warning-500'} />
        {credits.balance.toLocaleString('pt-BR')}
      </Link>
    ) : undefined

  return (
    <ProductTopbar
      product={{ id: 'campaigns', label: 'Campaigns' }}
      user={user}
      workspaceName={workspaceName}
      workspaceAvatarUrl={workspaceAvatarUrl}
      mobileNav={mobileNav}
      utility={utility}
      notifications={<NotificationBell />}
      accountHref={VIANOVA_WEB_URL}
      products={[
        {
          id: 'campaigns',
          name: 'Naia Campanhas',
          description: 'Disparo em massa',
          href: CAMPAIGNS_WEB_URL,
        },
      ]}
      onLogout={async () => {
        const { endSessionUrl } = await logout()
        window.location.href = endSessionUrl
      }}
    />
  )
}
