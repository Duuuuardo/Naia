import { useEffect, useRef, useState } from 'react'
import { FileUp } from 'lucide-react'
import { Button, ErrorNote, Modal } from '../ui'
import { importContacts, type ContactImportResult, type ContactImportRow } from '../../lib/inbox-session'
import { parseContactsCsv } from './csv'

type Step = 'upload' | 'preview' | 'result'
type ImportMode = 'skip' | 'update'

const PREVIEW_LIMIT = 10

// Importação de contatos em 3 passos: upload do CSV → preview + modo →
// resultado (criados/atualizados/pulados/erros).
export function ImportContactsModal({
  open,
  onClose,
  onImported,
}: {
  open: boolean
  onClose: () => void
  onImported: () => void
}) {
  const [step, setStep] = useState<Step>('upload')
  const [fileName, setFileName] = useState<string | null>(null)
  const [rows, setRows] = useState<ContactImportRow[]>([])
  const [mode, setMode] = useState<ImportMode>('skip')
  const [result, setResult] = useState<ContactImportResult | null>(null)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Reseta o fluxo sempre que o modal abre.
  useEffect(() => {
    if (!open) return
    setStep('upload')
    setFileName(null)
    setRows([])
    setMode('skip')
    setResult(null)
    setImporting(false)
    setError(null)
  }, [open])

  function handleFile(file: File) {
    setError(null)
    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      const parsed = parseContactsCsv(text)
      if (parsed.length === 0) {
        setError(
          'Nenhum contato encontrado no arquivo. Confira o cabeçalho: nome, email, empresa, whatsapp, telegram, tags.',
        )
        return
      }
      setFileName(file.name)
      setRows(parsed)
      setStep('preview')
    }
    reader.onerror = () => setError('Não foi possível ler o arquivo.')
    reader.readAsText(file, 'utf-8')
  }

  async function handleImport() {
    if (importing || rows.length === 0) return
    setImporting(true)
    setError(null)
    try {
      const res = await importContacts({ data: { rows, mode } })
      setResult(res)
      setStep('result')
      onImported()
    } catch {
      setError('Não foi possível importar os contatos. Tente de novo.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Importar contatos"
      footer={
        step === 'upload' ? (
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancelar
          </Button>
        ) : step === 'preview' ? (
          <>
            <Button variant="secondary" size="sm" onClick={() => setStep('upload')} disabled={importing}>
              Voltar
            </Button>
            <Button size="sm" icon={FileUp} loading={importing} onClick={handleImport}>
              Importar {rows.length} {rows.length === 1 ? 'contato' : 'contatos'}
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={onClose}>
            Concluir
          </Button>
        )
      }
    >
      {step === 'upload' && (
        <div className="space-y-3">
          {error && <ErrorNote>{error}</ErrorNote>}
          <p className="text-sm text-neutral-500">
            Selecione um arquivo CSV com o cabeçalho{' '}
            <code className="rounded bg-neutral-100 px-1 text-xs">nome,email,empresa,whatsapp,telegram,tags</code>.
            Separador por vírgula ou ponto e vírgula.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFile(file)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="grid w-full place-items-center gap-2 rounded-lg border border-dashed border-neutral-300 px-4 py-10 text-sm text-neutral-500 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600"
          >
            <FileUp size={20} aria-hidden="true" />
            Clique para selecionar o arquivo .csv
          </button>
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-3">
          {error && <ErrorNote>{error}</ErrorNote>}
          <p className="text-sm text-neutral-500">
            <span className="font-semibold text-dark-800">{fileName}</span> — {rows.length}{' '}
            {rows.length === 1 ? 'contato encontrado' : 'contatos encontrados'}
            {rows.length > PREVIEW_LIMIT && ` (mostrando os ${PREVIEW_LIMIT} primeiros)`}.
          </p>
          <div className="max-h-56 overflow-auto rounded-lg border border-neutral-100">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-neutral-100 bg-neutral-50 text-neutral-400">
                  <th className="px-3 py-2 font-medium">Nome</th>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Empresa</th>
                  <th className="px-3 py-2 font-medium">WhatsApp</th>
                  <th className="px-3 py-2 font-medium">Telegram</th>
                  <th className="px-3 py-2 font-medium">Tags</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, PREVIEW_LIMIT).map((row, index) => (
                  <tr key={index} className="border-b border-neutral-50 text-dark-800 last:border-b-0">
                    <td className="max-w-32 truncate px-3 py-2 font-medium">{row.name || '—'}</td>
                    <td className="max-w-32 truncate px-3 py-2">{row.email ?? '—'}</td>
                    <td className="max-w-24 truncate px-3 py-2">{row.company ?? '—'}</td>
                    <td className="max-w-28 truncate px-3 py-2">{row.whatsapp ?? '—'}</td>
                    <td className="max-w-24 truncate px-3 py-2">{row.telegram ?? '—'}</td>
                    <td className="max-w-28 truncate px-3 py-2">{row.tags ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <label htmlFor="import-mode">Se o contato já existir</label>
            <select id="import-mode" value={mode} onChange={(e) => setMode(e.target.value as ImportMode)}>
              <option value="skip">Pular existentes</option>
              <option value="update">Atualizar existentes</option>
            </select>
            <p className="mt-1 text-xs text-neutral-400">
              {mode === 'skip'
                ? 'Contatos já cadastrados (mesmo canal e identificador) são ignorados.'
                : 'Contatos já cadastrados têm os dados atualizados e recebem tags/canais novos.'}
            </p>
          </div>
        </div>
      )}

      {step === 'result' && result && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-dark-800">Importação concluída.</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-neutral-50 px-2 py-3">
              <p className="text-lg font-bold text-dark-800">{result.created}</p>
              <p className="text-xs text-neutral-400">{result.created === 1 ? 'criado' : 'criados'}</p>
            </div>
            <div className="rounded-lg bg-neutral-50 px-2 py-3">
              <p className="text-lg font-bold text-dark-800">{result.updated}</p>
              <p className="text-xs text-neutral-400">{result.updated === 1 ? 'atualizado' : 'atualizados'}</p>
            </div>
            <div className="rounded-lg bg-neutral-50 px-2 py-3">
              <p className="text-lg font-bold text-dark-800">{result.skipped}</p>
              <p className="text-xs text-neutral-400">{result.skipped === 1 ? 'pulado' : 'pulados'}</p>
            </div>
          </div>
          {result.errors.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-error-500">
                {result.errors.length} {result.errors.length === 1 ? 'linha com erro' : 'linhas com erro'}
              </p>
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-neutral-100 p-3 text-xs text-neutral-500">
                {result.errors.map((err, index) => (
                  <li key={index}>
                    <span className="font-semibold text-dark-800">Linha {err.row}:</span> {err.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
