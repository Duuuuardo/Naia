import type { ContactImportRow } from '../../lib/inbox-session'

// Parser de CSV do lado do cliente para a importação de contatos.
// Suporta ';' (Excel pt-BR) ou ',' como separador — detectado pelo cabeçalho —
// campos entre aspas com escape "" (dobrando a aspa) e BOM (\uFEFF).

// Aliases de cabeçalho aceitos (pt-BR e inglês) → campo da linha de importação.
const COLUMN_ALIASES: Record<string, keyof ContactImportRow> = {
  nome: 'name',
  name: 'name',
  email: 'email',
  'e-mail': 'email',
  empresa: 'company',
  company: 'company',
  whatsapp: 'whatsapp',
  phone: 'whatsapp',
  telefone: 'whatsapp',
  celular: 'whatsapp',
  telegram: 'telegram',
  tags: 'tags',
}

// Divide o texto em linhas de campos, respeitando aspas (com escape "") e
// quebras de linha dentro de campos entre aspas.
function parseCsvText(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === delimiter) {
      row.push(field)
      field = ''
      continue
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      rows.push(row)
      row = []
      continue
    }
    field += ch
  }
  // Última linha (arquivo sem \n final).
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

// Detecta o separador pelo cabeçalho: o que aparecer mais vence
// (Excel pt-BR exporta com ';').
function detectDelimiter(headerLine: string): string {
  return headerLine.split(';').length >= headerLine.split(',').length ? ';' : ','
}

// Converte o texto do arquivo em linhas de importação. Linhas totalmente
// vazias são ignoradas; a primeira linha é tratada como cabeçalho.
export function parseContactsCsv(raw: string): ContactImportRow[] {
  const text = raw.replace(/^\uFEFF/, '')
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const delimiter = detectDelimiter(firstLine)
  const table = parseCsvText(text, delimiter)
  if (table.length === 0) return []

  const columns = table[0].map((cell) => COLUMN_ALIASES[cell.trim().toLowerCase()] ?? null)

  const rows: ContactImportRow[] = []
  for (const cells of table.slice(1)) {
    const record: Partial<Record<keyof ContactImportRow, string>> = {}
    cells.forEach((cell, index) => {
      const key = columns[index]
      const value = cell.trim()
      if (key && value) record[key] = value
    })
    if (Object.keys(record).length === 0) continue
    rows.push({
      name: record.name ?? '',
      email: record.email,
      company: record.company,
      whatsapp: record.whatsapp,
      telegram: record.telegram,
      tags: record.tags,
    })
  }
  return rows
}
