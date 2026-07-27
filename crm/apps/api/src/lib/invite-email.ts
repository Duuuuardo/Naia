const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPE_MAP[character]!)
}

function subjectSafe(value: string): string {
  return value.replace(/[\r\n]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function buildManagerInviteEmail(input: { workspaceName: string; inviteUrl: string }) {
  const workspaceName = escapeHtml(input.workspaceName)
  const inviteUrl = escapeHtml(input.inviteUrl)
  const subjectWorkspaceName = subjectSafe(input.workspaceName)

  return {
    subject: `Você foi convidado para gerenciar ${subjectWorkspaceName} no Naia CRM`,
    html: `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Convite para ${workspaceName}</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#F9FAFB;font-family:'Plus Jakarta Sans',Arial,sans-serif;color:#3D4355;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border:1px solid #E5E7EB;border-radius:14px;overflow:hidden;">
          <tr>
            <td style="padding:32px 40px 0;font-size:22px;font-weight:700;letter-spacing:-0.5px;color:#3D4355;">Naia CRM</td>
          </tr>
          <tr>
            <td style="padding:24px 40px 32px;">
              <h1 style="margin:0 0 12px;font-size:24px;line-height:1.2;letter-spacing:-0.02em;color:#3D4355;">Você recebeu um convite</h1>
              <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#6B7280;">Você foi convidado para gerenciar o workspace <strong style="color:#3D4355;">${workspaceName}</strong>.</p>
              <a href="${inviteUrl}" style="display:inline-block;background:#DD5973;border-radius:10px;color:#FFFFFF;font-size:14px;font-weight:600;line-height:20px;padding:10px 20px;text-decoration:none;">Aceitar convite</a>
              <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#6B7280;">O convite expira em 7 dias. Entre ou crie sua conta com este mesmo e-mail para acessar o workspace.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px;border-top:1px solid #E5E7EB;font-size:12px;line-height:1.6;color:#6B7280;">Se você não esperava este convite, pode ignorar este e-mail.</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  }
}
