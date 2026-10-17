import { coerceValue } from './coerce'
import { duplicateIssue, uniqueKey } from './execution'
import type { TransformRegistry } from './transforms'
import { applyFieldMapping } from './transforms'
import type { FieldDefinition, ImportSchema, Issue, Mapping, ReviewRow, ReviewStats, RowValidator, SourceRow } from './types'
import { isEmpty, nest } from './utils'

export interface RowProcessor {
  /** Map, coerce and validate one source row. `edits` are user-entered values per target key. */
  process: (row: SourceRow, edits?: Record<string, unknown>) => ReviewRow
  /** Run Standard Schema validation; may be async depending on the library. */
  validateStandard: (row: ReviewRow) => Issue[] | Promise<Issue[]>
  /** `process` + Standard Schema, merged. Async only when the schema library is. */
  check: (row: SourceRow, edits?: Record<string, unknown>) => ReviewRow | Promise<ReviewRow>
}

export function createRowProcessor(
  schema: ImportSchema<unknown>,
  mapping: Mapping,
  registry: TransformRegistry,
  sourceLabels: Record<string, string> = {},
): RowProcessor {
  const rowValidators = toArray(schema.validateRow)
  const fieldByKey = new Map(schema.fields.map((f) => [f.key, f]))

  const process = (row: SourceRow, edits?: Record<string, unknown>): ReviewRow => {
    const values: Record<string, unknown> = {}
    const input: Record<string, unknown> = {}
    const issues: Issue[] = []

    for (const field of schema.fields) {
      const m = mapping[field.key]
      let raw: unknown
      if (edits && field.key in edits) raw = edits[field.key]
      else if (m?.sources.length) {
        try {
          raw = applyFieldMapping(
            m,
            row.values,
            field,
            registry,
            m.sources.map((k) => sourceLabels[k] ?? k),
          )
        } catch (error) {
          issues.push({ field: field.key, code: 'transform_failed', message: (error as Error).message, severity: 'error' })
          raw = undefined
        }
      } else if (m && m.fallback !== undefined) raw = m.fallback
      input[field.key] = raw

      const result = coerceValue(raw, field, m?.options, m?.valueMap)
      if (!result.ok) {
        issues.push(result.issue)
        values[field.key] = undefined
        continue
      }
      values[field.key] = result.value
      issues.push(...checkConstraints(result.value, field))
    }

    // Custom field validators run once all values are known so they can look at the whole row.
    for (const field of schema.fields) {
      if (!field.validate || issues.some((i) => i.field === field.key && i.severity !== 'warning')) continue
      for (const validate of toArray(field.validate)) {
        const r = validate(values[field.key], { row: values, rowIndex: row.sourceIndex, field })
        if (r)
          issues.push(
            typeof r === 'string'
              ? { field: field.key, code: 'custom', message: r, severity: 'error' }
              : { severity: 'error', ...r, field: field.key },
          )
      }
    }
    for (const validate of rowValidators) issues.push(...normalizeIssues(validate(values, { rowIndex: row.sourceIndex })))

    const edited = edits ? Object.keys(edits) : undefined
    return { id: row.id, sourceIndex: row.sourceIndex, values, input, issues, ...(edited?.length ? { edited } : {}) }
  }

  const validateStandard = (row: ReviewRow): Issue[] | Promise<Issue[]> => {
    if (!schema.standard) return []
    const toIssues = (result: Awaited<ReturnType<NonNullable<typeof schema.standard>['~standard']['validate']>>): Issue[] => {
      if (!result.issues) return []
      return result.issues.map((issue) => {
        const path = (issue.path ?? []).map((p) => String(typeof p === 'object' ? p.key : p))
        // Find the longest path prefix that is a field (arrays: `tags.0` → `tags`).
        let key: string | undefined
        for (let i = path.length; i > 0; i--) {
          const candidate = path.slice(0, i).join('.')
          if (fieldByKey.has(candidate)) {
            key = candidate
            break
          }
        }
        return { ...(key ? { field: key } : {}), code: 'schema', message: issue.message, severity: 'error' as const }
      })
    }
    const result = schema.standard['~standard'].validate(nest(row.values))
    return result instanceof Promise ? result.then(toIssues) : toIssues(result)
  }

  const check = (source: SourceRow, edits?: Record<string, unknown>): ReviewRow | Promise<ReviewRow> => {
    const row = process(source, edits)
    const std = validateStandard(row)
    if (std instanceof Promise) {
      return std.then((issues) => {
        row.issues.push(...dedupeStandard(row, issues))
        return row
      })
    }
    row.issues.push(...dedupeStandard(row, std))
    return row
  }

  return { process, validateStandard, check }
}

/** Don't repeat what coercion / built-in checks already reported for a field. */
export function dedupeStandard(row: ReviewRow, issues: Issue[]): Issue[] {
  const flagged = new Set(row.issues.filter((i) => (i.severity ?? 'error') === 'error' && i.field).map((i) => i.field))
  return issues.filter((i) => !i.field || !flagged.has(i.field))
}

function checkConstraints(value: unknown, field: FieldDefinition): Issue[] {
  const issues: Issue[] = []
  const issue = (code: string, message: string) => issues.push({ field: field.key, code, message, severity: 'error' })
  if (isEmpty(value)) {
    if (field.required) issue('required', `${field.label} is required`)
    return issues
  }
  const items = Array.isArray(value) ? value : [value]
  for (const v of items) {
    if (typeof v === 'number') {
      if (typeof field.min === 'number' && v < field.min) issue('too_small', `Must be at least ${field.min}`)
      if (typeof field.max === 'number' && v > field.max) issue('too_large', `Must be at most ${field.max}`)
    } else if (typeof v === 'string') {
      if (field.type === 'date' || field.type === 'datetime') {
        if (typeof field.min === 'string' && v < field.min) issue('too_early', `Must be on or after ${field.min}`)
        if (typeof field.max === 'string' && v > field.max) issue('too_late', `Must be on or before ${field.max}`)
      } else {
        if (typeof field.min === 'number' && v.length < field.min) issue('too_short', `Must be at least ${field.min} characters`)
        if (typeof field.max === 'number' && v.length > field.max) issue('too_long', `Must be at most ${field.max} characters`)
      }
      if (field.pattern && !new RegExp(field.pattern).test(v)) issue('pattern', 'Does not match the expected format')
    }
  }
  return issues
}

function toArray<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value]
}

function normalizeIssues(result: ReturnType<RowValidator>): Issue[] {
  if (!result) return []
  return (Array.isArray(result) ? result : [result]).map((i) => ({ severity: 'error' as const, ...i }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Uniqueness (cross-row)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Flags rows sharing a value in a \`unique\` field. Same rule as the headless
 * \`run()\`: the first occurrence is kept (a warning points at the others),
 * every later occurrence is an error. Returns a new array in which only rows
 * whose duplicate issues changed are new objects, so UI rows can be memoised.
 */
export function applyUniqueness(rows: ReviewRow[], schema: ImportSchema<unknown>): ReviewRow[] {
  const fields = schema.fields.filter((f) => f.unique)
  if (!fields.length) return rows
  const next = new Map<number, Issue[]>()
  const add = (i: number, issue: Issue) => next.set(i, [...(next.get(i) ?? []), issue])
  for (const field of fields) {
    const seen = new Map<string, number[]>()
    rows.forEach((row, i) => {
      const v = row.values[field.key]
      if (isEmpty(v)) return
      const k = uniqueKey(v)
      const list = seen.get(k)
      if (list) list.push(i)
      else seen.set(k, [i])
    })
    for (const list of seen.values()) {
      if (list.length < 2) continue
      const [first, ...rest] = list as [number, ...number[]]
      const firstRow = (rows[first] as ReviewRow).sourceIndex
      const others = rest.slice(0, 3).map((j) => (rows[j] as ReviewRow).sourceIndex)
      const more = rest.length > 3 ? ` and ${rest.length - 3} more` : ''
      add(first, { field: field.key, code: 'duplicate', message: `Also used in row ${others.join(', ')}${more}`, severity: 'warning' })
      for (const j of rest) add(j, duplicateIssue(field.key, firstRow))
    }
  }
  const isDup = (i: Issue) => i.code === 'duplicate'
  let changed = false
  const out = rows.map((row, i) => {
    const before = row.issues.filter(isDup)
    const after = next.get(i) ?? []
    if (before.length === after.length && before.every((b, j) => b.message === after[j]?.message && b.field === after[j]?.field)) return row
    changed = true
    return { ...row, issues: [...row.issues.filter((x) => !isDup(x)), ...after] }
  })
  return changed ? out : rows
}

export function computeStats(rows: ReviewRow[]): ReviewStats {
  const stats: ReviewStats = { total: rows.length, valid: 0, withErrors: 0, withWarnings: 0, errorCount: 0, warningCount: 0, byField: {} }
  for (const row of rows) {
    let errors = 0
    let warnings = 0
    for (const issue of row.issues) {
      const sev = issue.severity ?? 'error'
      if (sev === 'info') continue
      if (sev === 'error') errors++
      else warnings++
      if (issue.field) {
        const f = (stats.byField[issue.field] ??= { errors: 0, warnings: 0 })
        if (sev === 'error') f.errors++
        else f.warnings++
      }
    }
    stats.errorCount += errors
    stats.warningCount += warnings
    if (errors) stats.withErrors++
    else stats.valid++
    if (warnings) stats.withWarnings++
  }
  return stats
}

export const hasErrors = (row: ReviewRow) => row.issues.some((i) => (i.severity ?? 'error') === 'error')

/** Build the nested output record for a reviewed row. */
export function toRecord(row: ReviewRow): Record<string, unknown> {
  return nest(row.values)
}
