/**
 * Execution semantics shared by the interactive session and the headless
 * `run()`. Anything that decides *whether a record is valid or allowed* lives
 * here, so both entry points enforce exactly the same rules.
 */
import { enrichMapping } from './automap'
import { CUSTOM_KEY, type ImportRecord, splitCustomValues } from './custom-fields'
import { importError } from './errors'
import type { Importer, ImporterConfig } from './importer'
import type { FieldMapping, ImportSchema, Issue, Mapping, MatchSuggestion, SourceField, SourceFile, SourceRow } from './types'
import { isEmpty, nest, stringify, throwIfAborted } from './utils'

// ─────────────────────────────────────────────────────────────────────────────
// Limits
// ─────────────────────────────────────────────────────────────────────────────

export function assertFileSize(config: Pick<ImporterConfig<unknown>, 'maxFileSize'>, file: SourceFile): void {
  const max = config.maxFileSize
  if (max && file.size > max) throw importError('file_too_large', `File is larger than ${formatBytes(max)}`)
}

export function tooManyRows(max: number) {
  return importError('too_many_rows', `This file has more than ${max.toLocaleString()} rows`)
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 ** 2).toFixed(0)} MB`
}

// ─────────────────────────────────────────────────────────────────────────────
// Suggestions → mapping (one implementation for load, Auto-map and run())
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply confident suggestions to unmapped fields, keeping their transforms,
 * then infer parsing options and value maps from the data.
 */
export function applySuggestions(
  importer: Importer<any>,
  mapping: Mapping,
  suggestions: MatchSuggestion[],
  rows: SourceRow[],
  sourceFields: SourceField[],
): Mapping {
  const threshold = importer.config.autoMapThreshold ?? 0.7
  const next: Mapping = { ...mapping }
  for (const s of suggestions) {
    if (s.confidence < threshold || next[s.target]) continue
    const field = importer.schema.fields.find((f) => f.key === s.target)
    if (!field) continue
    const m: FieldMapping = {
      sources: s.sources,
      ...(s.transforms?.length ? { transforms: s.transforms } : {}),
      origin: 'suggestion',
      confidence: s.confidence,
    }
    next[s.target] = enrichMapping(importer, field, m, rows, sourceFields)
  }
  // Recipe mappings get the same inference (it's a no-op when options exist).
  for (const field of importer.schema.fields) {
    const m = next[field.key]
    if (m && m.origin === 'recipe') next[field.key] = enrichMapping(importer, field, m, rows, sourceFields)
  }
  return next
}

/**
 * For record datasets (JSON, XML), properties can first appear after the rows
 * used for discovery. Explicitly mapped properties must still be read, so add
 * a source field for every referenced label that wasn't discovered.
 */
export function withExplicitSources(sourceFields: SourceField[], labels: Iterable<string>): SourceField[] {
  const known = new Set(sourceFields.map((f) => f.label.toLowerCase()))
  const extra: SourceField[] = []
  for (const label of labels) {
    if (known.has(label.toLowerCase())) continue
    known.add(label.toLowerCase())
    extra.push({ key: label, label, index: sourceFields.length + extra.length, samples: [], inferredType: 'empty', emptyRatio: 1 })
  }
  return extra.length ? [...sourceFields, ...extra] : sourceFields
}

// ─────────────────────────────────────────────────────────────────────────────
// Async batch validation
// ─────────────────────────────────────────────────────────────────────────────

/** Run the schema's `validateBatch` over rows in batches. Issues are marked `async`. */
export async function runBatchValidators(
  schema: ImportSchema<unknown>,
  rows: { id: string; values: Record<string, unknown> }[],
  signal: AbortSignal,
  batchSize: number,
): Promise<Map<string, Issue[]>> {
  const found = new Map<string, Issue[]>()
  const validateBatch = schema.validateBatch
  if (!validateBatch || !rows.length) return found
  for (let i = 0; i < rows.length; i += batchSize) {
    const issues = await validateBatch(rows.slice(i, i + batchSize), { signal })
    throwIfAborted(signal)
    for (const { rowId, ...issue } of issues) {
      const list = found.get(rowId) ?? []
      list.push({ severity: 'error', ...issue, code: issue.code ?? 'batch', async: true })
      found.set(rowId, list)
    }
  }
  return found
}

// ─────────────────────────────────────────────────────────────────────────────
// Uniqueness
// ─────────────────────────────────────────────────────────────────────────────

export const uniqueKey = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : stringify(v))

/**
 * Streaming uniqueness: the first occurrence of a value is kept, later ones
 * are errors. The session uses the same rule (and additionally warns on the
 * first occurrence, since it can show all rows at once).
 */
export class UniqueIndex {
  #seen = new Map<string, Map<string, number>>()
  constructor(private readonly fields: string[]) {}

  /** Returns duplicate issues for this row and records its values. */
  check(values: Record<string, unknown>, sourceIndex: number): Issue[] {
    const issues: Issue[] = []
    for (const key of this.fields) {
      const v = values[key]
      if (isEmpty(v)) continue
      let map = this.#seen.get(key)
      if (!map) this.#seen.set(key, (map = new Map()))
      const k = uniqueKey(v)
      const first = map.get(k)
      if (first !== undefined) issues.push(duplicateIssue(key, first))
      else map.set(k, sourceIndex)
    }
    return issues
  }
}

export const duplicateIssue = (field: string, firstRow: number): Issue => ({
  field,
  code: 'duplicate',
  message: `Duplicate of row ${firstRow}`,
  severity: 'error',
})

// ─────────────────────────────────────────────────────────────────────────────
// Output
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Nested output record; with a Standard Schema, its parsed value (defaults, transforms).
 * Custom field values go to `$custom`, so the schema (and a strict Standard Schema) never sees them.
 */
export async function toOutputRecord<T>(schema: ImportSchema<unknown>, values: Record<string, unknown>): Promise<ImportRecord<T>> {
  const split = splitCustomValues(schema, values)
  const nested = nest(split.values)
  const standard = schema.standard
  let record = nested as T
  if (standard) {
    const result = await standard['~standard'].validate(nested)
    record = (result.issues ? nested : result.value) as T
  }
  return split.custom ? ({ ...record, [CUSTOM_KEY]: split.custom } as ImportRecord<T>) : (record as ImportRecord<T>)
}

/** FNV-1a: a short, stable id for a batch of row ids (idempotency keys). */
export function hashIds(ids: string[]): string {
  let h = 0x811c9dc5
  for (const id of ids) {
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    h ^= 0x2c
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}
