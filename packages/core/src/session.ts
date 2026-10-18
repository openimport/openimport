import { collectSuggestions, type DistinctValue, distinctValues, enrichMapping } from './automap'
import { coerceValue } from './coerce'
import {
  type CustomField,
  type CustomFieldInput,
  customFieldKey,
  type ImportRecord,
  restoreCustomFields,
  suggestCustomField,
  validateCustomField,
  withCustomFields,
} from './custom-fields'
import { importError } from './errors'
import { applySuggestions, assertFileSize, hashIds, runBatchValidators, toOutputRecord, tooManyRows } from './execution'
import type { Importer, SubmitHandler } from './importer'
import { applyRecipe, createRecipe, findRecipe, parseRecipe } from './recipe'
import { isSubmittable, RowIndex, type SessionLike } from './session-like'
import { detectHeaderRow, fieldsFromGrid, fieldsFromRecords, flattenRecord, gridRowToValues, toSourceFile } from './source'
import { Store } from './store'
import { applyFieldMapping } from './transforms'
import type {
  DatasetInfo,
  FieldDefinition,
  FieldMapping,
  ImportError,
  ImportEvent,
  Issue,
  Mapping,
  RawValue,
  Recipe,
  ReviewRow,
  RowIssue,
  RowQuery,
  SessionState,
  SourceField,
  SourceFile,
  SourceRow,
  Step,
  SubmitResult,
} from './types'
import { createId, isAbortError, stringify, throwIfAborted, yieldToMain } from './utils'
import { computeStats, createRowProcessor, dedupeStandard, hasErrors, LiveRows, type RowProcessor } from './validate'

const PREVIEW_ROWS = 50
const VALIDATION_CHUNK = 2000

export const initialState = (): SessionState => ({
  step: 'upload',
  busy: false,
  error: null,
  file: null,
  format: null,
  datasets: [],
  dataset: null,
  preview: [],
  headerRow: 0,
  detectedHeaderRow: 0,
  sourceFields: [],
  rowCount: 0,
  mapping: {},
  customFields: [],
  suggestions: [],
  recipe: null,
  rows: [],
  stats: { total: 0, valid: 0, withErrors: 0, withWarnings: 0, errorCount: 0, warningCount: 0, byField: {} },
  progress: null,
  result: null,
  rowsVersion: 0,
  canGoBack: false,
})

export interface FieldPreview {
  rowId: string
  sourceIndex: number
  /** Source values feeding the field. */
  inputs: RawValue[]
  /** Value after transforms, before coercion. */
  transformed: unknown
  /** Final coerced value. */
  output: unknown
  issue?: Issue
}

/**
 * One interactive import. Framework-agnostic: subscribe to state changes and
 * call actions. The React bindings are a thin layer on top of this class.
 */
export class ImportSession<T = Record<string, unknown>> implements SessionLike<T> {
  readonly importer: Importer<T>
  readonly store: Store<SessionState>

  #controller = new AbortController()
  #grid: RawValue[][] = []
  #records: Record<string, RawValue>[] = []
  #sourceRows: SourceRow[] = []
  #edits = new Map<string, Record<string, unknown>>()
  #asyncIssues = new Map<string, Issue[]>()
  #processor: RowProcessor | null = null
  /** Async validations (Standard Schema, validateBatch) still running after edits. */
  #pending = 0
  /** Rows the submit handler accepted, and rows it rejected, across attempts. */
  #accepted = new Set<string>()
  #rejected: RowIssue[] = []
  #history: Step[] = []
  /** Incremental uniqueness and stats for the current rows, so an edit doesn't touch every row. */
  #live: LiveRows | null = null
  #sourceById: { for: SourceRow[]; map: Map<string, SourceRow> } | null = null

  constructor(importer: Importer<T>) {
    this.importer = importer
    this.store = new Store(initialState(), (next, previous) => ({
      // Remote sessions don't ship rows; the version tells them when to refetch.
      rowsVersion: next.rows !== previous.rows ? previous.rowsVersion + 1 : previous.rowsVersion,
      canGoBack: this.#history.length > 0 && next.step !== 'submitting' && next.step !== 'complete',
    }))
  }

  getState = (): SessionState => this.store.get()
  subscribe = (listener: (state: SessionState, previous: SessionState) => void): (() => void) => this.store.subscribe(listener)

  /** The importer's schema plus any custom fields the user added. */
  get schema() {
    return withCustomFields(this.importer.schema, this.getState().customFields)
  }

  // ───────────────────────────────────────────────────────────── navigation

  #goto(step: Step) {
    const current = this.getState().step
    if (current !== step && current !== 'submitting') this.#history.push(current)
    this.store.set({ step, busy: false })
  }

  /** Whether `back()` leads somewhere (also available as `state.canGoBack`). */
  canGoBack(): boolean {
    return this.getState().canGoBack
  }

  back(): void {
    const previous = this.#history.pop()
    if (!previous) return
    this.#abortRunning()
    this.store.set({ step: previous, busy: false, error: null, progress: null })
    if (previous === 'upload') this.reset()
  }

  /** Start over with a new file. */
  reset(): void {
    this.#abortRunning()
    this.#grid = []
    this.#records = []
    this.#sourceRows = []
    this.#edits.clear()
    this.#asyncIssues.clear()
    this.#processor = null
    this.#pending = 0
    this.#accepted = new Set()
    this.#rejected = []
    this.#history = []
    this.store.set(initialState())
  }

  /** Cancel whatever async work is in progress (parsing, validation, submission). */
  abort(): void {
    this.#abortRunning()
    this.store.set({ busy: false, progress: null })
  }

  #abortRunning(): AbortSignal {
    this.#controller.abort(new DOMException('Aborted', 'AbortError'))
    this.#controller = new AbortController()
    return this.#controller.signal
  }

  #emit(event: ImportEvent) {
    this.importer.emit(event)
  }

  #fail(error: unknown, code: ImportError['code'] = 'unknown') {
    if (isAbortError(error)) return
    const importError: ImportError =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      'message' in error &&
      typeof (error as ImportError).code === 'string'
        ? { code: (error as ImportError).code, message: (error as ImportError).message, cause: error }
        : { code, message: error instanceof Error ? error.message : String(error), cause: error }
    this.store.set({ error: importError, busy: false, progress: null })
    this.#emit({ type: 'error', error: importError })
  }

  clearError(): void {
    this.store.set({ error: null })
  }

  // ───────────────────────────────────────────────────────────── upload

  /** Load a file: detect its format, discover datasets and continue as far as possible automatically. */
  async loadFile(input: Blob | File | SourceFile, name?: string): Promise<void> {
    this.reset()
    const signal = this.#controller.signal
    const file = toSourceFile(input, name)
    try {
      assertFileSize(this.importer.config, file)
    } catch (error) {
      return this.#fail(error)
    }
    this.store.set({ file, busy: 'inspecting', error: null })
    try {
      const format = await this.importer.detectFormat(file)
      if (!format) {
        const supported = this.importer.formats.map((f) => f.label).join(', ')
        throw importError('unsupported_file', `This file type isn't supported${supported ? `. Supported: ${supported}` : ''}`)
      }
      const inspection = await format.inspect(file, { signal })
      throwIfAborted(signal)
      if (!inspection.datasets.length) throw importError('empty_file', 'No data found in this file')
      this.store.set({ format: { id: format.id, label: format.label }, datasets: inspection.datasets })
      this.#emit({ type: 'file:loaded', file, inspection, format: format.id })
      if (inspection.datasets.length === 1) await this.selectDataset((inspection.datasets[0] as DatasetInfo).id)
      else this.#goto('dataset')
    } catch (error) {
      this.#fail(error, 'parse_failed')
    }
  }

  // ───────────────────────────────────────────────────────────── dataset

  async selectDataset(id: string): Promise<void> {
    const { datasets, file } = this.getState()
    const dataset = datasets.find((d) => d.id === id)
    if (!dataset || !file) return
    const signal = this.#abortRunning()
    this.store.set({ dataset, busy: 'loading', error: null })
    this.#emit({ type: 'dataset:selected', dataset })
    const started = performance.now()
    try {
      const format = this.importer.formats.find((f) => f.id === this.getState().format?.id)
      if (!format) throw new Error('Format adapter missing')
      const max = this.importer.config.maxRows
      const grid: RawValue[][] = []
      const records: Record<string, RawValue>[] = []
      for await (const chunk of format.read(file, { dataset, signal })) {
        throwIfAborted(signal)
        if (dataset.layout === 'grid') for (const row of chunk as RawValue[][]) grid.push(row)
        else for (const record of chunk as Record<string, RawValue>[]) records.push(flattenRecord(record))
        if (max && grid.length + records.length > max + (dataset.layout === 'grid' ? PREVIEW_ROWS : 0)) {
          throw tooManyRows(max)
        }
        await yieldToMain()
      }
      this.#grid = grid
      this.#records = records
      this.#emit({ type: 'rows:loaded', count: grid.length + records.length, durationMs: performance.now() - started })
      if (dataset.layout === 'grid') {
        const preview = grid.slice(0, PREVIEW_ROWS)
        const detected = detectHeaderRow(preview)
        this.store.set({ preview, headerRow: detected, detectedHeaderRow: detected })
        const mode = this.importer.config.headerSelection ?? 'auto'
        if (mode === 'always' || (mode === 'auto' && detected > 0)) {
          this.store.set({ sourceFields: fieldsFromGrid(preview, detected) })
          this.#goto('header')
          return
        }
      }
      await this.#prepareMapping(signal)
    } catch (error) {
      this.#fail(error, 'parse_failed')
    }
  }

  // ───────────────────────────────────────────────────────────── header row

  /** Choose the header row of a grid dataset (0-based index into `preview`). */
  setHeaderRow(index: number): void {
    const { preview } = this.getState()
    if (index < 0 || index >= preview.length) return
    this.store.set({ headerRow: index, sourceFields: fieldsFromGrid(preview, index) })
  }

  async confirmHeader(): Promise<void> {
    const signal = this.#abortRunning()
    try {
      await this.#prepareMapping(signal)
    } catch (error) {
      this.#fail(error)
    }
  }

  // ───────────────────────────────────────────────────────────── mapping

  async #prepareMapping(signal: AbortSignal): Promise<void> {
    const { dataset, headerRow } = this.getState()
    if (!dataset) return
    let sourceFields: SourceField[]
    if (dataset.layout === 'grid') {
      sourceFields = fieldsFromGrid(this.#grid.slice(0, headerRow + 1 + PREVIEW_ROWS), headerRow)
      const body = this.#grid.slice(headerRow + 1)
      this.#sourceRows = []
      body.forEach((row, i) => {
        if (row.every((v) => stringify(v).trim() === '')) return // skip blank lines
        this.#sourceRows.push({ id: `r${i}`, sourceIndex: headerRow + i + 2, values: gridRowToValues(row, sourceFields) })
      })
    } else {
      sourceFields = fieldsFromRecords(this.#records)
      this.#sourceRows = this.#records.map((values, i) => ({ id: `r${i}`, sourceIndex: i + 1, values }))
    }
    if (!this.#sourceRows.length) throw importError('empty_file', 'No data rows found below the header')
    // Same rule as run(): maxRows counts data rows (header and blank lines excluded).
    const max = this.importer.config.maxRows
    if (max && this.#sourceRows.length > max) throw tooManyRows(max)

    this.store.set({ sourceFields, rowCount: this.#sourceRows.length, customFields: [], busy: 'matching' })

    // 1) Recipes  2) Matchers
    let mapping: Mapping = {}
    let recipe: SessionState['recipe'] = null
    const store = this.importer.recipes
    if (store) {
      const found = findRecipe(await store.list(this.schema.id), sourceFields)
      if (found) {
        // Custom fields first, so the recipe's mappings to them resolve.
        this.store.set({ customFields: restoreCustomFields(found.customFields, this.importer.customFields, this.importer.schema) })
        mapping = applyRecipe(found, sourceFields, new Set(this.schema.fields.map((f) => f.key)))
        recipe = { id: found.id, ...(found.name ? { name: found.name } : {}), updatedAt: found.updatedAt }
      }
    }
    const suggestions = await collectSuggestions(this.importer, sourceFields, mapping, signal)
    throwIfAborted(signal)
    this.#emit({ type: 'mapping:suggested', suggestions })
    mapping = applySuggestions(this.importer, mapping, suggestions, this.#sourceRows, sourceFields)
    this.store.set({ mapping, suggestions, recipe })
    this.#goto('mapping')
  }

  // ───────────────────────────────────────────────────────────── custom fields

  /**
   * Add a field the schema doesn't have (`customFields` option). With `source`,
   * the column is mapped to it right away. Throws `invalid_custom_field` with a
   * message for the user when the field isn't allowed.
   */
  addCustomField(input: CustomFieldInput): CustomField {
    const { customFields, mapping, sourceFields } = this.getState()
    const taken = new Set(this.schema.fields.map((f) => f.key))
    const field: CustomField = {
      key: customFieldKey(input.label, taken),
      label: input.label.trim(),
      type: input.type,
      ...(input.group ? { group: input.group } : {}),
      ...(input.type === 'enum' && input.options?.length ? { options: input.options } : {}),
    }
    validateCustomField(field, this.importer.customFields, this.schema)
    const next = [...customFields, field]
    const schema = withCustomFields(this.importer.schema, next)
    const definition = schema.fields.find((f) => f.key === field.key) as FieldDefinition
    let nextMapping = mapping
    if (input.source && sourceFields.some((s) => s.key === input.source)) {
      // Same inference as a suggested mapping: date order, decimal separator, value map.
      const m = enrichMapping(this.importer, definition, { sources: [input.source], origin: 'user' }, this.#sourceRows, sourceFields)
      nextMapping = { ...mapping, [field.key]: m }
    }
    this.store.set({ customFields: next, mapping: nextMapping })
    return field
  }

  /** Remove a custom field and its mapping. */
  removeCustomField(key: string): void {
    const { customFields, mapping } = this.getState()
    if (!customFields.some((f) => f.key === key)) return
    const { [key]: _removed, ...rest } = mapping
    this.store.set({ customFields: customFields.filter((f) => f.key !== key), mapping: rest })
  }

  /** A starting point for adding `sourceKey` as a custom field: its header as name and a type that fits its values. */
  suggestCustomField(sourceKey: string): CustomFieldInput | null {
    const options = this.importer.customFields
    const source = this.getState().sourceFields.find((s) => s.key === sourceKey)
    if (!options || !source) return null
    return suggestCustomField(source, this.sourceValues(sourceKey, 13), this.#sourceRows.length, options)
  }

  /** Set (or clear with `null`) the mapping of a target field. */
  setMapping(target: string, mapping: FieldMapping | null): void {
    const field = this.schema.fields.find((f) => f.key === target)
    if (!field) return
    const next = { ...this.getState().mapping }
    if (mapping === null || (mapping.sources.length === 0 && mapping.fallback === undefined)) delete next[target]
    else {
      const previous = next[target]
      const sourcesChanged =
        !previous ||
        previous.sources.join() !== mapping.sources.join() ||
        JSON.stringify(previous.transforms) !== JSON.stringify(mapping.transforms)
      // Re-detect parsing options / value maps when the input changes.
      const base: FieldMapping = { ...mapping, origin: mapping.origin ?? 'user' }
      if (sourcesChanged && previous) {
        if (mapping.options === previous.options) delete base.options
        if (mapping.valueMap === previous.valueMap) delete base.valueMap
      }
      delete base.confidence
      if (base.origin === 'user') delete base.confidence
      next[target] = enrichMapping(this.importer, field, base, this.#sourceRows, this.getState().sourceFields)
    }
    this.store.set({ mapping: next })
  }

  /** Map one source column to a target, removing it from any other target it was mapped to (1:1 semantics). */
  assign(target: string, source: string | null): void {
    if (source === null) {
      this.setMapping(target, null)
      return
    }
    const current = this.getState().mapping
    for (const [key, m] of Object.entries(current)) {
      if (key !== target && m.sources.length === 1 && m.sources[0] === source && !m.transforms?.length) this.setMapping(key, null)
    }
    this.setMapping(target, { sources: [source] })
  }

  clearMapping(): void {
    this.store.set({ mapping: {}, recipe: null })
  }

  /** Re-run matchers for unmapped fields and apply confident suggestions. */
  async autoMap(): Promise<void> {
    const signal = this.#controller.signal
    const { sourceFields, mapping } = this.getState()
    const suggestions = await collectSuggestions(this.importer, sourceFields, mapping, signal)
    const next = applySuggestions(this.importer, mapping, suggestions, this.#sourceRows, sourceFields)
    this.store.set({ mapping: next, suggestions })
  }

  /** Preview how a (draft) mapping turns the first rows into values for `target`. */
  previewField(target: string, mapping: FieldMapping | undefined = this.getState().mapping[target], limit = 5): FieldPreview[] {
    const field = this.schema.fields.find((f) => f.key === target)
    if (!field || !mapping) return []
    const labels = this.#labels(mapping.sources)
    const out: FieldPreview[] = []
    for (const row of this.#sourceRows) {
      const inputs = mapping.sources.map((k) => row.values[k] ?? null)
      if (inputs.every((v) => stringify(v).trim() === '') && out.length < limit - 1 && this.#sourceRows.length > limit) continue
      let transformed: unknown
      try {
        transformed = applyFieldMapping(mapping, row.values, field, this.importer.transforms, labels)
      } catch (error) {
        out.push({
          rowId: row.id,
          sourceIndex: row.sourceIndex,
          inputs,
          transformed: undefined,
          output: undefined,
          issue: { field: target, code: 'transform_failed', message: (error as Error).message },
        })
        if (out.length >= limit) break
        continue
      }
      const r = coerceValue(transformed, field, mapping.options, mapping.valueMap)
      out.push({
        rowId: row.id,
        sourceIndex: row.sourceIndex,
        inputs,
        transformed,
        output: r.ok ? r.value : undefined,
        ...(r.ok ? {} : { issue: r.issue }),
      })
      if (out.length >= limit) break
    }
    return out
  }

  /** Distinct values a mapping produces for `target` (after transforms), e.g. to build an enum value map. */
  distinctValues(
    target: string,
    mapping: FieldMapping | undefined = this.getState().mapping[target],
    limit = 200,
  ): (DistinctValue & { matched?: string })[] {
    const field = this.schema.fields.find((f) => f.key === target)
    if (!field || !mapping) return []
    const labels = this.#labels(mapping.sources)
    const values = this.#sourceRows.map((row) => {
      try {
        return applyFieldMapping({ ...mapping, fallback: undefined }, row.values, field, this.importer.transforms, labels)
      } catch {
        return undefined
      }
    })
    return distinctValues(values, limit).map((d) => {
      const r = coerceValue(d.value, field, mapping.options, mapping.valueMap)
      return r.ok ? { ...d, matched: stringify(r.value) } : d
    })
  }

  /** Distinct raw values of a source column. */
  sourceValues(sourceKey: string, limit = 200): DistinctValue[] {
    return distinctValues(
      this.#sourceRows.map((r) => r.values[sourceKey]),
      limit,
    )
  }

  #labels(keys: string[]): string[] {
    const { sourceFields } = this.getState()
    return keys.map((k) => sourceFields.find((f) => f.key === k)?.label ?? k)
  }

  /** Required fields that are not mapped yet. */
  missingRequired(): string[] {
    const { mapping } = this.getState()
    return this.schema.fields.filter((f) => f.required && !mapping[f.key] && f.default === undefined).map((f) => f.key)
  }

  /** Validate all rows with the current mapping and move to review. */
  async confirmMapping(options: { saveRecipe?: boolean | string } = {}): Promise<void> {
    const signal = this.#abortRunning()
    const { mapping } = this.getState()
    this.#emit({ type: 'mapping:confirmed', mapping })
    if (options.saveRecipe !== false) await this.saveRecipe(typeof options.saveRecipe === 'string' ? options.saveRecipe : undefined)
    this.#edits.clear()
    this.#asyncIssues.clear()
    try {
      await this.#validateAll(signal)
      this.#goto('review')
    } catch (error) {
      this.#fail(error)
    }
  }

  // ───────────────────────────────────────────────────────────── recipes

  /** The current mapping as a portable recipe. */
  exportRecipe(name?: string): Recipe {
    const { mapping, sourceFields, headerRow, dataset, recipe, format, customFields } = this.getState()
    return createRecipe(mapping, sourceFields, {
      // Only the custom fields the mapping uses.
      customFields: customFields.filter((f) => mapping[f.key]),
      ...(recipe?.id ? { id: recipe.id } : {}),
      ...((name ?? recipe?.name) ? { name: name ?? recipe?.name } : {}),
      ...(this.schema.id ? { schemaId: this.schema.id } : {}),
      ...(dataset?.layout === 'grid' ? { headerRow } : {}),
      ...(dataset ? { dataset: dataset.id } : {}),
      ...(format ? { format: format.id } : {}),
    })
  }

  async saveRecipe(name?: string): Promise<Recipe | undefined> {
    const store = this.importer.recipes
    if (!store || !Object.keys(this.getState().mapping).length) return undefined
    const recipe = this.exportRecipe(name)
    try {
      await store.save(recipe)
    } catch (error) {
      console.warn('[openimport] could not save recipe', error)
    }
    return recipe
  }

  /** Apply a recipe to the current source fields (e.g. picked from a list). Throws for invalid recipes. */
  applyRecipe(input: Recipe | unknown): void {
    const recipe = parseRecipe(input, this.importer.transforms)
    const { sourceFields } = this.getState()
    this.store.set({ customFields: restoreCustomFields(recipe.customFields, this.importer.customFields, this.importer.schema) })
    const mapping = applyRecipe(recipe, sourceFields, new Set(this.schema.fields.map((f) => f.key)))
    this.store.set({ mapping, recipe: { id: recipe.id, ...(recipe.name ? { name: recipe.name } : {}), updatedAt: recipe.updatedAt } })
  }

  // ───────────────────────────────────────────────────────────── validation

  async #validateAll(signal: AbortSignal): Promise<void> {
    const started = performance.now()
    const { mapping, sourceFields } = this.getState()
    const labels = Object.fromEntries(sourceFields.map((f) => [f.key, f.label]))
    this.#processor = createRowProcessor(this.schema, mapping, this.importer.transforms, labels)
    const total = this.#sourceRows.length
    this.store.set({ busy: 'validating', progress: { processed: 0, total } })

    const rows: ReviewRow[] = new Array(total)
    const pending: Promise<void>[] = []
    for (let i = 0; i < total; i++) {
      const source = this.#sourceRows[i] as SourceRow
      const checked = this.#processor.check(source, this.#edits.get(source.id))
      if (checked instanceof Promise) pending.push(checked.then((row) => void (rows[i] = row)))
      else rows[i] = checked
      if (i % VALIDATION_CHUNK === VALIDATION_CHUNK - 1) {
        this.store.set({ progress: { processed: i + 1, total } })
        await yieldToMain()
        throwIfAborted(signal)
      }
    }
    await Promise.all(pending)
    // Uniqueness via the edit index, built now while every row is touched anyway.
    this.#live = new LiveRows(rows, this.schema)
    this.#indexSources()
    this.store.set({ rows: this.#live.rows, stats: this.#live.stats, progress: null })
    await this.#runBatchValidation(this.#live.rows, signal)
    const final = this.getState().stats
    this.#emit({
      type: 'validation:completed',
      errors: final.errorCount,
      warnings: final.warningCount,
      durationMs: performance.now() - started,
    })
  }

  async #runBatchValidation(target: ReviewRow[], signal: AbortSignal): Promise<void> {
    if (!this.schema.validateBatch || !target.length) return
    const found = await runBatchValidators(
      this.schema,
      target.map((r) => ({ id: r.id, values: r.values })),
      signal,
      this.importer.config.batchSize ?? 1000,
    )
    for (const r of target) this.#asyncIssues.set(r.id, found.get(r.id) ?? [])
    this.#replaceRows(
      (row) => {
        const extra = found.get(row.id) ?? []
        const base = row.issues.filter((i) => !i.async)
        if (!extra.length && base.length === row.issues.length) return row
        return { ...row, issues: [...base, ...extra] }
      },
      target.map((r) => r.id),
    )
  }

  // ───────────────────────────────────────────────────────────── review

  /** Replace some review rows (by id) without recomputing every row. */
  #replaceRows(
    replace: (row: ReviewRow) => ReviewRow | undefined,
    ids: Iterable<string>,
    after: () => Partial<SessionState> = () => ({}),
  ): void {
    const current = this.getState().rows
    if (!this.#live?.describes(current)) this.#live = new LiveRows(current, this.schema)
    const changes = new Map<number, ReviewRow>()
    for (const id of ids) {
      const i = this.#live.indexOf(id)
      if (i === undefined) continue
      const next = replace(current[i] as ReviewRow)
      if (next && next !== current[i]) changes.set(i, next)
    }
    const patch = after()
    if (!changes.size) {
      if (Object.keys(patch).length) this.store.set(patch)
      return
    }
    const { rows, stats } = this.#live.update(changes)
    this.store.set({ ...patch, rows, stats })
  }

  #indexSources(): void {
    this.#sourceById = { for: this.#sourceRows, map: new Map(this.#sourceRows.map((r) => [r.id, r])) }
  }

  #source(id: string): SourceRow | undefined {
    if (this.#sourceById?.for !== this.#sourceRows) this.#indexSources()
    return this.#sourceById?.map.get(id)
  }

  /** Edit a cell. `value` is treated like source input: it's coerced and validated. */
  editCell(rowId: string, field: string, value: unknown): void {
    this.editCells([{ rowId, field, value }])
  }

  editCells(edits: { rowId: string; field: string; value: unknown }[]): void {
    if (!this.#processor || !edits.length) return
    const processor = this.#processor
    const touched = new Set<string>()
    const fields = new Set<string>()
    for (const { rowId, field, value } of edits) {
      const current = this.#edits.get(rowId) ?? {}
      this.#edits.set(rowId, { ...current, [field]: value })
      touched.add(rowId)
      fields.add(field)
    }
    const pendingStandard = new Map<string, Promise<Issue[]>>()
    let async = false
    // Rebuilt rows lose their duplicate issues; #replaceRows recomputes them for every affected row.
    this.#replaceRows(
      (row) => {
        const source = this.#source(row.id)
        if (!source) return row
        const next = processor.process(source, this.#edits.get(row.id))
        const std = processor.validateStandard(next)
        if (std instanceof Promise) pendingStandard.set(next.id, std)
        else next.issues.push(...dedupeStandard(next, std))
        // Keep the last known server-side issues until they've been re-checked.
        next.issues.push(...(this.#asyncIssues.get(row.id) ?? []))
        return next
      },
      touched,
      () => {
        async = pendingStandard.size > 0 || !!this.schema.validateBatch
        if (async) this.#pending++
        return async ? { busy: 'validating' as const } : {}
      },
    )
    if (async) void this.#revalidateAsync(touched, pendingStandard)
  }

  /** Async part of an edit. The session stays `busy` (so it can't be submitted) until it settles. */
  async #revalidateAsync(ids: Set<string>, pendingStandard: Map<string, Promise<Issue[]>>) {
    const signal = this.#controller.signal
    try {
      if (pendingStandard.size) {
        const results = new Map<string, Issue[]>()
        for (const [id, promise] of pendingStandard) results.set(id, await promise)
        if (signal.aborted) return
        this.#replaceRows((row) => {
          const extra = results.get(row.id)
          return extra?.length ? { ...row, issues: [...row.issues, ...dedupeStandard(row, extra)] } : row
        }, results.keys())
      }
      await this.#runBatchValidation(
        this.getState().rows.filter((r) => ids.has(r.id)),
        signal,
      )
    } catch (error) {
      this.#fail(error)
    } finally {
      this.#pending = Math.max(0, this.#pending - 1)
      if (!this.#pending && this.getState().busy === 'validating') this.store.set({ busy: false })
    }
  }

  /** Find & replace within a field (exact cell match by default). Returns the number of changed cells. */
  replaceValues(field: string, find: string, replace: string, options: { rowIds?: string[]; match?: 'cell' | 'substring' } = {}): number {
    const rows = this.getState().rows
    const ids = options.rowIds ? new Set(options.rowIds) : null
    const edits: { rowId: string; field: string; value: unknown }[] = []
    for (const row of rows) {
      if (ids && !ids.has(row.id)) continue
      const current = stringify(row.values[field] ?? row.input[field])
      if (options.match === 'substring' ? current.includes(find) : current.trim() === find.trim()) {
        edits.push({ rowId: row.id, field, value: options.match === 'substring' ? current.split(find).join(replace) : replace })
      }
    }
    this.editCells(edits)
    return edits.length
  }

  deleteRows(ids: string[]): void {
    const remove = new Set(ids)
    this.#sourceRows = this.#sourceRows.filter((r) => !remove.has(r.id))
    for (const id of ids) {
      this.#edits.delete(id)
      this.#asyncIssues.delete(id)
    }
    this.#live = new LiveRows(
      this.getState().rows.filter((r) => !remove.has(r.id)),
      this.schema,
    )
    this.#indexSources()
    this.store.set({ rows: this.#live.rows, stats: this.#live.stats, rowCount: this.#live.rows.length })
  }

  /** Remove every row that has at least one error. */
  deleteInvalidRows(): number {
    const ids = this.getState()
      .rows.filter(hasErrors)
      .map((r) => r.id)
    this.deleteRows(ids)
    return ids.length
  }

  // ───────────────────────────────────────────────────────────── output

  /** Can the user submit right now? */
  canSubmit(): boolean {
    return isSubmittable(this.getState(), this.importer.config.invalidRows)
  }

  // ───────────────────────────────────────────────────────────── row queries
  // The review grid reads rows through these, so it works the same whether the
  // rows live in this thread or in a worker.

  #index = new RowIndex()

  countRows(query: RowQuery = {}): number {
    const { rows } = this.getState()
    return this.#index.resolve(rows, query)?.length ?? rows.length
  }

  getRows(query: RowQuery, start: number, end: number): ReviewRow[] {
    const { rows } = this.getState()
    const indices = this.#index.resolve(rows, query)
    if (!indices) return rows.slice(start, end)
    return indices.slice(start, end).map((i) => rows[i] as ReviewRow)
  }

  rowIds(query: RowQuery = {}): string[] {
    const { rows } = this.getState()
    const indices = this.#index.resolve(rows, query)
    return indices ? indices.map((i) => (rows[i] as ReviewRow).id) : rows.map((r) => r.id)
  }

  findIssue(query: RowQuery, from: { row: number; col: number } | null, fields: string[]): { row: number; col: number } | null {
    const { rows } = this.getState()
    const indices = this.#index.resolve(rows, query)
    const count = indices?.length ?? rows.length
    const total = count * fields.length
    if (!total) return null
    const start = from ? from.row * fields.length + from.col + 1 : 0
    for (let n = 0; n < total; n++) {
      const idx = (start + n) % total
      const r = Math.floor(idx / fields.length)
      const c = idx % fields.length
      const row = rows[indices ? (indices[r] as number) : r] as ReviewRow
      const key = fields[c]
      if (row.issues.some((i) => i.field === key && (i.severity ?? 'error') === 'error')) return { row: r, col: c }
    }
    return null
  }

  /** Nothing to release in-process; remote sessions terminate their worker. */
  dispose(): void {
    this.abort()
  }

  #toRecord(row: ReviewRow): Promise<ImportRecord<T>> {
    return toOutputRecord<T>(this.schema, row.values)
  }

  /** Valid records in batches (async iterable — never materialises everything at once). */
  async *records(batchSize = this.importer.config.batchSize ?? 1000): AsyncGenerator<{ records: ImportRecord<T>[]; rows: ReviewRow[] }> {
    const valid = this.getState().rows.filter((r) => !hasErrors(r))
    for (let i = 0; i < valid.length; i += batchSize) {
      const rows = valid.slice(i, i + batchSize)
      yield { records: await Promise.all(rows.map((r) => this.#toRecord(r))), rows }
    }
  }

  /** All valid records at once. */
  async getRecords(): Promise<ImportRecord<T>[]> {
    const out: ImportRecord<T>[] = []
    for await (const batch of this.records()) out.push(...batch.records)
    return out
  }

  /**
   * Submit valid rows in batches to `handler` (or the importer's `onSubmit`).
   *
   * Partial success is explicit: if a batch fails, the rows already accepted
   * stay imported and leave the review, and calling `submit()` again sends
   * only the remaining rows. Every batch carries a stable `batchId` you can
   * use as an idempotency key.
   */
  async submit(handler: SubmitHandler<T> | undefined = this.importer.config.onSubmit): Promise<SubmitResult | undefined> {
    if (!handler) throw new Error('[openimport] submit() needs a handler or `onSubmit` in the importer config')
    if (!this.canSubmit()) return undefined
    const signal = this.#abortRunning()
    const { rows } = this.getState()
    const done = new Set([...this.#accepted, ...this.#rejected.map((r) => r.rowId)])
    const valid = rows.filter((r) => !hasErrors(r) && !done.has(r.id))
    const skipped = rows.filter(hasErrors).length
    const size = this.importer.config.batchSize ?? 1000
    const total = Math.ceil(valid.length / size)
    this.#goto('submitting')
    this.store.set({ busy: 'submitting', progress: { processed: 0, total: valid.length }, error: null })
    try {
      for (let index = 0; index < total; index++) {
        throwIfAborted(signal)
        const batchRows = valid.slice(index * size, (index + 1) * size)
        const records = await Promise.all(batchRows.map((r) => this.#toRecord(r)))
        const batchId = `${this.id}:${hashIds(batchRows.map((r) => r.id))}`
        const feedback = await handler({
          records,
          rows: batchRows,
          index,
          total,
          batchId,
          customFields: this.getState().customFields,
          signal,
        })
        const rejectedIds = new Set(feedback?.rejected?.map((r) => r.rowId))
        if (feedback?.rejected) this.#rejected.push(...feedback.rejected)
        for (const r of batchRows) if (!rejectedIds.has(r.id)) this.#accepted.add(r.id)
        const processed = Math.min((index + 1) * size, valid.length)
        this.store.set({ progress: { processed, total: valid.length } })
        this.#emit({ type: 'submit:progress', processed, total: valid.length })
      }
      const result: SubmitResult = { submitted: this.#accepted.size, skipped, rejected: [...this.#rejected] }
      this.store.set({ result, progress: null })
      this.#emit({ type: 'submit:completed', submitted: result.submitted, skipped })
      this.#goto('complete')
      return result
    } catch (error) {
      // Rows accepted so far are imported: take them out of the review so a retry sends only the rest.
      const accepted = this.#accepted
      const remaining = rows.filter((r) => !hasErrors(r) && !accepted.has(r.id) && !this.#rejected.some((x) => x.rowId === r.id)).length
      const left = rows.filter((r) => !accepted.has(r.id))
      this.#sourceRows = this.#sourceRows.filter((r) => !accepted.has(r.id))
      this.store.set({ step: 'review', busy: false, progress: null, rows: left, stats: computeStats(left), rowCount: left.length })
      const reason = error instanceof Error ? error.message : String(error)
      const message = accepted.size
        ? `${accepted.size.toLocaleString()} of ${(accepted.size + remaining).toLocaleString()} rows were imported before the error: ${reason}. Submitting again sends the remaining ${remaining.toLocaleString()}.`
        : reason
      this.#fail(importError('submit_failed', message, error))
      return undefined
    }
  }

  /** After a submission with rejections: go back to review with only the rejected rows. */
  reviewRejected(): void {
    const { result, rows } = this.getState()
    if (!result?.rejected.length) return
    const byRow = new Map<string, Issue[]>()
    for (const { rowId, ...issue } of result.rejected) {
      byRow.set(rowId, [...(byRow.get(rowId) ?? []), { severity: 'error', ...issue }])
    }
    const keep = rows.filter((r) => byRow.has(r.id)).map((r) => ({ ...r, issues: [...r.issues, ...(byRow.get(r.id) ?? [])] }))
    const keepIds = new Set(keep.map((r) => r.id))
    this.#sourceRows = this.#sourceRows.filter((r) => keepIds.has(r.id))
    this.store.set({ rows: keep, stats: computeStats(keep), rowCount: keep.length, result: null, step: 'review' })
  }

  /** Session id useful for logging. */
  readonly id = createId('session')
}
