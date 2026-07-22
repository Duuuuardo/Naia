import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'

export const INDUSTRIES = [
  'Varejo / E-commerce',
  'Saúde / Bem-estar',
  'Educação / Cursos',
  'Imobiliário',
  'Serviços / Consultoria',
  'Alimentação / Restaurantes',
  'Beleza / Estética',
  'Tecnologia',
  'Financeiro / Seguros',
  'Eventos / Entretenimento',
] as const

const OTHER_VALUE = '__other__'

function isKnownIndustry(value: string) {
  return INDUSTRIES.some((industry) => industry === value)
}

export function IndustrySelect({
  id,
  value,
  onChange,
  required,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  required?: boolean
}) {
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listboxRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [animateOpen, setAnimateOpen] = useState(true)
  const [query, setQuery] = useState('')
  const [customMode, setCustomMode] = useState(Boolean(value) && !isKnownIndustry(value))

  const filteredIndustries = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR')
    if (!normalizedQuery) return INDUSTRIES
    return INDUSTRIES.filter((industry) =>
      industry.toLocaleLowerCase('pt-BR').includes(normalizedQuery),
    )
  }, [query])

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) close()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [])

  useEffect(() => {
    if (open) searchRef.current?.focus()
  }, [open])

  function close() {
    setOpen(false)
    setQuery('')
  }

  function select(nextValue: string) {
    if (nextValue === OTHER_VALUE) {
      setCustomMode(true)
      onChange('')
    } else {
      setCustomMode(false)
      onChange(nextValue)
    }
    close()
  }

  function handleTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setAnimateOpen(false)
      setOpen(true)
    }
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
    if (event.key === 'Enter' && filteredIndustries.length === 1) {
      event.preventDefault()
      select(filteredIndustries[0])
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      listboxRef.current?.querySelector<HTMLButtonElement>('[role="option"]')?.focus()
    }
  }

  function handleOptionKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      document.getElementById(id)?.focus()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return

    event.preventDefault()
    const options = Array.from(
      listboxRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
    )
    const currentIndex = options.indexOf(event.currentTarget)
    const nextIndex = event.key === 'ArrowDown'
      ? (currentIndex + 1) % options.length
      : (currentIndex - 1 + options.length) % options.length
    options[nextIndex]?.focus()
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onPointerDown={() => setAnimateOpen(true)}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
        className="flex h-10 w-full items-center justify-between gap-3 rounded-md border border-neutral-300 bg-white px-3.5 text-left text-sm text-dark-800 outline-none transition-[border-color,box-shadow,transform] duration-150 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 active:scale-[0.99]"
      >
        <span className={value ? 'truncate font-medium' : 'truncate text-neutral-400'}>
          {value || (customMode ? 'Informe sua área' : 'Selecione uma área…')}
        </span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={`shrink-0 text-neutral-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className={`${animateOpen ? 'industry-popover' : ''} absolute left-0 right-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg`}>
          <div className="relative border-b border-neutral-100 p-2">
            <Search
              size={15}
              aria-hidden="true"
              className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-neutral-400"
            />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Buscar área…"
              aria-label="Buscar área de atuação"
              className="h-9 w-full rounded-md border-neutral-200 bg-neutral-50 pl-9 pr-3 text-sm focus:bg-white"
            />
          </div>

          <div ref={listboxRef} id={listboxId} role="listbox" aria-label="Áreas de atuação" className="max-h-52 overflow-y-auto p-1.5">
            {filteredIndustries.map((industry) => (
              <button
                key={industry}
                type="button"
                role="option"
                aria-selected={value === industry}
                onClick={() => select(industry)}
                onKeyDown={handleOptionKeyDown}
                className="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-sm text-dark-700 transition-colors duration-100 hover:bg-brand-50 hover:text-brand-700 focus-visible:bg-brand-50"
              >
                <span>{industry}</span>
                {value === industry && <Check size={15} className="shrink-0 text-brand-500" aria-hidden="true" />}
              </button>
            ))}

            {filteredIndustries.length === 0 && (
              <p className="px-2.5 py-3 text-center text-xs text-neutral-500">Nenhuma área encontrada.</p>
            )}

            <div className="mt-1 border-t border-neutral-100 pt-1">
              <button
                type="button"
                role="option"
                aria-selected={customMode}
                onClick={() => select(OTHER_VALUE)}
                onKeyDown={handleOptionKeyDown}
                className="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-sm font-medium text-dark-700 transition-colors duration-100 hover:bg-brand-50 hover:text-brand-700 focus-visible:bg-brand-50"
              >
                Outra área
                {customMode && <Check size={15} className="shrink-0 text-brand-500" aria-hidden="true" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {customMode && !open && (
        <div className="mt-2">
          <label htmlFor={`${id}-custom`} className="sr-only">Outra área de atuação</label>
          <input
            id={`${id}-custom`}
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Ex.: Contabilidade"
            required={required}
            autoFocus={!value}
            maxLength={80}
            className="h-10 w-full rounded-md border border-neutral-300 bg-white px-3.5 text-sm text-dark-800 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />
          <p className="mt-1.5 text-xs text-neutral-400">Digite a área que melhor descreve o workspace.</p>
        </div>
      )}
    </div>
  )
}
