import { useEffect, useState } from 'react'
import { Download, FileText } from 'lucide-react'
import { Modal } from '../ui'
import { fetchAttachmentUrl } from '../../lib/actions-inbox-extra'
import type { MessageAttachmentItem } from '../../lib/inbox-session'

type UrlState = { loading: boolean; url: string | null }

// Resolve a URL de leitura do anexo uma vez (presigned via fetchAttachmentUrl).
// Cobre anexos da biblioteca e mídia inbound (rota attachment-url por storageKey).
function useAttachmentUrl(storageKey: string): UrlState {
  const [state, setState] = useState<UrlState>({ loading: true, url: null })
  useEffect(() => {
    let alive = true
    fetchAttachmentUrl({ data: { storageKey } }).then((res) => {
      if (alive) setState({ loading: false, url: res?.url ?? null })
    })
    return () => {
      alive = false
    }
  }, [storageKey])
  return state
}

function ImageAttachment({ attachment }: { attachment: MessageAttachmentItem }) {
  const { loading, url } = useAttachmentUrl(attachment.storageKey)
  const [zoomOpen, setZoomOpen] = useState(false)

  if (loading) return <div className="h-32 w-48 animate-pulse rounded-lg bg-neutral-100" />
  if (!url) return <DocumentAttachment attachment={attachment} />
  return (
    <>
      <button type="button" onClick={() => setZoomOpen(true)} className="block overflow-hidden rounded-lg">
        <img src={url} alt={attachment.filename} className="max-h-52 max-w-60 rounded-lg object-cover" loading="lazy" />
      </button>
      <Modal open={zoomOpen} onClose={() => setZoomOpen(false)} title={attachment.filename}>
        <img src={url} alt={attachment.filename} className="max-h-[70vh] w-full rounded-lg object-contain" />
      </Modal>
    </>
  )
}

function VideoAttachment({ attachment }: { attachment: MessageAttachmentItem }) {
  const { loading, url } = useAttachmentUrl(attachment.storageKey)
  if (loading) return <div className="h-32 w-56 animate-pulse rounded-lg bg-neutral-100" />
  if (!url) return <DocumentAttachment attachment={attachment} />
  return <video controls src={url} className="max-h-56 max-w-full rounded-lg" />
}

function AudioAttachment({ attachment }: { attachment: MessageAttachmentItem }) {
  const { loading, url } = useAttachmentUrl(attachment.storageKey)
  if (loading) return <div className="h-10 w-60 animate-pulse rounded-lg bg-neutral-100" />
  if (!url) return <DocumentAttachment attachment={attachment} />
  return <audio controls src={url} className="w-60 max-w-full" />
}

function DocumentAttachment({ attachment }: { attachment: MessageAttachmentItem }) {
  const { loading, url } = useAttachmentUrl(attachment.storageKey)
  return (
    <div className="flex w-60 max-w-full items-center gap-2.5 rounded-lg border border-neutral-200 bg-neutral-0 px-3 py-2.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-600">
        <FileText size={16} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-dark-800" title={attachment.filename}>
        {attachment.filename}
      </span>
      {loading ? (
        <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-neutral-200 border-t-transparent" />
      ) : url ? (
        <a
          href={url}
          download={attachment.filename}
          target="_blank"
          rel="noreferrer"
          aria-label={`Baixar ${attachment.filename}`}
          className="grid size-7 shrink-0 place-items-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-dark-800"
        >
          <Download size={14} aria-hidden="true" />
        </a>
      ) : null}
    </div>
  )
}

// Anexos de uma mensagem (MediaRef[]): imagem vira thumbnail clicável (Modal
// com a imagem grande), áudio/vídeo usam players nativos e documento vira
// card com botão de download.
export function MessageAttachments({ attachments }: { attachments: MessageAttachmentItem[] }) {
  if (attachments.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5">
      {attachments.map((a) => {
        const key = a.storageKey
        if (a.kind === 'image') return <ImageAttachment key={key} attachment={a} />
        if (a.kind === 'video') return <VideoAttachment key={key} attachment={a} />
        if (a.kind === 'audio') return <AudioAttachment key={key} attachment={a} />
        return <DocumentAttachment key={key} attachment={a} />
      })}
    </div>
  )
}
