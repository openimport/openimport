import type { InferredType, RawValue, SourceField, SourceFile } from './types'
import { extensionOf, isEmpty, isSafeKey, stringify } from './utils'

/** Wrap a `File`/`Blob` (browser) or any blob-like into a `SourceFile`. */
export function toSourceFile(input: Blob | File | SourceFile, name?: string): SourceFile {
  if (isSourceFile(input)) return input
  const fileName = name ?? (input as File).name ?? 'upload'
  return {
    name: fileName,
    size: input.size,
    type: input.type,
    extension: extensionOf(fileName),
    blob: input,
  }
}

/** Create a `SourceFile` from a string — handy for tests, pasted data and server-side usage. */
export function sourceFromString(content: string, name: string, type = ''): SourceFile {
  return toSourceFile(new Blob([content], { type }), name)
}

function isSourceFile(value: unknown): value is SourceFile {
  return typeof value === 'object' && value !== null && 'blob' in value && 'extension' in value
}

// ─────────────────────────────────────────────────────────────────────────────
// Header detection
// ─────────────────────────────────────────────────────────────────────────────

const NUMERIC = /^[-+]?[\d\s.,']+%?$/
const DATE_LIKE = /^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}/

function looksLikeHeaderCell(value: RawValue): boolean {
  if (typeof value !== 'string') return false
  const s = value.trim()
  if (!s || s.length > 80) return false
  return !NUMERIC.test(s) && !DATE_LIKE.test(s) && !s.includes('@')
}

/**
 * Finds the most plausible header row in the first rows of a grid. Handles
 * exports with title lines, blank lines or notes above the actual table.
 */
export function detectHeaderRow(rows: RawValue[][], maxScan = 25): number {
  const scan = rows.slice(0, maxScan)
  if (scan.length === 0) return 0
  const width = (r: RawValue[]) => r.filter((v) => !isEmpty(v)).length
  const widths = scan.map(width)
  // The "table width" is the most common non-trivial row width.
  const counts = new Map<number, number>()
  for (const w of widths) if (w > 1) counts.set(w, (counts.get(w) ?? 0) + 1)
  const tableWidth = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? Math.max(...widths)

  let best = 0
  let bestScore = -1
  for (let i = 0; i < scan.length; i++) {
    const row = scan[i] as RawValue[]
    const filled = row.filter((v) => !isEmpty(v))
    if (filled.length < Math.min(2, tableWidth)) continue
    const coverage = Math.min(filled.length / tableWidth, 1)
    const textRatio = filled.filter(looksLikeHeaderCell).length / filled.length
    const unique = new Set(filled.map((v) => stringify(v).toLowerCase())).size / filled.length
    // A header is usually followed by rows that are *less* header-like.
    const next = scan[i + 1]
    const nextText = next ? next.filter(looksLikeHeaderCell).length / Math.max(width(next), 1) : 0
    // …and a header without any row below it is unlikely.
    const contrast = next ? 1 - nextText * 0.5 : 0.4
    const score = coverage * coverage * textRatio * unique * contrast
    if (score > bestScore + 0.05) {
      best = i
      bestScore = score
    }
  }
  return best
}

// ─────────────────────────────────────────────────────────────────────────────
// Building source fields
// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE_SIZE = 5

export function columnLetter(index: number): string {
  let s = ''
  let n = index + 1
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** Build source fields from a grid preview and the chosen header row. */
export function fieldsFromGrid(preview: RawValue[][], headerRow: number): SourceField[] {
  const header = preview[headerRow] ?? []
  const body = preview.slice(headerRow + 1)
  const width = Math.max(header.length, ...body.map((r) => r.length), 0)
  const used = new Map<string, number>()
  const fields: SourceField[] = []
  for (let c = 0; c < width; c++) {
    let label = stringify(header[c]).trim() || `Column ${columnLetter(c)}`
    const n = (used.get(label.toLowerCase()) ?? 0) + 1
    used.set(label.toLowerCase(), n)
    if (n > 1) label = `${label} (${n})`
    const values = body.map((r) => r[c])
    // Skip trailing columns that are entirely empty and have no header.
    if (!stringify(header[c]).trim() && values.every(isEmpty)) continue
    fields.push(describeField(`c${c}`, label, c, values))
  }
  return fields
}

/** Convert a grid row (array of cells) into a values object keyed by source field key. */
export function gridRowToValues(row: RawValue[], fields: SourceField[]): Record<string, RawValue> {
  const values: Record<string, RawValue> = {}
  for (const f of fields) values[f.key] = row[f.index] ?? null
  return values
}

/**
 * Flattens nested objects to dot paths. Arrays of primitives stay arrays, arrays
 * of objects are kept as-is (they usually represent a separate dataset).
 */
export function flattenRecord(
  record: Record<string, RawValue>,
  maxDepth = 6,
  prefix = '',
  out: Record<string, RawValue> = {},
): Record<string, RawValue> {
  for (const [key, value] of Object.entries(record)) {
    // Never turn data into prototype access (e.g. a JSON property named "__proto__").
    if (!isSafeKey(key)) continue
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && maxDepth > 0) {
      flattenRecord(value as Record<string, RawValue>, maxDepth - 1, path, out)
    } else {
      out[path] = value
    }
  }
  return out
}

/**
 * Build source fields from (already flattened) records. Every property in
 * every record is discovered, so fields that only appear late in a file are
 * still offered; sample values come from the first `sample` records that have them.
 */
export function fieldsFromRecords(records: Record<string, RawValue>[], sample = 200): SourceField[] {
  const order: string[] = []
  const seen = new Set<string>()
  for (const r of records) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        seen.add(k)
        order.push(k)
      }
    }
  }
  const head = records.slice(0, sample)
  return order.map((key, i) => {
    let values = head.map((r) => r[key])
    if (values.every((v) => v === undefined)) {
      values = []
      for (const r of records) {
        if (r[key] !== undefined) values.push(r[key])
        if (values.length >= sample) break
      }
    }
    return describeField(key, key, i, values)
  })
}

function describeField(key: string, label: string, index: number, values: RawValue[]): SourceField {
  const nonEmpty = values.filter((v) => !isEmpty(v))
  const samples: RawValue[] = []
  const distinct = new Set<string>()
  for (const v of nonEmpty) {
    const s = stringify(v)
    if (distinct.has(s)) continue
    distinct.add(s)
    samples.push(v)
    if (samples.length >= SAMPLE_SIZE) break
  }
  return {
    key,
    label,
    index,
    samples,
    inferredType: inferType(nonEmpty),
    emptyRatio: values.length ? 1 - nonEmpty.length / values.length : 1,
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const URL_LIKE = /^(https?:\/\/|www\.)\S+$/i
const INTEGER = /^[-+]?\d{1,3}([.,' ]?\d{3})*$|^[-+]?\d+$/
const DECIMAL = /^[-+]?(\d+|\d{1,3}([.,' ]\d{3})+)([.,]\d+)?$/
const BOOL = /^(true|false|yes|no|ja|nein|y|n|wahr|falsch)$/i
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/
const LOCAL_DATE = /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}( \d{1,2}:\d{2}(:\d{2})?)?$/

/** Infer a coarse type from sample values (used for matching and UI hints). */
export function inferType(values: RawValue[]): InferredType {
  if (values.length === 0) return 'empty'
  const types = new Set<InferredType>()
  for (const v of values.slice(0, 50)) types.add(inferOne(v))
  if (types.size === 1) return [...types][0] as InferredType
  if (types.size === 2 && types.has('integer') && types.has('number')) return 'number'
  return 'mixed'
}

function inferOne(v: RawValue): InferredType {
  if (typeof v === 'boolean') return 'boolean'
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number'
  if (v instanceof Date) return 'date'
  const s = stringify(v).trim()
  if (EMAIL.test(s)) return 'email'
  if (URL_LIKE.test(s)) return 'url'
  if (ISO_DATE.test(s) || LOCAL_DATE.test(s)) return 'date'
  if (INTEGER.test(s)) return 'integer'
  if (DECIMAL.test(s)) return 'number'
  if (BOOL.test(s)) return 'boolean'
  return 'string'
}
