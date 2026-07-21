import { createFileRoute, useLoaderData } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import {
  Archive,
  ShieldAlert,
  Trash2,
  Undo2,
  Upload,
} from 'lucide-react'
import {
  deleteWorkspaceFile,
  fetchFileUsage,
  fetchWorkspaceFiles,
  restoreWorkspaceFile,
  uploadWorkspaceFile,
} from '../../../lib/actions'
import { Button } from '../../../components/ui'
import { FilePreviewModal, FileThumbnail, fileIcon, type WorkspaceFile } from '../../../components/file-preview'
import { createHeadConfig } from '~/lib/seo'

export const Route = createFileRoute('/_app/$workspaceId/files')({ head: () => createHeadConfig('Arquivos — Naia Campanhas'),
  component: FilesPage,
})

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log10(bytes) / Math.log10(1024))
  const value = bytes / 1024 ** i
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function FilesPage() {
  const { workspaceId } = Route.useParams()
  const [files, setFiles] = useState<WorkspaceFile[]>([])
  const [status, setStatus] = useState<'active' | 'trashed'>('active')
  const [usage, setUsage] = useState<{ usedBytes: number; quotaBytes: number; percent: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [previewFile, setPreviewFile] = useState<WorkspaceFile | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const { permissions } = useLoaderData({ from: '/_app/$workspaceId' })

  if (!permissions.files) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center">
        <ShieldAlert size={32} className="mx-auto text-neutral-300" aria-hidden="true" />
        <h1 className="mt-4 text-lg font-bold text-dark-800">Sem acesso aos arquivos</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Seu papel neste workspace não inclui esta área. Fale com o Owner se precisar de acesso.
        </p>
      </div>
    )
  }

  async function load() {
    setLoading(true)
    setError(null)
    const [filesRes, usageRes] = await Promise.all([
      fetchWorkspaceFiles({ data: { workspaceId, status } }),
      fetchFileUsage({ data: workspaceId }),
    ])
    setLoading(false)

    if ('error' in filesRes && filesRes.error) {
      setError(filesRes.error)
      return
    }
    if ('error' in usageRes && usageRes.error) {
      setError(usageRes.error)
      return
    }

    setFiles('items' in filesRes ? filesRes.items : [])
    setUsage('usedBytes' in usageRes ? usageRes : null)
  }

  useEffect(() => {
    load()
  }, [workspaceId, status])

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setError(null)

    try {
      const form = new FormData()
      form.append('workspaceId', workspaceId)
      form.append('file', file)

      const result = await uploadWorkspaceFile({ data: form })
      if ('error' in result && result.error) {
        setError(result.error)
        return
      }

      if (fileRef.current) fileRef.current.value = ''
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar arquivo.')
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(fileId: string) {
    setBusyId(fileId)
    const res = await deleteWorkspaceFile({ data: { workspaceId, fileId } })
    setBusyId(null)
    if ('error' in res && res.error) {
      setError(res.error)
      return
    }
    setPreviewFile(null)
    await load()
  }

  async function handleRestore(fileId: string) {
    setBusyId(fileId)
    const res = await restoreWorkspaceFile({ data: { workspaceId, fileId } })
    setBusyId(null)
    if ('error' in res && res.error) {
      setError(res.error)
      return
    }
    setPreviewFile(null)
    await load()
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-dark-800">Arquivos</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Mídias e documentos deste workspace são armazenados no Vianova Storage.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-error-200 bg-error-500/5 px-4 py-3 text-sm text-error-600">
          {error}
        </div>
      )}

      {usage && (
        <div className="rounded-xl border border-neutral-200 bg-neutral-0 p-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-neutral-500">
              {formatBytes(usage.usedBytes)} de {formatBytes(usage.quotaBytes)} usados
            </span>
            <span
              className={`font-semibold ${
                usage.percent > 85 ? 'text-error-500' : usage.percent > 60 ? 'text-warning-500' : 'text-brand-500'
              }`}
            >
              {usage.percent}%
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-neutral-100 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                usage.percent > 85 ? 'bg-error-500' : usage.percent > 60 ? 'bg-warning-500' : 'bg-brand-500'
              }`}
              style={{ width: `${Math.min(100, usage.percent)}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setStatus('active')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors duration-150 ${
              status === 'active'
                ? 'bg-brand-500 text-white'
                : 'bg-neutral-0 border border-neutral-200 text-dark-600 hover:bg-neutral-50'
            }`}
          >
            Ativos
          </button>
          <button
            onClick={() => setStatus('trashed')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors duration-150 ${
              status === 'trashed'
                ? 'bg-brand-500 text-white'
                : 'bg-neutral-0 border border-neutral-200 text-dark-600 hover:bg-neutral-50'
            }`}
          >
            Lixeira
          </button>
        </div>

        {status === 'active' && (
          <>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={handleFileChange}
            />
            <Button onClick={() => fileRef.current?.click()} loading={uploading} className="gap-1.5 w-full sm:w-auto">
              <Upload size={16} aria-hidden="true" />
              Enviar arquivo
            </Button>
          </>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-neutral-500 animate-pulse">Carregando arquivos…</p>
      ) : files.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-200 bg-neutral-0 py-12 text-center space-y-2">
          <Archive size={32} className="mx-auto text-neutral-300" aria-hidden="true" />
          <p className="text-sm text-neutral-500">
            {status === 'active' ? 'Nenhum arquivo neste workspace.' : 'Lixeira vazia.'}
          </p>
        </div>
      ) : (
        <ul className="rounded-xl border border-neutral-200 bg-neutral-0 divide-y divide-neutral-100">
          {files.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              status={status}
              busy={busyId === file.id}
              onPreview={() => setPreviewFile(file)}
              onDelete={() => handleDelete(file.id)}
              onRestore={() => handleRestore(file.id)}
            />
          ))}
        </ul>
      )}

      <FilePreviewModal
        file={previewFile}
        open={Boolean(previewFile)}
        onClose={() => setPreviewFile(null)}
        onDelete={handleDelete}
        onRestore={handleRestore}
        status={status}
      />
    </div>
  )
}

function FileRow({
  file,
  status,
  busy,
  onPreview,
  onDelete,
  onRestore,
}: {
  file: WorkspaceFile
  status: 'active' | 'trashed'
  busy: boolean
  onPreview: () => void
  onDelete: () => void
  onRestore: () => void
}) {
  const Icon = fileIcon(file.mimeType)

  return (
    <li className="group px-4 py-3 flex items-center gap-3 transition-colors duration-150 hover:bg-neutral-50">
      <button
        onClick={onPreview}
        className="shrink-0 transition-transform duration-150 ease-out active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 rounded-lg"
        aria-label={`Visualizar ${file.originalName}`}
      >
        <FileThumbnail file={file} className="size-11 shrink-0" />
      </button>
      <button
        onClick={onPreview}
        className="min-w-0 flex-1 text-left transition-colors duration-150 focus:outline-none"
      >
        <p className="text-sm font-medium text-dark-800 group-hover:text-brand-600 truncate transition-colors duration-150">
          {file.originalName}
        </p>
        <p className="text-xs text-neutral-500">
          {formatBytes(file.sizeBytes)} · {formatDate(file.createdAt)}
        </p>
      </button>
      <button
        onClick={onPreview}
        className="text-xs font-medium text-brand-600 hover:text-brand-700 px-2 py-1 rounded-lg hover:bg-brand-50 transition-colors duration-150"
      >
        Abrir
      </button>
      {status === 'active' ? (
        <IconButton
          busy={busy}
          onClick={onDelete}
          aria-label="Mover para lixeira"
          className="border border-error-500 text-error-500 hover:bg-error-500/5"
        >
          <Trash2 size={16} aria-hidden="true" />
        </IconButton>
      ) : (
        <IconButton
          busy={busy}
          onClick={onRestore}
          aria-label="Restaurar arquivo"
          className="text-emerald-600 hover:bg-emerald-50"
        >
          <Undo2 size={16} aria-hidden="true" />
        </IconButton>
      )}
    </li>
  )
}

function IconButton({
  busy,
  onClick,
  children,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`grid size-8 place-items-center rounded-lg transition-all duration-150 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 ${className}`}
      {...props}
    >
      {busy ? (
        <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
      ) : (
        children
      )}
    </button>
  )
}
