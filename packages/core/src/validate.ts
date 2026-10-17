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

/** One row's share of the stats, added (`sign` 1) or removed (`sign` -1). */
function countRow(stats: ReviewStats, row: ReviewRow, sign: 1 | -1): void {
  let errors = 0
  let warnings = 0
  for (const issue of row.issues) {
    const sev = issue.severity ?? 'error'
    if (sev === 'info') continue
    if (sev === 'error') errors++
    else warnings++
    if (issue.field) {
      const prev = stats.byField[issue.field] ?? { errors: 0, warnings: 0 }
      const f = { errors: prev.errors + (sev === 'error' ? sign : 0), warnings: prev.warnings + (sev === 'error' ? 0 : sign) }
      if (f.errors || f.warnings) stats.byField[issue.field] = f
      else delete stats.byField[issue.field]
    }
  }
  stats.errorCount += sign * errors
  stats.warningCount += sign * warnings
  if (errors) stats.withErrors += sign
  else stats.valid += sign
  if (warnings) stats.withWarnings += sign
}

const isDuplicate = (i: Issue) => i.code === 'duplicate'

/**
 * Uniqueness, row positions and stats for one rows array, kept up to date as
 * rows change. Changing a row costs work for that row and the rows sharing its
 * old or new unique values, not for the whole file. The result is identical to
 * `applyUniqueness` + `computeStats` over all rows (the tests check that).
 */
export class LiveRows {
  #rows: ReviewRow[]
  #stats: ReviewStats
  #position = new Map<string, number>()
  #fields: string[]
  /** Per unique field: value key → the position holding it, or all positions (ascending) once it repeats. */
  #groups = new Map<string, Map<string, Group>>()
  /** Per unique field: the value key at each position. */
  #keys = new Map<string, (string | undefined)[]>()

  /** Index `rows` and give them their duplicate issues (like `applyUniqueness`). */
  constructor(input: ReviewRow[], schema: ImportSchema<unknown>) {
    const rows = input.slice()
    this.#fields = schema.fields.filter((f) => f.unique).map((f) => f.key)
    for (const [i, row] of rows.entries()) this.#position.set(row.id, i)
    for (const field of this.#fields) {
      const groups = new Map<string, Group>()
      const keys = rows.map((row, i) => {
        const k = keyOf(row.values[field])
        if (k !== undefined) {
          const g = groups.get(k)
          if (g === undefined) groups.set(k, i)
          else if (typeof g === 'number') groups.set(k, [g, i])
          else g.push(i)
        }
        return k
      })
      this.#groups.set(field, groups)
      this.#keys.set(field, keys)
    }
    let changed = false
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as ReviewRow
      if (!this.#inGroup(i) && !row.issues.some(isDuplicate)) continue
      const next = this.#withDuplicates(rows, i)
      if (next !== row) {
        rows[i] = next
        changed = true
      }
    }
    this.#rows = changed ? rows : input
    this.#stats = computeStats(this.#rows)
  }

  get rows(): ReviewRow[] {
    return this.#rows
  }

  get stats(): ReviewStats {
    return this.#stats
  }

  #inGroup(i: number): boolean {
    for (const field of this.#fields) {
      const k = (this.#keys.get(field) as (string | undefined)[])[i]
      if (k !== undefined && Array.isArray(this.#groups.get(field)?.get(k))) return true
    }
    return false
  }

  /** Whether this index describes `rows` (any other change to the rows needs a new index). */
  describes(rows: ReviewRow[]): boolean {
    return rows === this.#rows
  }

  indexOf(rowId: string): number | undefined {
    return this.#position.get(rowId)
  }

  /** Replace rows by position. Duplicate issues of affected rows are recomputed. */
  update(changes: Map<number, ReviewRow>): { rows: ReviewRow[]; stats: ReviewStats } {
    const previous = this.#rows
    const rows = previous.slice()
    const affected = new Set<number>()
    for (const [i, row] of changes) {
      rows[i] = row
      affected.add(i)
      for (const field of this.#fields) {
        const keys = this.#keys.get(field) as (string | undefined)[]
        const groups = this.#groups.get(field) as Map<string, Group>
        const before = keys[i]
        const after = keyOf(row.values[field])
        if (before === after) continue
        keys[i] = after
        if (before !== undefined) {
          const g = groups.get(before) as Group
          if (typeof g === 'number') groups.delete(before)
          else {
            const at = lowerBound(g, i)
            g.splice(at, 1)
            if (g.length === 1) {
              affected.add(g[0] as number)
              groups.set(before, g[0] as number)
            } else touch(g, at, affected)
          }
        }
        if (after !== undefined) {
          const g = groups.get(after)
          if (g === undefined) groups.set(after, i)
          else if (typeof g === 'number') {
            affected.add(g)
            groups.set(after, g < i ? [g, i] : [i, g])
          } else {
            const at = lowerBound(g, i)
            g.splice(at, 0, i)
            touch(g, at, affected)
          }
        }
      }
    }
    const stats: ReviewStats = { ...this.#stats, byField: { ...this.#stats.byField } }
    for (const i of affected) {
      const row = this.#withDuplicates(rows, i)
      rows[i] = row
      countRow(stats, previous[i] as ReviewRow, -1)
      countRow(stats, row, 1)
    }
    this.#rows = rows
    this.#stats = stats
    return { rows, stats }
  }

  /** The row at `i` with its duplicate issues, built exactly like `applyUniqueness`. */
  #withDuplicates(rows: ReviewRow[], i: number): ReviewRow {
    const row = rows[i] as ReviewRow
    const after: Issue[] = []
    for (const field of this.#fields) {
      const k = (this.#keys.get(field) as (string | undefined)[])[i]
      const list = k === undefined ? undefined : this.#groups.get(field)?.get(k)
      if (!Array.isArray(list)) continue
      const [first, ...rest] = list as [number, ...number[]]
      if (first === i) {
        const others = rest.slice(0, 3).map((j) => (rows[j] as ReviewRow).sourceIndex)
        const more = rest.length > 3 ? ` and ${rest.length - 3} more` : ''
        after.push({ field, code: 'duplicate', message: `Also used in row ${others.join(', ')}${more}`, severity: 'warning' })
      } else after.push(duplicateIssue(field, (rows[first] as ReviewRow).sourceIndex))
    }
    const before = row.issues.filter(isDuplicate)
    if (before.length === after.length && before.every((b, j) => b.message === after[j]?.message && b.field === after[j]?.field)) return row
    return { ...row, issues: [...row.issues.filter((x) => !isDuplicate(x)), ...after] }
  }
}

/**
 * Rows whose duplicate messages change when a group changed at `at`: every row
 * says "Duplicate of row <first>", so all of them if the first changed, else
 * only the first ("Also used in row …").
 */
function touch(group: number[], at: number, affected: Set<number>): void {
  if (at === 0) for (const j of group) affected.add(j)
  else affected.add(group[0] as number)
}

/** One position, or several (ascending) when the value repeats. */
type Group = number | number[]

const keyOf = (v: unknown) => (isEmpty(v) ? undefined : uniqueKey(v))

/** First index in an ascending list whose value is ≥ `n`. */
function lowerBound(list: number[], n: number): number {
  let lo = 0
  let hi = list.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((list[mid] as number) < n) lo = mid + 1
    else hi = mid
  }
  return lo
}

export const hasErrors = (row: ReviewRow) => row.issues.some((i) => (i.severity ?? 'error') === 'error')

/** Build the nested output record for a reviewed row. */
export function toRecord(row: ReviewRow): Record<string, unknown> {
  return nest(row.values)
}
