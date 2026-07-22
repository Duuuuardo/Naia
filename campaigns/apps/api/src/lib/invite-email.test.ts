import { describe, expect, it } from 'bun:test'
import { buildWorkspaceInviteEmail } from './invite-email'

describe('buildWorkspaceInviteEmail', () => {
  it('renders an invite with escaped workspace data', () => {
    const email = buildWorkspaceInviteEmail({
      workspaceName: '<Equipe & parceiros>',
      inviteUrl: 'https://campaigns.naia.website/invites/token?source=email&next=<home>',
    })

    expect(email.subject).toBe('Você foi convidado para <Equipe & parceiros> no Naia Campanhas')
    expect(email.html).toContain('&lt;Equipe &amp; parceiros&gt;')
    expect(email.html).toContain('source=email&amp;next=&lt;home&gt;')
    expect(email.html).toContain('Aceitar convite')
  })

  it('removes line breaks from the email subject', () => {
    const email = buildWorkspaceInviteEmail({
      workspaceName: 'Equipe\r\nBcc: attacker@example.com',
      inviteUrl: 'https://campaigns.naia.website/invites/token',
    })

    expect(email.subject).toBe('Você foi convidado para Equipe Bcc: attacker@example.com no Naia Campanhas')
  })
})
