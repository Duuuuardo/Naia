import { useEffect, useRef, useState } from 'react'
import { Mic, Square, Trash2 } from 'lucide-react'
import { confirmFile, presignFile } from '../../lib/inbox-session'
import { xhrPut, type ComposerAttachment } from './attachment-picker'

// Gravação de áudio no composer: MediaRecorder + getUserMedia. Ao parar, o
// blob sobe pelo mesmo fluxo presigned do attachment-picker (presign → PUT
// direto no MinIO → confirm) e vira um chip de anexo kind 'audio'.

// Melhor mimeType suportado pelo browser, em ordem de preferência.
function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
  ]
  return candidates.find((c) => MediaRecorder.isTypeSupported(c))
}

const EXT_FROM_MIME: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
}

function extFromMime(mimeType: string): string {
  const base = mimeType.split(';')[0]!.trim()
  return EXT_FROM_MIME[base] ?? 'webm'
}

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function AudioRecorder({ onAttach }: { onAttach: (attachment: ComposerAttachment) => void }) {
  const [recording, setRecording] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const cancelledRef = useRef(false)
  const mimeTypeRef = useRef<string>('')

  // Libera o microfone se o componente desmontar no meio de uma gravação.
  useEffect(() => {
    return () => {
      cancelledRef.current = true
      recorderRef.current?.stop()
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  // Erros (ex.: permissão negada) somem sozinhos depois de alguns segundos.
  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError(null), 6000)
    return () => clearTimeout(timer)
  }, [error])

  useEffect(() => {
    if (!recording) return
    const timer = setInterval(() => setElapsed((v) => v + 1), 1000)
    return () => clearInterval(timer)
  }, [recording])

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  async function start() {
    setError(null)
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('Gravação de áudio não é suportada neste navegador.')
      return
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
        setError('Permissão de microfone negada. Libere o acesso no navegador.')
      } else {
        setError('Não foi possível acessar o microfone.')
      }
      return
    }

    const mimeType = pickMimeType()
    mimeTypeRef.current = mimeType ?? ''
    chunksRef.current = []
    cancelledRef.current = false

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    recorderRef.current = recorder
    streamRef.current = stream

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }
    recorder.onstop = () => {
      stopStream()
      setRecording(false)
      if (cancelledRef.current) return
      const type = recorder.mimeType || mimeTypeRef.current || 'audio/webm'
      const blob = new Blob(chunksRef.current, { type })
      chunksRef.current = []
      if (blob.size === 0) return
      void upload(blob)
    }

    recorder.start()
    setElapsed(0)
    setRecording(true)
  }

  function stop() {
    recorderRef.current?.stop()
  }

  function cancel() {
    cancelledRef.current = true
    recorderRef.current?.stop()
  }

  async function upload(blob: Blob) {
    setUploading(true)
    try {
      const mimeType = blob.type || 'audio/webm'
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      const filename = `audio-${stamp}.${extFromMime(mimeType)}`

      const presign = await presignFile({ data: { filename, mimeType, sizeBytes: blob.size } })
      if (!presign) throw new Error('presign falhou')
      await xhrPut(presign.uploadUrl, blob, () => {})
      const confirmed = await confirmFile({ data: { fileId: presign.fileId } })
      if (!confirmed) throw new Error('confirm falhou')

      onAttach({
        fileId: confirmed.id,
        filename: confirmed.filename,
        kind: 'audio',
        storageKey: confirmed.storageKey,
      })
    } catch {
      setError('Falha ao enviar o áudio. Tente novamente.')
    } finally {
      setUploading(false)
    }
  }

  if (recording) {
    return (
      <div className="flex shrink-0 items-center gap-1.5 rounded-md bg-neutral-100 py-1.5 pl-2.5 pr-1.5">
        <span className="size-2 animate-pulse rounded-full bg-error-500" aria-hidden="true" />
        <span className="text-xs font-medium tabular-nums text-dark-800">{formatElapsed(elapsed)}</span>
        <button
          type="button"
          onClick={stop}
          aria-label="Parar e anexar áudio"
          className="grid size-7 place-items-center rounded-md text-dark-800 transition-colors hover:bg-neutral-200"
        >
          <Square size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={cancel}
          aria-label="Cancelar gravação"
          className="grid size-7 place-items-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-200 hover:text-error-500"
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </div>
    )
  }

  return (
    <div className="relative shrink-0">
      {error && (
        <p className="absolute bottom-full left-1/2 z-20 mb-1 w-52 -translate-x-1/2 rounded-md border border-neutral-200 bg-neutral-0 px-2 py-1.5 text-center text-[11px] font-medium text-error-500 shadow-lg">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={start}
        disabled={uploading}
        aria-label="Gravar áudio"
        className="grid size-10 place-items-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-dark-800 disabled:opacity-60"
      >
        {uploading ? (
          <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          <Mic size={18} aria-hidden="true" />
        )}
      </button>
    </div>
  )
}
