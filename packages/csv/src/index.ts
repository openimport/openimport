import type { DatasetInfo, FormatAdapter, ImportPlugin, SourceFile } from '@openimport/core'
import { detectEncoding } from './encoding'
import { createCsvParser, type Delimiter, sniffDelimiter } from './parser'

export { bomLength, type DetectedEncoding, detectEncoding } from './encoding'
export { type CsvParser, type CsvParserOptions, createCsvParser, type Delimiter, parseCsv, sniffDelimiter } from './parser'

export interface CsvOptions {
  /** Force a delimiter instead of sniffing it. */
  delimiter?: Delimiter
  /** Force a text encoding (any WHATWG label, e.g. `iso-8859-15`) instead of detecting it. */
  encoding?: string
  /** Quote character. Default `"`. */
  quote?: string
  /** Rows per yielded chunk. Default `1000`. */
  chunkSize?: number
  /** Extra file extensions to accept (without dot). */
  extensions?: string[]
}

const SAMPLE_BYTES = 64 * 1024
const EXTENSIONS = ['csv', 'tsv', 'txt', 'tab']
const MIME_TYPES = ['text/csv', 'text/tab-separated-values', 'text/plain', 'application/csv', 'application/vnd.ms-excel']
/** Formats other plugins own, even if the browser reports them as text/plain. */
const FOREIGN = new Set(['json', 'jsonl', 'ndjson', 'xml', 'xlsx', 'xls', 'xlsm', 'ods'])

interface Sniffed {
  encoding: string
  delimiter: Delimiter
  sample: string
  complete: boolean
}

async function sniff(file: SourceFile, options: CsvOptions): Promise<Sniffed> {
  const bytes = new Uint8Array(await file.blob.slice(0, SAMPLE_BYTES).arrayBuffer())
  const encoding = options.encoding ?? detectEncoding(bytes)
  const complete = file.size <= SAMPLE_BYTES
  const sample = new TextDecoder(encoding).decode(bytes, { stream: !complete })
  const ext = file.extension
  const delimiter =
    options.delimiter ?? (ext === 'tsv' || ext === 'tab' ? sniffDelimiter(sample, ['\t', ',', ';', '|']) : sniffDelimiter(sample))
  return { encoding, delimiter, sample, complete }
}

function countRows(text: string, delimiter: Delimiter, quote: string | undefined, complete: boolean): number {
  const parser = createCsvParser({ delimiter, ...(quote ? { quote } : {}) })
  const rows = [...parser.push(text), ...(complete ? parser.flush() : [])]
  return rows.filter((r) => r.length > 0).length
}

/** Stream decoded text chunks from a blob. */
async function* textChunks(blob: Blob, encoding: string, signal: AbortSignal): AsyncGenerator<string> {
  const decoder = new TextDecoder(encoding)
  const reader = blob.stream().getReader()
  try {
    while (true) {
      if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
      const { done, value } = await reader.read()
      if (done) break
      const text = decoder.decode(value, { stream: true })
      if (text) yield text
    }
    const tail = decoder.decode()
    if (tail) yield tail
  } finally {
    // Releases the underlying source when the consumer stops early or aborts.
    await reader.cancel().catch(() => {})
  }
}

/**
 * CSV / TSV format adapter. Zero dependencies, streams via Web Streams, detects
 * the encoding (UTF-8/16 with or without BOM, windows-1252) and the delimiter.
 */
export function csvFormat(options: CsvOptions = {}): FormatAdapter {
  const extensions = [...EXTENSIONS, ...(options.extensions ?? [])]
  const chunkSize = options.chunkSize ?? 1000
  return {
    id: 'csv',
    label: 'CSV',
    capabilities: { streaming: true, cancellation: true, sourceLocations: true },
    extensions,
    mimeTypes: MIME_TYPES,
    supports: (file) => {
      if (extensions.includes(file.extension)) return true
      if (FOREIGN.has(file.extension)) return false
      return MIME_TYPES.includes(file.type)
    },
    inspect: async (file) => {
      const { encoding, delimiter, sample, complete } = await sniff(file, options)
      const sampleRows = countRows(sample, delimiter, options.quote, complete)
      const sampleBytes = Math.min(file.size, SAMPLE_BYTES)
      const rows = complete ? sampleRows : Math.round((sampleRows / Math.max(sampleBytes, 1)) * file.size)
      const dataset: DatasetInfo = {
        id: 'csv',
        label: file.name,
        layout: 'grid',
        // Assume one header row; the core decides the actual header later.
        rowCount: Math.max(rows - 1, 0),
        meta: { delimiter, encoding, ...(complete ? {} : { estimated: true }) },
      }
      return { datasets: [dataset] }
    },
    read: async function* (file, { dataset, signal }) {
      const meta = dataset.meta ?? {}
      const known = typeof meta.delimiter === 'string' && typeof meta.encoding === 'string'
      const { encoding, delimiter } = known
        ? { encoding: meta.encoding as string, delimiter: meta.delimiter as string }
        : await sniff(file, options)
      const parser = createCsvParser({ delimiter, ...(options.quote ? { quote: options.quote } : {}) })
      let buffer: string[][] = []
      let first = true
      for await (let text of textChunks(file.blob, encoding, signal)) {
        if (first) {
          // TextDecoder strips a BOM, but a forced encoding or odd producers may leave U+FEFF.
          if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
          first = false
        }
        for (const row of parser.push(text)) buffer.push(row)
        while (buffer.length >= chunkSize) {
          yield buffer.splice(0, chunkSize)
        }
      }
      for (const row of parser.flush()) buffer.push(row)
      if (buffer.length) yield buffer
      buffer = []
    },
  }
}

/** OpenImport plugin for CSV, TSV and delimited text files. */
export function csv(options: CsvOptions = {}): ImportPlugin {
  return { name: 'csv', formats: [csvFormat(options)] }
}

export default csv
