import { useState } from 'react'
import { getInitials } from '../ui'

// Avatar do contato: mostra a foto (manual OU puxada do canal) quando houver,
// senão cai nas iniciais. Se a imagem falhar ao carregar (ex.: URL do canal
// expirada), volta para as iniciais sem quebrar o layout.
export function ContactAvatar({
  name,
  url,
  size = 36,
  className = '',
}: {
  name: string
  url: string | null | undefined
  size?: number
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const dimension = { width: size, height: size }

  if (url && !failed) {
    return (
      <img
        src={url}
        alt=""
        style={dimension}
        onError={() => setFailed(true)}
        className={`shrink-0 rounded-full border border-neutral-200 object-cover ${className}`}
      />
    )
  }

  return (
    <span
      style={dimension}
      className={`grid shrink-0 place-items-center rounded-full bg-neutral-100 font-bold text-dark-800 ${className}`}
    >
      {getInitials(name)}
    </span>
  )
}
