import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  File,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  Download,
  ExternalLink,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'
import { Button } from './ui'

export type WorkspaceFile = {
  id: string
  url: string
  originalName: string
  mimeType: string
  sizeBytes: number
  status: string
  createdAt: string
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log10(bytes) / Math.log10(1024))
  const value = bytes / 1024 ** i
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function isImage(mimeType: string) {
  return mimeType.startsWith('image/')
}

export function isSafeInlineImage(mimeType: string) {
  return isImage(mimeType) && mimeType !== 'image/svg+xml'
}

export function isVideo(mimeType: string) {
  return mimeType.startsWith('video/')
}

export function isAudio(mimeType: string) {
  return mimeType.startsWith('audio/')
}

export function isPdf(mimeType: string) {
  return mimeType === 'application/pdf'
}

export function isText(mimeType: string) {
  return mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/csv'
}

export function fileIcon(mimeType: string) {
  if (isImage(mimeType)) return FileImage
  if (isAudio(mimeType)) return FileAudio
  if (isVideo(mimeType)) return FileVideo
  if (isPdf(mimeType) || isText(mimeType)) return FileText
  return File
}

function fileKindLabel(mimeType: string) {
  if (isImage(mimeType)) return 'Imagem'
  if (isVideo(mimeType)) return 'Vídeo'
  if (isAudio(mimeType)) return 'Áudio'
  if (isPdf(mimeType)) return 'PDF'
  if (isText(mimeType)) return 'Texto'
  return 'Arquivo'
}

export function FileThumbnail({
  file,
  className = '',
}: {
  file: WorkspaceFile
  className?: string
}) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  const Icon = fileIcon(file.mimeType)

  if (isSafeInlineImage(file.mimeType)) {
    return (
      <div className={`relative overflow-hidden rounded-lg bg-neutral-100 ${className}`}>
        <img
          src={file.url}
          alt={file.originalName}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          className={`absolute inset-0 size-full object-cover transition-opacity duration-200 ${loaded && !error ? 'opacity-100' : 'opacity-0'}`}
        />
        {(!loaded || error) && (
          <span className="absolute inset-0 grid place-items-center text-neutral-400">
            <Icon size={20} aria-hidden="true" />
          </span>
        )}
      </div>
    )
  }

  if (isVideo(file.mimeType)) {
    return (
      <div className={`relative overflow-hidden rounded-lg bg-neutral-900 ${className}`}>
        <video
          src={file.url}
          muted
          preload="metadata"
          onLoadedData={() => setLoaded(true)}
          onError={() => setError(true)}
          className={`absolute inset-0 size-full object-cover transition-opacity duration-200 ${loaded && !error ? 'opacity-100' : 'opacity-0'}`}
        />
        {(!loaded || error) && (
          <span className="absolute inset-0 grid place-items-center text-neutral-400">
            <FileVideo size={20} aria-hidden="true" />
          </span>
        )}
      </div>
    )
  }

  return (
    <div
      className={`grid place-items-center rounded-lg bg-neutral-100 text-dark-400 ${className}`}
    >
      <Icon size={20} aria-hidden="true" />
    </div>
  )
}

export function FilePreviewModal({
  file,
  open,
  onClose,
  onDelete,
  onRestore,
  status = 'active',
}: {
  file: WorkspaceFile | null
  open: boolean
  onClose: () => void
  onDelete?: (fileId: string) => void
  onRestore?: (fileId: string) => void
  status?: 'active' | 'trashed'
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const lastTriggerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (open) {
      lastTriggerRef.current = document.activeElement as HTMLElement
      document.body.classList.add('overflow-hidden')
    } else {
      document.body.classList.remove('overflow-hidden')
      lastTriggerRef.current?.focus()
    }
    return () => {
      document.body.classList.remove('overflow-hidden')
    }
  }, [open])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!open) return
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        )
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last?.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first?.focus()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open || !file) return null

  const Icon = fileIcon(file.mimeType)
  const canPreviewInline = isSafeInlineImage(file.mimeType) || isVideo(file.mimeType) || isAudio(file.mimeType) || isPdf(file.mimeType)

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Visualizar ${file.originalName}`}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        className="absolute inset-0 bg-dark-900/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        className="relative z-10 flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-neutral-200 bg-neutral-0 shadow-xl animate-in"
      >
        <div className="flex items-center gap-3 border-b border-neutral-100 px-4 py-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-neutral-100 text-dark-500">
            <Icon size={18} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-dark-900">{file.originalName}</p>
            <p className="text-xs text-neutral-500">
              {fileKindLabel(file.mimeType)} · {formatBytes(file.sizeBytes)}
            </p>
          </div>
          <Button
            variant="ghost"
            className="size-8 p-0 text-neutral-500 hover:text-dark-800"
            onClick={onClose}
            aria-label="Fechar preview"
          >
            <X size={18} aria-hidden="true" />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center bg-neutral-50 p-4 sm:p-6">
          {isSafeInlineImage(file.mimeType) && (
            <img
              src={file.url}
              alt={file.originalName}
              className="max-h-[60vh] max-w-full rounded-lg object-contain shadow-sm"
            />
          )}
          {isVideo(file.mimeType) && (
            <video
              src={file.url}
              controls
              className="max-h-[60vh] max-w-full rounded-lg"
            />
          )}
          {isAudio(file.mimeType) && (
            <div className="w-full max-w-md space-y-4 rounded-xl bg-neutral-0 p-6 text-center shadow-sm">
              <span className="mx-auto grid size-16 place-items-center rounded-full bg-brand-100 text-brand-500">
                <FileAudio size={28} aria-hidden="true" />
              </span>
              <audio src={file.url} controls className="w-full" />
            </div>
          )}
          {isPdf(file.mimeType) && (
            <iframe
              src={file.url}
              title={file.originalName}
              sandbox=""
              referrerPolicy="no-referrer"
              className="h-[60vh] w-full rounded-lg border border-neutral-200 bg-white"
            />
          )}
          {isText(file.mimeType) && (
            <iframe
              src={file.url}
              title={file.originalName}
              sandbox=""
              referrerPolicy="no-referrer"
              className="h-[60vh] w-full rounded-lg border border-neutral-200 bg-white"
            />
          )}
          {!canPreviewInline && !isText(file.mimeType) && (
            <div className="flex flex-col items-center gap-4 rounded-xl bg-neutral-0 p-8 text-center shadow-sm">
              <span className="grid size-16 place-items-center rounded-full bg-neutral-100 text-dark-400">
                <Icon size={28} aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-medium text-dark-800">{file.originalName}</p>
                <p className="text-xs text-neutral-500">
                  {fileKindLabel(file.mimeType)} · {formatBytes(file.sizeBytes)}
                </p>
              </div>
              <a
                href={file.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 active:scale-[0.97] transition-all duration-150"
              >
                <ExternalLink size={16} aria-hidden="true" />
                Abrir arquivo
              </a>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-neutral-100 px-4 py-3">
          <a
            href={file.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700"
          >
            <ExternalLink size={14} aria-hidden="true" />
            Abrir em nova aba
          </a>
          <div className="flex items-center gap-2">
            <a
              href={file.url}
              download={file.originalName}
              className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-neutral-0 px-3 py-1.5 text-xs font-semibold text-dark-800 hover:bg-neutral-50 active:scale-[0.97] transition-all duration-150"
            >
              <Download size={14} aria-hidden="true" />
              Baixar
            </a>
            {status === 'active' ? (
              <IconButton
                onClick={() => file && onDelete?.(file.id)}
                aria-label="Mover para lixeira"
                className="border border-error-500 text-error-500 hover:bg-error-500/5"
              >
                <Trash2 size={16} aria-hidden="true" />
              </IconButton>
            ) : (
              <IconButton
                onClick={() => file && onRestore?.(file.id)}
                aria-label="Restaurar arquivo"
                className="text-emerald-600 hover:bg-emerald-50"
              >
                <Undo2 size={16} aria-hidden="true" />
              </IconButton>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function IconButton({
  onClick,
  children,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`grid size-8 place-items-center rounded-lg transition-all duration-150 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
