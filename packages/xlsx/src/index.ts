import type { DatasetInfo, FormatAdapter, ImportError, ImportPlugin, RawValue, SourceFile } from '@openimport/core'
import readXlsxFile from 'read-excel-file/universal'

export interface XlsxOptions {
  /** Trim whitespace around string cells. Default `true`. */
  trim?: boolean
  /** Include sheets without any data. Default `false`. */
  includeEmptySheets?: boolean
  /** Rows per yielded chunk. Default `1000`. */
  chunkSize?: number
}

interface ParsedSheet {
  name: string
  rows: RawValue[][]
}

const EXTENSIONS = ['xlsx', 'xlsm']
const MIME_TYPES = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel.sheet.macroEnabled.12']

const isEmptyCell = (v: RawValue) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')

/** Drop trailing empty rows and the trailing empty cells of each row. */
function compact(rows: RawValue[][]): RawValue[][] {
  const out = rows.map((row) => {
    let end = row.length
    while (end > 0 && isEmptyCell(row[end - 1])) end--
    return end === row.length ? row : row.slice(0, end)
  })
  let last = out.length
  while (last > 0 && (out[last - 1] as RawValue[]).length === 0) last--
  return out.slice(0, last)
}

/**
 * Excel (.xlsx / .xlsm) format adapter. Every non-empty sheet becomes a
 * dataset. Dates arrive as `Date`, numbers and booleans keep their type.
 */
export function xlsxFormat(options: XlsxOptions = {}): FormatAdapter {
  // Parsing a workbook is the expensive part — share it between inspect() and read().
  const cache = new WeakMap<Blob, Promise<ParsedSheet[]>>()
  const parse = (file: SourceFile): Promise<ParsedSheet[]> => {
    let pending = cache.get(file.blob)
    if (!pending) {
      pending = readXlsxFile(file.blob, { trim: options.trim ?? true })
        .then((sheets) => sheets.map((s) => ({ name: s.sheet, rows: compact(s.data as unknown as RawValue[][]) })))
        .catch((cause: unknown) => {
          cache.delete(file.blob)
          throw {
            code: 'parse_failed',
            message: 'This Excel file could not be read. Is it a valid .xlsx file?',
            cause,
          } satisfies ImportError
        })
      cache.set(file.blob, pending)
    }
    return pending
  }
  const chunkSize = options.chunkSize ?? 1000

  return {
    id: 'xlsx',
    label: 'Excel',
    capabilities: { streaming: false, cancellation: true, sourceLocations: true },
    extensions: [...EXTENSIONS, 'xls'],
    mimeTypes: MIME_TYPES,
    // Extension first: Windows browsers report .csv files as `application/vnd.ms-excel`.
    supports: (file) => [...EXTENSIONS, 'xls'].includes(file.extension) || (!file.extension && MIME_TYPES.includes(file.type)),
    inspect: async (file) => {
      if (file.extension === 'xls') {
        throw {
          code: 'unsupported_file',
          message: 'Legacy .xls files are not supported. Please save the file as .xlsx (Excel Workbook) and try again.',
        } satisfies ImportError
      }
      const sheets = await parse(file)
      const datasets: DatasetInfo[] = sheets
        .filter((s) => options.includeEmptySheets || s.rows.length > 0)
        .map((s) => ({
          id: s.name,
          label: s.name,
          path: s.name,
          layout: 'grid',
          rowCount: Math.max(s.rows.length - 1, 0),
          meta: { columns: Math.max(0, ...s.rows.slice(0, 50).map((r) => r.length)) },
        }))
      return { datasets }
    },
    read: async function* (file, { dataset, signal }) {
      const sheets = await parse(file)
      const sheet = sheets.find((s) => s.name === dataset.id)
      if (!sheet) throw { code: 'parse_failed', message: `Sheet "${dataset.id}" not found` } satisfies ImportError
      for (let i = 0; i < sheet.rows.length; i += chunkSize) {
        if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
        yield sheet.rows.slice(i, i + chunkSize)
      }
    },
  }
}

/** OpenImport plugin for Excel workbooks. */
export function xlsx(options: XlsxOptions = {}): ImportPlugin {
  return { name: 'xlsx', formats: [xlsxFormat(options)] }
}

export default xlsx
