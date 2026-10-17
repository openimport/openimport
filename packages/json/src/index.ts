import type { DatasetInfo, FormatAdapter, ImportError, ImportPlugin, RawValue, SourceFile } from '@openimport/core'
import { type Collection, discoverCollections, isPlainObject, type Json, resolve, type Segment } from './discover'

export { ANY, type Collection, discoverCollections, formatPath, resolve, type Segment } from './discover'

export interface JsonOptions {
  /** Rows per yielded chunk. Default `1000`. */
  chunkSize?: number
  /** How deep to look for record arrays. Default `8`. */
  maxDepth?: number
}

export interface JsonlOptions {
  /** Rows per yielded chunk. Default `1000`. */
  chunkSize?: number
}

const aborted = (signal: AbortSignal) => signal.reason ?? new DOMException('Aborted', 'AbortError')
const fail = (message: string, cause?: unknown): ImportError => ({ code: 'parse_failed', message, ...(cause ? { cause } : {}) })

/** Records keyed by id (`{ "u1": {…}, "u2": {…} }`) are exposed with their key as `_key`. */
const MAP_SEGMENTS: Segment[] = ['__map__']

interface ParsedJson {
  doc: Json
  datasets: { info: DatasetInfo; segments: Segment[] }[]
}

function labelFor(segments: Segment[], fallback: string): string {
  const keys = segments.filter((s): s is string => typeof s === 'string')
  return keys.length ? keys.join(' › ') : fallback
}

function analyse(doc: Json, fileName: string, maxDepth: number): ParsedJson['datasets'] {
  const collections: Collection[] = discoverCollections(doc, { maxDepth })
  const datasets = collections.map((c) => ({
    info: { id: c.path, label: labelFor(c.segments, fileName), path: c.path, layout: 'records' as const, rowCount: c.count },
    segments: c.segments,
  }))
  if (datasets.length || !isPlainObject(doc)) return datasets

  const values = Object.values(doc)
  if (values.length >= 2 && values.every(isPlainObject)) {
    return [{ info: { id: '$.*', label: fileName, path: '$.*', layout: 'records', rowCount: values.length }, segments: MAP_SEGMENTS }]
  }
  // A single object: one record.
  return [{ info: { id: '$', label: fileName, path: '$', layout: 'records', rowCount: 1 }, segments: [] }]
}

function* records(doc: Json, segments: Segment[]): Generator<Record<string, RawValue>> {
  if (segments === MAP_SEGMENTS) {
    if (isPlainObject(doc))
      for (const [key, value] of Object.entries(doc)) if (isPlainObject(value)) yield { _key: key, ...(value as Record<string, RawValue>) }
    return
  }
  for (const item of resolve(doc, segments)) if (isPlainObject(item)) yield item as Record<string, RawValue>
}

async function readText(file: SourceFile): Promise<string> {
  const text = await file.blob.text()
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/**
 * JSON format adapter. Every array of objects in the document becomes a
 * dataset (`$.data.customers[*]`), the top-level array first.
 */
export function jsonFormat(options: JsonOptions = {}): FormatAdapter {
  const cache = new WeakMap<Blob, Promise<ParsedJson>>()
  const parse = (file: SourceFile) => {
    let pending = cache.get(file.blob)
    if (!pending) {
      pending = readText(file).then((text) => {
        let doc: Json
        try {
          doc = JSON.parse(text)
        } catch (error) {
          cache.delete(file.blob)
          throw fail(`Invalid JSON: ${(error as Error).message}`, error)
        }
        return { doc, datasets: analyse(doc, file.name, options.maxDepth ?? 8) }
      })
      cache.set(file.blob, pending)
    }
    return pending
  }
  const chunkSize = options.chunkSize ?? 1000

  return {
    id: 'json',
    label: 'JSON',
    capabilities: { streaming: false, cancellation: true, sourceLocations: false },
    extensions: ['json'],
    mimeTypes: ['application/json', 'text/json'],
    inspect: async (file) => {
      const { datasets } = await parse(file)
      return { datasets: datasets.map((d) => d.info) }
    },
    read: async function* (file, { dataset, signal }) {
      if (signal.aborted) throw aborted(signal)
      const { doc, datasets } = await parse(file)
      const match = datasets.find((d) => d.info.id === dataset.id)
      if (!match) throw fail(`Dataset "${dataset.id}" not found`)
      let chunk: Record<string, RawValue>[] = []
      for (const record of records(doc, match.segments)) {
        chunk.push(record)
        if (chunk.length >= chunkSize) {
          if (signal.aborted) throw aborted(signal)
          yield chunk
          chunk = []
        }
      }
      if (signal.aborted) throw aborted(signal)
      if (chunk.length) yield chunk
    },
  }
}

const JSONL_SAMPLE = 64 * 1024

async function* lines(blob: Blob, signal: AbortSignal): AsyncGenerator<{ line: string; number: number }> {
  const reader = blob.stream().getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let number = 0
  try {
    while (true) {
      if (signal.aborted) throw aborted(signal)
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      let nl = buffer.indexOf('\n')
      while (nl !== -1) {
        number++
        yield { line: buffer.slice(0, nl), number }
        buffer = buffer.slice(nl + 1)
        nl = buffer.indexOf('\n')
      }
      if (done) break
    }
    if (buffer) yield { line: buffer, number: number + 1 }
  } finally {
    await reader.cancel().catch(() => {})
  }
}

function parseLine(line: string, number: number): Record<string, RawValue> | undefined {
  const text = (number === 1 && line.charCodeAt(0) === 0xfeff ? line.slice(1) : line).trim()
  if (!text) return undefined
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw fail(`Invalid JSON on line ${number}: ${(error as Error).message}`, error)
  }
  return isPlainObject(value) ? (value as Record<string, RawValue>) : { value: value as RawValue }
}

/** JSON Lines / NDJSON adapter. Streams line by line; one record per line. */
export function jsonlFormat(options: JsonlOptions = {}): FormatAdapter {
  const chunkSize = options.chunkSize ?? 1000
  return {
    id: 'jsonl',
    label: 'JSON Lines',
    capabilities: { streaming: true, cancellation: true, sourceLocations: true },
    extensions: ['jsonl', 'ndjson'],
    mimeTypes: ['application/jsonl', 'application/x-ndjson', 'application/x-jsonlines'],
    inspect: async (file) => {
      const complete = file.size <= JSONL_SAMPLE
      const sample = await file.blob.slice(0, JSONL_SAMPLE).text()
      const all = sample.split('\n')
      // The last line of a partial sample may be cut off.
      const full = complete ? all : all.slice(0, -1)
      let count = 0
      full.forEach((line, i) => {
        if (parseLine(line, i + 1)) count++
      })
      const sampleBytes = Math.min(file.size, JSONL_SAMPLE)
      const rowCount = complete ? count : Math.round((count / Math.max(sampleBytes, 1)) * file.size)
      if (!rowCount) return { datasets: [] }
      return {
        datasets: [{ id: 'jsonl', label: file.name, layout: 'records', rowCount, ...(complete ? {} : { meta: { estimated: true } }) }],
      }
    },
    read: async function* (file, { signal }) {
      let chunk: Record<string, RawValue>[] = []
      for await (const { line, number } of lines(file.blob, signal)) {
        const record = parseLine(line, number)
        if (!record) continue
        chunk.push(record)
        if (chunk.length >= chunkSize) {
          yield chunk
          chunk = []
        }
      }
      if (signal.aborted) throw aborted(signal)
      if (chunk.length) yield chunk
    },
  }
}

/** OpenImport plugin for `.json` documents. */
export function json(options: JsonOptions = {}): ImportPlugin {
  return { name: 'json', formats: [jsonFormat(options)] }
}

/** OpenImport plugin for `.jsonl` / `.ndjson` files. */
export function jsonl(options: JsonlOptions = {}): ImportPlugin {
  return { name: 'jsonl', formats: [jsonlFormat(options)] }
}

/** Both JSON and JSON Lines in one plugin. */
export function jsonFormats(options: JsonOptions & JsonlOptions = {}): ImportPlugin {
  return { name: 'json-formats', formats: [jsonFormat(options), jsonlFormat(options)] }
}

export default jsonFormats
