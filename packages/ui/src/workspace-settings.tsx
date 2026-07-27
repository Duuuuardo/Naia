import { useRef, useState, type ReactNode } from 'react'
import { Briefcase, Building2, Camera, CheckCircle2, MapPin, Trash2 } from 'lucide-react'
import { Button, Card, ErrorNote, PageHeader, WorkspaceAvatar } from './dashboard'
import { IndustrySelect } from './industry-select'

export type WorkspaceSettingsValues = {
  name: string
  description: string
  location: string
  industry: string
  avatarUrl: string
}

async function fileToAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const size = 192
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas indisponível.')

  const scale = Math.max(size / bitmap.width, size / bitmap.height)
  const width = bitmap.width * scale
  const height = bitmap.height * scale
  context.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height)
  return canvas.toDataURL('image/jpeg', 0.85)
}

function validateWorkspaceName(name: string): string | null {
  if (!name.trim()) return 'Informe o nome do workspace.'
  if (name.trim().length > 80) return 'O nome deve ter no máximo 80 caracteres.'
  return null
}

export function WorkspaceSettingsView({
  initialValues,
  onSave,
  onSaved,
  children,
}: {
  initialValues: WorkspaceSettingsValues
  onSave: (values: WorkspaceSettingsValues) => Promise<{ error?: string }>
  onSaved?: () => void | Promise<void>
  children?: ReactNode
}) {
  const [values, setValues] = useState(initialValues)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function update<Key extends keyof WorkspaceSettingsValues>(
    key: Key,
    value: WorkspaceSettingsValues[Key],
  ) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setError(null)
    try {
      update('avatarUrl', await fileToAvatarDataUrl(file))
    } catch {
      setError('Não foi possível ler a imagem. Tente outro arquivo.')
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const nextNameError = validateWorkspaceName(values.name)
    setNameError(nextNameError)
    if (nextNameError) return

    setSaving(true)
    setSaved(false)
    setError(null)
    const normalized = {
      name: values.name.trim(),
      description: values.description.trim(),
      location: values.location.trim(),
      industry: values.industry.trim(),
      avatarUrl: values.avatarUrl,
    }
    const result = await onSave(normalized)
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setValues(normalized)
    setSaved(true)
    await onSaved?.()
  }

  return (
    <div className="mx-auto max-w-2xl py-2 font-sans">
      <PageHeader
        title="Configurações do workspace"
        subtitle="Identidade e informações básicas deste workspace."
      />

      <form onSubmit={handleSubmit} className="mt-6 space-y-6">
        <Card className="p-5">
          <div className="flex flex-col items-center gap-5 sm:flex-row">
            <div className="relative shrink-0">
              <WorkspaceAvatar name={values.name} picture={values.avatarUrl} size="lg" />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                aria-label="Trocar avatar do workspace"
                className="absolute -bottom-1.5 -right-1.5 grid size-7 place-items-center rounded-full bg-dark-800 text-white shadow-sm transition-[background-color,transform] duration-150 ease-out hover:bg-dark-700 active:scale-[0.97]"
              >
                <Camera size={13} aria-hidden="true" />
              </button>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-dark-800">Avatar do workspace</p>
              <p className="mt-0.5 text-xs leading-relaxed text-neutral-500">
                Aparece no topo do app e ajuda a distinguir workspaces. PNG ou JPG, recortada em
                quadrado.
              </p>
              {values.avatarUrl && (
                <button
                  type="button"
                  onClick={() => update('avatarUrl', '')}
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-neutral-500 transition-colors duration-150 hover:text-error-600"
                >
                  <Trash2 size={12} aria-hidden="true" />
                  Remover avatar
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={handleFile}
              className="hidden"
            />
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          <div>
            <label htmlFor="ws-name" className="mb-1.5 block text-sm font-semibold text-dark-800">
              Nome
            </label>
            <input
              id="ws-name"
              type="text"
              value={values.name}
              onChange={(event) => {
                update('name', event.target.value)
                setNameError(null)
              }}
              onBlur={() => setNameError(validateWorkspaceName(values.name))}
              aria-invalid={nameError ? true : undefined}
              required
              maxLength={80}
              className={`h-10 w-full rounded-md border px-3 text-sm outline-none transition-colors focus:border-brand-500 focus:ring-1 focus:ring-brand-500 ${
                nameError ? 'border-error-500' : 'border-neutral-300 bg-neutral-0 text-dark-800'
              }`}
            />
            {nameError && (
              <span className="mt-1 block text-[11px] text-error-500" role="alert">
                {nameError}
              </span>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="ws-location"
                className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-dark-800"
              >
                <MapPin size={14} className="text-neutral-400" aria-hidden="true" />
                Localização
              </label>
              <input
                id="ws-location"
                type="text"
                value={values.location}
                onChange={(event) => update('location', event.target.value)}
                placeholder="São Paulo, Brasil"
                maxLength={120}
                className="h-10 w-full rounded-md border border-neutral-300 bg-neutral-0 px-3 text-sm text-dark-800 outline-none transition-colors focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label
                htmlFor="ws-industry"
                className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-dark-800"
              >
                <Briefcase size={14} className="text-neutral-400" aria-hidden="true" />
                Área de atuação
              </label>
              <IndustrySelect
                id="ws-industry"
                value={values.industry}
                onChange={(value) => update('industry', value)}
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="ws-description"
              className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-dark-800"
            >
              <Building2 size={14} className="text-neutral-400" aria-hidden="true" />
              Descrição
            </label>
            <textarea
              id="ws-description"
              value={values.description}
              onChange={(event) => update('description', event.target.value)}
              rows={3}
              maxLength={300}
              placeholder="Ex: empresa, projeto ou time específico."
              className="w-full resize-none rounded-md border border-neutral-300 bg-neutral-0 px-3 py-2 text-sm text-dark-800 outline-none transition-colors focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>
        </Card>

        {error && <ErrorNote>{error}</ErrorNote>}
        {saved && (
          <div className="flex items-center gap-2 rounded-lg border border-success-500/25 bg-success-500/5 px-3.5 py-2.5 text-sm font-medium text-success-500">
            <CheckCircle2 size={15} aria-hidden="true" />
            Configurações salvas.
          </div>
        )}

        <div className="flex justify-end">
          <Button type="submit" loading={saving} disabled={!values.name.trim()}>
            Salvar alterações
          </Button>
        </div>
      </form>

      {children}
    </div>
  )
}
