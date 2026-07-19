import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ImageIcon, Film, Music, FileText, Upload, X, Paperclip } from 'lucide-react'
import type { RolePermissionMap } from '@naia/schemas'
import { fetchWorkspaceFiles, uploadCampaignMedia } from '../lib/actions'
import { FileThumbnail, fileIcon, type WorkspaceFile } from './file-preview'
import type { WizardMedia } from './campaign-wizard/types'

// Allowlist espelhada do backend (validateWorkspaceFile) para defesa em profundidade.
const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'video/mp4',
  'video/webm',
  'video/ogg',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
])

const ACCEPT_FILE_TYPES = Array.from(ALLOWED_UPLOAD_MIME_TYPES).join(',')

function isAllowedUploadMime(mimeType: string): boolean {
  return ALLOWED_UPLOAD_MIME_TYPES.has(mimeType.toLowerCase().split(';')[0]!.trim())
}

const KIND_ICON: Record<string, typeof ImageIcon> = {
  image: ImageIcon,
  video: Film,
  audio: Music,
  document: FileText,
}

function mediaKindFromMime(mimeType: string): 'image' | 'video' | 'audio' | 'document' {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  return 'document'
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log10(bytes) / Math.log10(1024))
  const value = bytes / 1024 ** i
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function MediaPicker({
  workspaceId,
  userId,
  permissions,
  open,
  onClose,
  onSelect,
}: {
  workspaceId: string
  userId: string
  permissions: RolePermissionMap
  open: boolean
  onClose: () => void
  onSelect: (media: WizardMedia) => void
}) {
  const canViewAllFiles = permissions.files
  const [tab, setTab] = useState<'files' | 'upload'>('files')
  const [files, setFiles] = useState<WorkspaceFile[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  async function load() {
    setLoading(true)
    setError(null)
    const res = await fetchWorkspaceFiles({
      data: {
        workspaceId,
        status: 'active',
        ownerUserId: canViewAllFiles ? undefined : userId,
      },
    })
    setLoading(false)
    if ('error' in res && res.error) {
      setError(res.error)
      return
    }
    setFiles('items' in res ? res.items : [])
  }

  useEffect(() => {
    if (open) {
      document.body.classList.add('overflow-hidden')
      void load()
    } else {
      document.body.classList.remove('overflow-hidden')
      setTab('files')
      setSelectedId(null)
      setError(null)
      setUploadError(null)
    }
    return () => {
      document.body.classList.remove('overflow-hidden')
    }
  }, [open])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (open && e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    await handleUploadFile(file)
  }

  async function handleUploadFile(file: File) {
    if (!isAllowedUploadMime(file.type)) {
      setUploadError('Formato de arquivo não permitido. Aceitamos imagens, áudio, vídeo, PDF e documentos de texto.')
      if (fileRef.current) fileRef.current.value = ''
      return
    }
    await upload(file)
  }

  async function upload(file: File) {
    setUploading(true)
    setUploadError(null)
    try {
      const form = new FormData()
      form.append('workspaceId', workspaceId)
      form.append('file', file)
      const result = await uploadCampaignMedia({ data: form })
      if ('error' in result && result.error) {
        setUploadError(result.error)
        return
      }
      onSelect(result as WizardMedia)
      onClose()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Erro ao enviar arquivo.')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function confirmSelection() {
    const file = files.find((f) => f.id === selectedId)
    if (!file) return
    onSelect({
      assetId: file.id,
      filename: file.originalName,
      mimeType: file.mimeType,
      kind: mediaKindFromMime(file.mimeType),
      previewUrl: file.url,
    })
    onClose()
  }

  if (!open) return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Anexar mídia"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        className="absolute inset-0 bg-dark-900/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        className="relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-neutral-200 bg-neutral-0 shadow-xl animate-in"
      >
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
          <div>
            <h2 className="font-display text-lg font-bold text-dark-800">Anexar mídia</h2>
            <p className="text-xs text-neutral-500">Escolha um arquivo do workspace ou envie um novo.</p>
          </div>
          <button
            onClick={onClose}
            className="grid size-8 place-items-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-dark-800 transition-colors"
            aria-label="Fechar"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-2">
          <button
            onClick={() => setTab('files')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors duration-150 ${
              tab === 'files'
                ? 'bg-brand-500 text-white'
                : 'bg-neutral-0 text-dark-600 hover:bg-neutral-50'
            }`}
          >
            {canViewAllFiles ? 'Arquivos do workspace' : 'Meus arquivos'}
          </button>
          <button
            onClick={() => setTab('upload')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors duration-150 ${
              tab === 'upload'
                ? 'bg-brand-500 text-white'
                : 'bg-neutral-0 text-dark-600 hover:bg-neutral-50'
            }`}
          >
            Enviar novo
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === 'files' ? (
            <FilesTab
              files={files}
              loading={loading}
              error={error}
              selectedId={selectedId}
              onSelect={setSelectedId}
              canViewAllFiles={canViewAllFiles}
            />
          ) : (
            <UploadTab
              uploading={uploading}
              error={uploadError}
              fileRef={fileRef}
              accept={ACCEPT_FILE_TYPES}
              onFileChange={handleFileChange}
              onFileSelect={handleUploadFile}
            />
          )}
        </div>

        <div className="flex items-center justify-between border-t border-neutral-100 px-4 py-3">
          <span className="text-xs text-neutral-500">
            {selectedId ? '1 arquivo selecionado' : 'Nenhum arquivo selecionado'}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-dark-600 hover:bg-neutral-100 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={confirmSelection}
              disabled={!selectedId || tab !== 'files'}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              Usar selecionado
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function FilesTab({
  files,
  loading,
  error,
  selectedId,
  onSelect,
  canViewAllFiles,
}: {
  files: WorkspaceFile[]
  loading: boolean
  error: string | null
  selectedId: string | null
  onSelect: (id: string) => void
  canViewAllFiles: boolean
}) {
  if (loading) {
    return <p className="text-sm text-neutral-500 animate-pulse">Carregando arquivos…</p>
  }
  if (error) {
    return <p className="text-sm text-error-500">{error}</p>
  }
  if (files.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-neutral-500">
        {canViewAllFiles
          ? 'Nenhum arquivo neste workspace. Envie um novo na aba "Enviar novo".'
          : 'Você ainda não enviou nenhum arquivo. Envie um novo na aba "Enviar novo".'}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {files.map((file) => {
        const Icon = fileIcon(file.mimeType)
        const isSelected = selectedId === file.id
        return (
          <button
            key={file.id}
            type="button"
            onClick={() => onSelect(file.id)}
            className={`relative flex flex-col gap-2 rounded-lg border p-3 text-left transition-all duration-150 ${
              isSelected
                ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500'
                : 'border-neutral-200 bg-neutral-0 hover:border-brand-300 hover:bg-neutral-50'
            }`}
          >
            <div className="relative aspect-square overflow-hidden rounded-lg bg-neutral-100">
              <FileThumbnail file={file} className="absolute inset-0 size-full" />
              {!isSelected && (
                <span className="absolute inset-0 bg-dark-800/0 hover:bg-dark-800/5 transition-colors" />
              )}
              {isSelected && (
                <span className="absolute right-2 top-2 grid size-5 place-items-center rounded-full bg-brand-500 text-white text-[10px] font-bold">
                  ✓
                </span>
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-dark-800">{file.originalName}</p>
              <p className="text-[10px] text-neutral-500">{formatBytes(file.sizeBytes)}</p>
            </div>
          </button>
        )
      })}
    </div>
  )
}

function UploadTab({
  uploading,
  error,
  fileRef,
  accept,
  onFileChange,
  onFileSelect,
}: {
  uploading: boolean
  error: string | null
  fileRef: React.RefObject<HTMLInputElement | null>
  accept: string
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onFileSelect: (file: File) => void
}) {
  const [dragOver, setDragOver] = useState(false)

  function handleDrop(e: React.DragEvent<HTMLButtonElement>) {
    e.preventDefault()
    setDragOver(false)
    const dropped = e.dataTransfer.files?.[0]
    if (dropped) onFileSelect(dropped)
  }

  return (
    <div className="py-6">
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={onFileChange}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        disabled={uploading}
        className={`flex w-full flex-col items-center gap-3 rounded-xl border-2 border-dashed bg-neutral-50 px-6 py-10 text-center transition-colors duration-150 disabled:opacity-50 ${
          dragOver
            ? 'border-brand-500 bg-brand-50'
            : 'border-neutral-300 hover:border-brand-500 hover:bg-brand-50'
        }`}
      >
        {uploading ? (
          <span className="size-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" aria-hidden="true" />
        ) : (
          <span className="grid size-12 place-items-center rounded-full bg-brand-100 text-brand-500">
            <Upload size={24} aria-hidden="true" />
          </span>
        )}
        <span className="text-sm font-medium text-dark-800">
          {uploading ? 'Enviando…' : 'Clique para enviar um arquivo'}
        </span>
        <span className="text-xs text-neutral-500">
          ou arraste e solte aqui
        </span>
      </button>
      {error && <p className="mt-3 text-sm text-error-500">{error}</p>}
    </div>
  )
}
