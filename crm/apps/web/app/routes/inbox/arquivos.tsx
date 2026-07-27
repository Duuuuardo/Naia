import { createFileRoute, redirect } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import {
  Eye,
  FileAudio,
  FileText,
  FileVideo,
  FolderOpen,
  Image as ImageIcon,
  Search,
  Trash2,
  Upload,
} from 'lucide-react'
import { InboxShell } from '../../components/inbox-shell'
import { Button, EmptyState, Modal } from '../../components/ui'
import {
  confirmFile,
  fetchFiles,
  fetchFileUrl,
  getInboxAgent,
  presignFile,
  type InboxFileItem,
} from '../../lib/inbox-session'
import { deleteFileGuarded } from '../../lib/actions-arquivos'
import { createHeadConfig } from '../../lib/seo'

export const Route = createFileRoute('/inbox/arquivos')({
  head: () => createHeadConfig('Arquivos — Naia CRM'),
  beforeLoad: async () => {
    const agent = await getInboxAgent()
    if (!agent) throw redirect({ to: '/inbox/login' })
  },
  loader: async () => {
    const agent = (await getInboxAgent())!
    const files = await fetchFiles({ data: {} })
    return { agent, files }
  },
  component: ArquivosPage,
})

// ─── Regras de upload (espelham a API: imagem 10MB, demais 50MB) ────────────

type FileKind = InboxFileItem['kind']
type KindTab = 'all' | FileKind

const kindTabs: { id: KindTab; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'image', label: 'Imagens' },
  { id: 'video', label: 'Vídeos' },
  { id: 'audio', label: 'Áudios' },
  { id: 'document', label: 'Documentos' },
]

const DOC_EXTENSIONS = ['pdf', 'doc', 'docx', 'xlsx', 'pptx', 'txt']
const DOC_MIMES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
]
const INPUT_ACCEPT = `image/*,video/*,audio/*,${DOC_EXTENSIONS.map((e) => `.${e}`).join(',')}`

const kindIcon: Record<Exclude<FileKind, 'image'>, typeof FileText> = {
  video: FileVideo,
  audio: FileAudio,
  document: FileText,
}

// Retorna mensagem de erro (pt-BR) ou null quando o arquivo é aceito.
function validateFile(file: File): string | null {
  const mime = file.type
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const isImage = mime.startsWith('image/')
  const isMedia = isImage || mime.startsWith('video/') || mime.startsWith('audio/')
  // Fallback por extensão: alguns browsers mandam MIME vazio/genérico p/ docs.
  const isDoc = DOC_MIMES.includes(mime) || DOC_EXTENSIONS.includes(ext)
  if (!isMedia && !isDoc) return 'Tipo de arquivo não suportado.'
  const limitMb = isImage ? 10 : 50
  if (file.size > limitMb * 1024 * 1024) {
    return `Tamanho máximo de ${limitMb} MB${isImage ? ' para imagens' : ''}.`
  }
  return null
}

function formatSize(bytes: number): string {
  const br = (n: number, digits = 1) => n.toFixed(digits).replace('.', ',')
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${br(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${br(bytes / 1024 / 1024)} MB`
  return `${br(bytes / 1024 / 1024 / 1024, 2)} GB`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

// PUT direto na URL pré-assinada (MinIO) com barra de progresso — server fns
// não transmitem bytes, então o upload sai do browser via XHR.
function xhrPut(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Falha no envio.')))
    xhr.onerror = () => reject(new Error('Falha no envio.'))
    xhr.send(file)
  })
}

type UploadEntry = { key: string; name: string; progress: number; error: string | null }

// ─── Thumbnail de imagem (URL pré-assinada sob demanda) ─────────────────────

function ImageThumb({ file }: { file: InboxFileItem }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    fetchFileUrl({ data: { fileId: file.id } })
      .then((res) => {
        if (alive) setUrl(res?.url ?? null)
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [file.id])

  if (url && !failed) {
    return (
      <img
        src={url}
        alt={file.filename}
        loading="lazy"
        onError={() => setFailed(true)}
        className="size-full object-cover"
      />
    )
  }
  return (
    <span className="grid size-full place-items-center bg-neutral-100 text-neutral-300">
      {url === null && !failed ? (
        <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : (
        <ImageIcon size={20} aria-hidden="true" />
      )}
    </span>
  )
}

// ─── Card do grid ────────────────────────────────────────────────────────────

function FileCard({
  file,
  onPreview,
  onDelete,
}: {
  file: InboxFileItem
  onPreview: () => void
  onDelete: () => void
}) {
  const Icon = file.kind === 'image' ? ImageIcon : kindIcon[file.kind]
  return (
    <div className="group overflow-hidden rounded-lg border border-neutral-200 bg-neutral-0 transition-colors hover:border-neutral-300">
      <div className="relative aspect-[4/3] bg-neutral-50">
        {file.kind === 'image' ? (
          <ImageThumb file={file} />
        ) : (
          <span className="grid size-full place-items-center text-neutral-300">
            <Icon size={28} aria-hidden="true" />
          </span>
        )}
        {/* Ações reveladas no hover */}
        <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={onPreview}
            aria-label={`Visualizar ${file.filename}`}
            className="grid size-7 place-items-center rounded-md bg-neutral-0 text-neutral-500 shadow-sm ring-1 ring-neutral-200 transition-colors hover:text-dark-800"
          >
            <Eye size={13} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Excluir ${file.filename}`}
            className="grid size-7 place-items-center rounded-md bg-neutral-0 text-neutral-500 shadow-sm ring-1 ring-neutral-200 transition-colors hover:text-error-500"
          >
            <Trash2 size={13} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="px-3 py-2">
        <p className="truncate text-xs font-semibold text-dark-800" title={file.filename}>
          {file.filename}
        </p>
        <p className="mt-0.5 text-[11px] text-neutral-400">
          {formatSize(file.sizeBytes)} · {formatDate(file.createdAt)}
        </p>
      </div>
    </div>
  )
}

// ─── Página ──────────────────────────────────────────────────────────────────

function ArquivosPage() {
  const { agent, files: initialFiles } = Route.useLoaderData()
  const [files, setFiles] = useState<InboxFileItem[]>(initialFiles)
  const [tab, setTab] = useState<KindTab>('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [uploads, setUploads] = useState<UploadEntry[]>([])
  const [dragActive, setDragActive] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)
  const [preview, setPreview] = useState<InboxFileItem | null>(null)
  const [previewUrl, setPreviewUrl] = useState<{ url: string; mimeType: string; kind: string } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<InboxFileItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)

  async function load(k: KindTab, s: string) {
    setLoading(true)
    const rows = await fetchFiles({
      data: { kind: k === 'all' ? undefined : k, search: s.trim() || undefined },
    })
    setFiles(rows)
    setLoading(false)
  }

  // Filtro inicial já veio do loader — recarrega (com debounce) ao mudar.
  const skipFirst = useRef(true)
  useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false
      return
    }
    const timer = setTimeout(() => load(tab, search), 350)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, search])

  function patchUpload(key: string, patch: Partial<UploadEntry>) {
    setUploads((prev) => prev.map((u) => (u.key === key ? { ...u, ...patch } : u)))
  }

  async function uploadOne(file: File) {
    const key = crypto.randomUUID()
    setUploads((prev) => [...prev, { key, name: file.name, progress: 0, error: null }])
    try {
      const presign = await presignFile({
        data: { filename: file.name, mimeType: file.type || 'application/octet-stream', sizeBytes: file.size },
      })
      if (!presign) throw new Error('Não foi possível iniciar o envio.')
      await xhrPut(presign.uploadUrl, file, (pct) => patchUpload(key, { progress: pct }))
      await confirmFile({ data: { fileId: presign.fileId } })
      setUploads((prev) => prev.filter((u) => u.key !== key))
      await load(tab, search)
    } catch (err) {
      patchUpload(key, { error: err instanceof Error ? err.message : 'Falha no envio.' })
    }
  }

  async function handleFiles(list: FileList | File[]) {
    setPageError(null)
    const rejected: string[] = []
    for (const file of Array.from(list)) {
      const problem = validateFile(file)
      if (problem) {
        rejected.push(`${file.name}: ${problem}`)
        continue
      }
      await uploadOne(file)
    }
    if (rejected.length > 0) setPageError(rejected.join(' '))
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    dragDepth.current = 0
    setDragActive(false)
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files)
  }

  async function openPreview(file: InboxFileItem) {
    setPreview(file)
    setPreviewUrl(null)
    setPreviewLoading(true)
    const res = await fetchFileUrl({ data: { fileId: file.id } })
    setPreviewUrl(res)
    setPreviewLoading(false)
  }

  async function handleDelete() {
    if (!confirmDelete) return
    setDeleting(true)
    setDeleteError(null)
    const res = await deleteFileGuarded({ data: { fileId: confirmDelete.id } })
    setDeleting(false)
    if (!res.ok) {
      // 409: arquivo anexado a mensagens — a API já devolve o motivo em pt-BR.
      setDeleteError(
        res.inUse
          ? (res.message ?? 'Este arquivo está em uso e não pode ser excluído.')
          : (res.message ?? 'Não foi possível excluir o arquivo.'),
      )
      return
    }
    setConfirmDelete(null)
    await load(tab, search)
  }

  const totalBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0)

  return (
    <InboxShell agentName={agent.name} role={agent.role}>
      <div
        className="relative flex h-full flex-col bg-neutral-0"
        onDragEnter={(e) => {
          e.preventDefault()
          if (!e.dataTransfer.types.includes('Files')) return
          dragDepth.current += 1
          setDragActive(true)
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          e.preventDefault()
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setDragActive(false)
        }}
        onDrop={handleDrop}
      >
        {/* Overlay de drag-drop (página inteira) */}
        {dragActive && (
          <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-brand-50/80">
            <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-brand-500 bg-neutral-0 px-10 py-8">
              <Upload size={24} className="text-brand-500" aria-hidden="true" />
              <p className="text-sm font-semibold text-dark-800">Solte os arquivos para enviar</p>
              <p className="text-xs text-neutral-400">Imagens até 10 MB · demais até 50 MB</p>
            </div>
          </div>
        )}

        {/* Header */}
        <header className="flex items-center justify-between gap-3 border-b border-neutral-200 px-5 py-3">
          <div className="min-w-0">
            <h1 className="font-display text-lg font-bold tracking-tight text-dark-800">Arquivos</h1>
            <p className="text-xs text-neutral-400">
              {files.length} arquivo{files.length === 1 ? '' : 's'} · {formatSize(totalBytes)} em uso
            </p>
          </div>
          <Button icon={Upload} onClick={() => inputRef.current?.click()}>
            Enviar arquivo
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={INPUT_ACCEPT}
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) handleFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </header>

        {/* Filtros: tabs por tipo + busca por nome */}
        <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 px-4 py-2">
          <div className="flex gap-1">
            {kindTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  tab === t.id ? 'bg-brand-50 text-brand-600' : 'text-neutral-500 hover:bg-neutral-100'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="relative ml-auto">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-300" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome…"
              className="h-8 w-48 rounded-md border border-neutral-200 bg-neutral-0 pl-8 pr-3 text-xs text-dark-800 placeholder:text-neutral-300 focus:border-brand-500 focus:outline-none"
            />
          </div>
        </div>

        {pageError && (
          <p className="border-b border-error-500/20 bg-error-500/5 px-5 py-2 text-xs text-error-500" role="alert">
            {pageError}
          </p>
        )}

        {/* Envios em andamento */}
        {uploads.length > 0 && (
          <div className="space-y-2 border-b border-neutral-100 px-5 py-3">
            {uploads.map((u) => (
              <div key={u.key}>
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-xs font-medium text-dark-800">{u.name}</p>
                  {u.error ? (
                    <span className="shrink-0 text-[11px] font-semibold text-error-500">{u.error}</span>
                  ) : (
                    <span className="shrink-0 text-[11px] font-semibold text-neutral-400">{u.progress}%</span>
                  )}
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-100">
                  <div
                    className={`h-full rounded-full transition-[width] ${u.error ? 'bg-error-500' : 'bg-brand-500'}`}
                    style={{ width: `${u.error ? 100 : u.progress}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="grid place-items-center py-16 text-neutral-300">
              <span className="size-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
            </div>
          ) : files.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title={search || tab !== 'all' ? 'Nenhum arquivo encontrado' : 'Nenhum arquivo por aqui'}
              description={
                search || tab !== 'all'
                  ? 'Tente ajustar a busca ou o filtro de tipo.'
                  : 'Envie imagens, vídeos, áudios e documentos para usar nas conversas.'
              }
              action={
                <Button icon={Upload} size="sm" onClick={() => inputRef.current?.click()}>
                  Enviar arquivo
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {files.map((f) => (
                <FileCard key={f.id} file={f} onPreview={() => openPreview(f)} onDelete={() => setConfirmDelete(f)} />
              ))}
            </div>
          )}
        </div>

        {/* Modal: visualizar */}
        <Modal
          open={preview !== null}
          onClose={() => setPreview(null)}
          title={preview?.filename ?? 'Visualizar arquivo'}
        >
          {previewLoading ? (
            <div className="grid place-items-center py-12 text-neutral-300">
              <span className="size-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
            </div>
          ) : !previewUrl ? (
            <p className="py-8 text-center text-sm text-neutral-400">Não foi possível carregar o arquivo.</p>
          ) : preview?.kind === 'image' ? (
            <img src={previewUrl.url} alt={preview.filename} className="max-h-[60vh] w-full rounded-lg object-contain" />
          ) : preview?.kind === 'video' ? (
            <video src={previewUrl.url} controls className="max-h-[60vh] w-full rounded-lg" />
          ) : preview?.kind === 'audio' ? (
            <div className="py-6">
              <audio src={previewUrl.url} controls className="w-full" />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <span className="grid size-12 place-items-center rounded-full bg-neutral-100 text-neutral-400">
                <FileText size={22} aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-semibold text-dark-800">{preview?.filename}</p>
                <p className="mt-0.5 text-xs text-neutral-400">
                  {preview ? `${formatSize(preview.sizeBytes)} · ${formatDate(preview.createdAt)}` : ''}
                </p>
              </div>
              <p className="text-xs text-neutral-400">Documentos não têm prévia — abra em nova guia para ver ou baixar.</p>
              <Button size="sm" onClick={() => window.open(previewUrl.url, '_blank', 'noopener')}>
                Abrir em nova guia
              </Button>
            </div>
          )}
        </Modal>

        {/* Modal: excluir */}
        <Modal
          open={confirmDelete !== null}
          onClose={() => {
            if (!deleting) {
              setConfirmDelete(null)
              setDeleteError(null)
            }
          }}
          title="Excluir arquivo"
          footer={
            <>
              <Button
                variant="secondary"
                size="sm"
                disabled={deleting}
                onClick={() => {
                  setConfirmDelete(null)
                  setDeleteError(null)
                }}
              >
                Cancelar
              </Button>
              <Button variant="danger" size="sm" loading={deleting} onClick={handleDelete}>
                Excluir
              </Button>
            </>
          }
        >
          <p className="text-sm text-neutral-500">
            Tem certeza que deseja excluir{' '}
            <span className="font-semibold text-dark-800">{confirmDelete?.filename}</span>? Esta ação não pode ser
            desfeita.
          </p>
          {deleteError && (
            <p className="mt-3 rounded-md border border-error-500/25 bg-error-500/5 px-3 py-2 text-xs text-error-500" role="alert">
              {deleteError}
            </p>
          )}
        </Modal>
      </div>
    </InboxShell>
  )
}
