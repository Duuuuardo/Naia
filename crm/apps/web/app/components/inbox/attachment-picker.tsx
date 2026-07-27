import { useEffect, useRef, useState } from 'react'
import { Check, FileText, Upload } from 'lucide-react'
import { Button, Modal } from '../ui'
import {
  confirmFile,
  fetchFiles,
  fetchFileUrl,
  presignFile,
  type InboxFileItem,
} from '../../lib/inbox-session'

// Anexo escolhido no picker: vai como chip no composer e, no envio, só os
// fileIds sobem em sendMessage.attachmentFileIds.
export type ComposerAttachment = {
  fileId: string
  filename: string
  kind: 'image' | 'video' | 'audio' | 'document'
  storageKey: string
}

type Tab = 'library' | 'upload'

type UploadEntry = { tempId: string; name: string; progress: number; error: boolean }

// PUT direto do browser para a URL pré-assinada do MinIO, com progresso
// (fetch não expõe upload progress — por isso XMLHttpRequest). Exportado para
// o gravador de áudio reutilizar o mesmo fluxo de upload.
export function xhrPut(uploadUrl: string, file: Blob, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', uploadUrl)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`)))
    xhr.onerror = () => reject(new Error('Falha de rede'))
    xhr.send(file)
  })
}

function fileToAttachment(file: InboxFileItem): ComposerAttachment {
  return { fileId: file.id, filename: file.filename, kind: file.kind, storageKey: file.storageKey }
}

// Thumb de um arquivo da biblioteca: busca a URL presigned sob demanda.
function LibraryThumb({ file }: { file: InboxFileItem }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    fetchFileUrl({ data: { fileId: file.id } }).then((res) => {
      if (alive && res?.url) setUrl(res.url)
    })
    return () => {
      alive = false
    }
  }, [file.id])

  if (!url) return <div className="size-full animate-pulse bg-neutral-100" />
  return <img src={url} alt={file.filename} className="size-full object-cover" loading="lazy" />
}

export function AttachmentPicker({
  open,
  onClose,
  selected,
  onChange,
}: {
  open: boolean
  onClose: () => void
  selected: ComposerAttachment[]
  onChange: (next: ComposerAttachment[]) => void
}) {
  const [tab, setTab] = useState<Tab>('library')
  const [files, setFiles] = useState<InboxFileItem[] | null>(null)
  const [uploads, setUploads] = useState<UploadEntry[]>([])
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setTab('library')
    setUploads([])
    setFiles(null)
    fetchFiles({ data: {} }).then(setFiles)
  }, [open])

  // Sempre o `selected` mais recente dentro do loop assíncrono de uploads.
  const selectedRef = useRef(selected)
  selectedRef.current = selected

  function isSelected(fileId: string) {
    return selected.some((a) => a.fileId === fileId)
  }

  function toggle(file: InboxFileItem) {
    if (isSelected(file.id)) {
      onChange(selected.filter((a) => a.fileId !== file.id))
    } else {
      onChange([...selected, fileToAttachment(file)])
    }
  }

  async function uploadFiles(list: FileList | File[]) {
    for (const file of Array.from(list)) {
      const tempId = `${Date.now()}-${file.name}`
      setUploads((prev) => [...prev, { tempId, name: file.name, progress: 0, error: false }])
      try {
        const presign = await presignFile({
          data: {
            filename: file.name,
            mimeType: file.type || 'application/octet-stream',
            sizeBytes: file.size,
          },
        })
        if (!presign) throw new Error('presign falhou')
        await xhrPut(presign.uploadUrl, file, (pct) => {
          setUploads((prev) => prev.map((u) => (u.tempId === tempId ? { ...u, progress: pct } : u)))
        })
        const confirmed = await confirmFile({ data: { fileId: presign.fileId } })
        if (!confirmed) throw new Error('confirm falhou')
        onChange([...selectedRef.current, fileToAttachment(confirmed)])
        setUploads((prev) => prev.filter((u) => u.tempId !== tempId))
      } catch {
        setUploads((prev) => prev.map((u) => (u.tempId === tempId ? { ...u, error: true } : u)))
      }
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Anexar arquivo"
      footer={
        <Button size="sm" onClick={onClose}>
          Concluir{selected.length > 0 ? ` (${selected.length})` : ''}
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-1 rounded-lg bg-neutral-100 p-1">
          {(['library', 'upload'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                tab === t ? 'bg-neutral-0 text-dark-800 shadow-2xs' : 'text-neutral-500 hover:text-dark-800'
              }`}
            >
              {t === 'library' ? 'Biblioteca' : 'Enviar novo'}
            </button>
          ))}
        </div>

        {tab === 'library' ? (
          files === null ? (
            <div className="grid place-items-center py-8 text-neutral-300">
              <span className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            </div>
          ) : files.length === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-400">
              Nenhum arquivo na biblioteca. Envie um novo na aba ao lado.
            </p>
          ) : (
            <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto">
              {files.map((f) => {
                const active = isSelected(f.id)
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => toggle(f)}
                    aria-pressed={active}
                    className={`group relative overflow-hidden rounded-lg border text-left transition-colors ${
                      active ? 'border-brand-500 ring-2 ring-brand-500/30' : 'border-neutral-200 hover:border-neutral-300'
                    }`}
                  >
                    {f.kind === 'image' ? (
                      <div className="aspect-square w-full">
                        <LibraryThumb file={f} />
                      </div>
                    ) : (
                      <div className="grid aspect-square w-full place-items-center bg-neutral-50 text-neutral-400">
                        <FileText size={22} aria-hidden="true" />
                      </div>
                    )}
                    <p className="truncate px-1.5 py-1 text-[10px] font-medium text-neutral-500">{f.filename}</p>
                    {active && (
                      <span className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-brand-500 text-white">
                        <Check size={12} aria-hidden="true" />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )
        ) : (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                uploadFiles(e.dataTransfer.files)
              }}
              className={`flex w-full flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center transition-colors ${
                dragOver ? 'border-brand-500 bg-brand-50' : 'border-neutral-300 hover:border-neutral-400'
              }`}
            >
              <Upload size={20} className={dragOver ? 'text-brand-500' : 'text-neutral-400'} aria-hidden="true" />
              <p className="text-sm font-medium text-dark-800">Arraste arquivos ou clique para escolher</p>
              <p className="text-xs text-neutral-400">Imagens até 10MB · demais tipos até 50MB</p>
            </button>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) uploadFiles(e.target.files)
                e.target.value = ''
              }}
            />

            {uploads.length > 0 && (
              <div className="space-y-2">
                {uploads.map((u) => (
                  <div key={u.tempId} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate font-medium text-dark-800">{u.name}</span>
                      <span className={u.error ? 'font-semibold text-error-500' : 'text-neutral-400'}>
                        {u.error ? 'Falhou' : `${u.progress}%`}
                      </span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-neutral-100">
                      <div
                        className={`h-full rounded-full transition-[width] ${u.error ? 'bg-error-500' : 'bg-brand-500'}`}
                        style={{ width: `${u.error ? 100 : u.progress}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
