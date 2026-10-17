import type { DistinctValue } from './automap'
import type { Importer, SubmitHandler } from './importer'
import type { FieldPreview } from './session'
import type { FieldMapping, MaybePromise, Recipe, ReviewRow, RowQuery, SessionState, SourceFile, SubmitResult } from './types'

/**
 * What a UI needs from an import session. `ImportSession` implements it
 * in-process; `@openimport/worker` implements it over `postMessage`, where
 * every query returns a promise and `state.rows` stays in the worker.
 */
export interface SessionLike<T = Record<string, unknown>> {
  /** The importer as configured on this thread: schema, formats and transforms for display. */
  readonly importer: Importer<T>
  readonly schema: Importer<T>['schema']
  readonly id: string

  getState(): SessionState
  subscribe(listener: (state: SessionState, previous: SessionState) => void): () => void

  loadFile(input: Blob | File | SourceFile, name?: string): Promise<void>
  selectDataset(id: string): Promise<void>
  setHeaderRow(index: number): MaybePromise<void>
  confirmHeader(): Promise<void>

  setMapping(target: string, mapping: FieldMapping | null): MaybePromise<void>
  assign(target: string, source: string | null): MaybePromise<void>
  clearMapping(): MaybePromise<void>
  autoMap(): Promise<void>
  previewField(target: string, mapping?: FieldMapping, limit?: number): MaybePromise<FieldPreview[]>
  distinctValues(target: string, mapping?: FieldMapping, limit?: number): MaybePromise<(DistinctValue & { matched?: string })[]>
  confirmMapping(options?: { saveRecipe?: boolean | string }): Promise<void>
  exportRecipe(name?: string): MaybePromise<Recipe>

  /** Number of review rows matching a query. */
  countRows(query?: RowQuery): MaybePromise<number>
  /** A page of review rows matching a query (`start` inclusive, `end` exclusive). */
  getRows(query: RowQuery, start: number, end: number): MaybePromise<ReviewRow[]>
  /** Ids of all rows matching a query (for "select all"). */
  rowIds(query?: RowQuery): MaybePromise<string[]>
  /** The next error cell after `from` within the query, scanning `fields` in order. */
  findIssue(query: RowQuery, from: { row: number; col: number } | null, fields: string[]): MaybePromise<{ row: number; col: number } | null>

  editCell(rowId: string, field: string, value: unknown): MaybePromise<void>
  replaceValues(
    field: string,
    find: string,
    replace: string,
    options?: { rowIds?: string[]; match?: 'cell' | 'substring' },
  ): MaybePromise<number>
  deleteRows(ids: string[]): MaybePromise<void>
  deleteInvalidRows(): MaybePromise<number>

  submit(handler?: SubmitHandler<T>): Promise<SubmitResult | undefined>
  reviewRejected(): MaybePromise<void>

  back(): MaybePromise<void>
  reset(): MaybePromise<void>
  abort(): MaybePromise<void>
  clearError(): MaybePromise<void>
  /** Release resources (e.g. terminate a worker). */
  dispose?(): void
}

/** Whether a session in this state may submit. Shared by local and remote sessions. */
export function isSubmittable(state: SessionState, invalidRows: 'block' | 'skip' = 'block'): boolean {
  const { stats, busy } = state
  if (busy || stats.total === 0) return false
  return invalidRows === 'skip' ? stats.valid > 0 : stats.withErrors === 0
}

/** Does a review row match a query? */
export function matchesQuery(row: ReviewRow, query: RowQuery): boolean {
  const errors = row.issues.some((i) => (i.severity ?? 'error') === 'error')
  if (query.filter === 'errors' && !errors) return false
  if (query.filter === 'valid' && errors) return false
  if (query.field && !row.issues.some((i) => i.field === query.field)) return false
  const q = query.search?.trim().toLowerCase()
  if (q) {
    let hit = false
    for (const k of Object.keys(row.values)) {
      const v = row.values[k] ?? row.input[k]
      if (v !== undefined && v !== null && String(v).toLowerCase().includes(q)) {
        hit = true
        break
      }
    }
    if (!hit) return false
  }
  return true
}

const isEmptyQuery = (q: RowQuery) => (!q.filter || q.filter === 'all') && !q.field && !q.search?.trim()

/** Indices of rows matching a query, cached per (rows, query) so paging stays cheap. */
export class RowIndex {
  #rows: ReviewRow[] | null = null
  #key = ''
  #indices: number[] = []

  resolve(rows: ReviewRow[], query: RowQuery = {}): number[] | null {
    if (isEmptyQuery(query)) return null // identity: every row, in order
    const key = JSON.stringify([query.filter ?? 'all', query.field ?? '', query.search?.trim().toLowerCase() ?? ''])
    if (rows !== this.#rows || key !== this.#key) {
      this.#rows = rows
      this.#key = key
      this.#indices = []
      rows.forEach((row, i) => {
        if (matchesQuery(row, query)) this.#indices.push(i)
      })
    }
    return this.#indices
  }
}
