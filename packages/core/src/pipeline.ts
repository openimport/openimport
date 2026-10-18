import { collectSuggestions } from './automap'
import { type CustomField, type ImportRecord, restoreCustomFields, withCustomFields } from './custom-fields'
import { importError } from './errors'
import {
  applySuggestions,
  assertFileSize,
  runBatchValidators,
  toOutputRecord,
  tooManyRows,
  UniqueIndex,
  withExplicitSources,
} from './execution'
import type { Importer } from './importer'
import { applyRecipe, findRecipe, parseRecipe } from './recipe'
import { detectHeaderRow, fieldsFromGrid, fieldsFromRecords, flattenRecord, gridRowToValues, toSourceFile } from './source'
import type { DatasetInfo, Mapping, RawValue, Recipe, ReviewRow, RowIssue, SourceField, SourceFile, SourceRow } from './types'
import { stringify, throwIfAborted } from './utils'
import { createRowProcessor, hasErrors } from './validate'

export interface RunOptions {
  /** Dataset id (sheet, JSON path, …). Defaults to the recipe's dataset, then the first. */
  dataset?: string
  /** Header row for grid datasets. Defaults to the recipe's header row, then detection. */
  headerRow?: number
  /** Replay a saved recipe: mapping, header row and dataset. Validated before use. */
  recipe?: Recipe
  /** Or an explicit mapping keyed by target field, with sources given as *labels*. */
  mapping?: Mapping
  /** Custom fields an explicit `mapping` uses (a recipe brings its own). Needs the `customFields` option. */
  customFields?: CustomField[]
  /** Fall back to auto-matching when no mapping/recipe is given. Default `true`. */
  autoMap?: boolean
  /** Rows per yielded chunk. Default `1000`. */
  batchSize?: number
  signal?: AbortSignal
}

export interface RunChunk<T> {
  /** Records without errors. Values of custom fields are in `record.$custom`. */
  records: ImportRecord<T>[]
  /** Rows with at least one error (with their issues). */
  invalid: ReviewRow[]
  /** All issues in this chunk, flattened, with the 1-based source line/record number. */
  issues: (RowIssue & { sourceIndex: number })[]
  /** The mapping in effect (keys are source *keys*), provided on the first chunk. */
  mapping?: Mapping
  /** Custom fields in effect, provided on the first chunk. */
  customFields?: CustomField[]
  sourceFields?: SourceField[]
}

const SAMPLE_ROWS = 200

/**
 * Streaming, UI-less import with the same rules as the interactive session:
 * limits, transforms, coercion, field and row rules, Standard Schema,
 * uniqueness (first occurrence kept, later ones flagged) and `validateBatch`.
 *
 * Memory: rows are processed `batchSize` at a time, but formats that parse a
 * whole document (JSON, XML, XLSX) hold the file in memory, and uniqueness
 * keeps one entry per distinct value of each `unique` field.
 */
export async function* runImport<T>(
  importer: Importer<T>,
  input: Blob | File | SourceFile,
  options: RunOptions = {},
): AsyncGenerator<RunChunk<T>> {
  const signal = options.signal ?? new AbortController().signal
  const file = toSourceFile(input)
  assertFileSize(importer.config, file)
  const recipe = options.recipe ? parseRecipe(options.recipe, importer.transforms) : undefined
  const format = await importer.detectFormat(file)
  if (!format) throw importError('unsupported_file', `No format plugin supports "${file.name}"`)
  const { datasets } = await format.inspect(file, { signal })
  const datasetId = options.dataset ?? recipe?.dataset
  const dataset: DatasetInfo | undefined = datasetId ? datasets.find((d) => d.id === datasetId) : datasets[0]
  if (!dataset) throw importError('empty_file', `Dataset "${datasetId ?? '(first)'}" not found`)
  const batchSize = options.batchSize ?? importer.config.batchSize ?? 1000
  const maxRows = importer.config.maxRows

  const iterator = format.read(file, { dataset, signal })[Symbol.asyncIterator]()
  // Buffer enough rows to find the header and sample values for matching.
  const buffered: (RawValue[] | Record<string, RawValue>)[] = []
  let done = false
  while (buffered.length < SAMPLE_ROWS && !done) {
    const next = await iterator.next()
    if (next.done) done = true
    else buffered.push(...(next.value as (RawValue[] | Record<string, RawValue>)[]))
  }

  const explicit = recipe?.mapping ?? options.mapping
  let sourceFields: SourceField[]
  let headerRow = 0
  let toValues: (row: RawValue[] | Record<string, RawValue>) => Record<string, RawValue>
  if (dataset.layout === 'grid') {
    const grid = buffered as RawValue[][]
    headerRow = options.headerRow ?? recipe?.headerRow ?? detectHeaderRow(grid)
    sourceFields = fieldsFromGrid(grid, headerRow)
    toValues = (row) => gridRowToValues(row as RawValue[], sourceFields)
    buffered.splice(0, headerRow + 1)
  } else {
    const flat = (buffered as Record<string, RawValue>[]).map((r) => flattenRecord(r))
    buffered.splice(0, buffered.length, ...flat)
    sourceFields = fieldsFromRecords(flat)
    // Properties named in an explicit mapping may only appear later in the stream.
    if (explicit)
      sourceFields = withExplicitSources(
        sourceFields,
        Object.values(explicit).flatMap((m) => m.sources),
      )
    toValues = (row) => flattenRecord(row as Record<string, RawValue>)
  }

  // Custom fields come with the recipe (or the explicit mapping), filtered to what the importer allows.
  let customFields: CustomField[] = []
  const resolve = (r: Recipe) => {
    customFields = restoreCustomFields(r.customFields, importer.customFields, importer.schema)
    return applyRecipe(r, sourceFields, new Set(withCustomFields(importer.schema, customFields).fields.map((f) => f.key)))
  }
  let mapping: Mapping = {}
  if (recipe) mapping = resolve(recipe)
  else if (options.mapping) {
    const now = new Date().toISOString()
    const inline = parseRecipe(
      {
        version: 1,
        id: 'inline',
        createdAt: now,
        updatedAt: now,
        sourceLabels: [],
        mapping: options.mapping,
        ...(options.customFields ? { customFields: options.customFields } : {}),
      },
      importer.transforms,
    )
    mapping = resolve(inline)
  } else if (importer.recipes) {
    const found = findRecipe(await importer.recipes.list(importer.schema.id), sourceFields)
    if (found) mapping = resolve(found)
  }
  const schema = withCustomFields(importer.schema, customFields)
  const sampleRows: SourceRow[] = buffered.slice(0, SAMPLE_ROWS).map((r, i) => ({ id: `s${i}`, sourceIndex: i, values: toValues(r) }))
  const suggestions =
    !Object.keys(mapping).length && options.autoMap !== false ? await collectSuggestions(importer, sourceFields, mapping, signal) : []
  mapping = applySuggestions(importer, mapping, suggestions, sampleRows, sourceFields)

  const labels = Object.fromEntries(sourceFields.map((f) => [f.key, f.label]))
  const processor = createRowProcessor(schema, mapping, importer.transforms, labels)
  const unique = new UniqueIndex(schema.fields.filter((f) => f.unique).map((f) => f.key))
  let line = dataset.layout === 'grid' ? headerRow + 1 : 0
  let count = 0
  let first = true

  const processRows = async (raw: (RawValue[] | Record<string, RawValue>)[]): Promise<RunChunk<T>> => {
    const rows: ReviewRow[] = []
    for (const r of raw) {
      line++
      const values = toValues(r)
      if (Object.values(values).every((v) => stringify(v).trim() === '')) continue
      if (maxRows && ++count > maxRows) throw tooManyRows(maxRows)
      const row = await processor.check({ id: `r${line}`, sourceIndex: line, values })
      row.issues.push(...unique.check(row.values, row.sourceIndex))
      rows.push(row)
    }
    // Server-side checks see the same rows the session would send them.
    const found = await runBatchValidators(
      schema,
      rows.filter((r) => !hasErrors(r)).map((r) => ({ id: r.id, values: r.values })),
      signal,
      batchSize,
    )
    const records: ImportRecord<T>[] = []
    const invalid: ReviewRow[] = []
    const issues: RunChunk<T>['issues'] = []
    for (const row of rows) {
      row.issues.push(...(found.get(row.id) ?? []))
      for (const issue of row.issues) issues.push({ ...issue, rowId: row.id, sourceIndex: row.sourceIndex })
      if (hasErrors(row)) invalid.push(row)
      else records.push(await toOutputRecord<T>(schema, row.values))
    }
    const chunk: RunChunk<T> = { records, invalid, issues }
    if (first) {
      chunk.mapping = mapping
      chunk.sourceFields = sourceFields
      chunk.customFields = customFields
      first = false
    }
    return chunk
  }

  const pending = buffered
  while (true) {
    while (pending.length >= batchSize) yield await processRows(pending.splice(0, batchSize))
    if (done) break
    throwIfAborted(signal)
    const next = await iterator.next()
    if (next.done) done = true
    else pending.push(...(next.value as (RawValue[] | Record<string, RawValue>)[]))
  }
  if (pending.length || first) yield await processRows(pending)
}
