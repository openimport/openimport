import type { CustomField } from './custom-fields'
import type { StandardSchemaV1 } from './standard-schema'

// ─────────────────────────────────────────────────────────────────────────────
// Values
// ─────────────────────────────────────────────────────────────────────────────

/** A cell value as produced by a format plugin, before any coercion. */
export type RawValue = string | number | boolean | Date | null | undefined | RawValue[] | { [key: string]: RawValue }

// ─────────────────────────────────────────────────────────────────────────────
// Target schema
// ─────────────────────────────────────────────────────────────────────────────

export type FieldType = 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'datetime' | 'email' | 'url' | 'enum'

export interface EnumOption {
  value: string
  label?: string
  /** Alternative spellings that should resolve to this option, e.g. `['DE', 'Deutschland']`. */
  aliases?: string[]
}

export interface FieldValidationContext {
  /** The coerced record the value belongs to (target keys, flat dot-paths). */
  row: Readonly<Record<string, unknown>>
  rowIndex: number
  field: FieldDefinition
}

export type FieldValidator = (value: unknown, ctx: FieldValidationContext) => string | Omit<Issue, 'field'> | undefined | null | void

/**
 * A single field of the import target. Everything except `validate`/`parse` is
 * JSON-serialisable so schemas can be defined at runtime (e.g. loaded from an API).
 */
export interface FieldDefinition {
  /** Output key. Dots create nested output objects: `address.city` → `{ address: { city } }`. */
  key: string
  label: string
  type: FieldType
  description?: string
  required?: boolean
  unique?: boolean
  /** Alternative column names used by matchers, e.g. `['e-mail', 'mail address']`. */
  aliases?: string[]
  /** Example values (shown in the UI and the downloadable template). */
  examples?: string[]
  /** Visual grouping in the mapping UI, e.g. `"Address"`. */
  group?: string
  /** Added by the user during the import (see `customFields`). Its value is delivered in `record.$custom`. */
  custom?: boolean
  /** Options for `enum` fields. */
  options?: EnumOption[]
  /** Accept a list of values. Strings are split on `separator` (default `,`). Empty input becomes `[]`. */
  multiple?: boolean | { separator: string }
  /** Empty input becomes `null` instead of being left out (for `.nullable()` schemas). */
  nullable?: boolean
  /** Number: min/max value. String: min/max length. Date: min/max ISO date. */
  min?: number | string
  max?: number | string
  /** Regex source for string-like fields. */
  pattern?: string
  default?: unknown
  /** Custom coercion. Return `undefined` to fall back to the built-in coercion for `type`. */
  parse?: (value: RawValue, ctx: { field: FieldDefinition; options: ColumnOptions }) => unknown
  /** Custom field-level validation. Return a message (or issue) to flag the cell. */
  validate?: FieldValidator | FieldValidator[]
}

export type RowValidator = (row: Readonly<Record<string, unknown>>, ctx: { rowIndex: number }) => Issue[] | Issue | undefined | null | void

/**
 * Validates many rows at once, possibly asynchronously — e.g. check against your
 * backend whether an email already exists. Return issues with `rowId` set.
 */
export type BatchValidator = (
  rows: ReadonlyArray<{ id: string; values: Readonly<Record<string, unknown>> }>,
  ctx: { signal: AbortSignal },
) => Promise<RowIssue[]> | RowIssue[]

export interface ImportSchema<TRecord = Record<string, unknown>> {
  id?: string
  /** Optional display name, e.g. "Contacts". */
  name?: string
  fields: FieldDefinition[]
  /** Cross-field validation that runs after per-field validation. */
  validateRow?: RowValidator | RowValidator[]
  /** Async, batched validation (server-side lookups, dedupe against existing data). */
  validateBatch?: BatchValidator
  /** A Standard Schema (zod, valibot, arktype, …) that validates the final nested record. */
  standard?: StandardSchemaV1<unknown, TRecord>
  /** @internal phantom type carrier */
  readonly __record?: TRecord
}

// ─────────────────────────────────────────────────────────────────────────────
// Issues
// ─────────────────────────────────────────────────────────────────────────────

export type Severity = 'error' | 'warning' | 'info'

export interface Issue {
  /** Target field key. Omit for row-level issues. */
  field?: string
  /** Machine readable code, e.g. `required`, `invalid_email`, `duplicate`. Use for i18n. */
  code: string
  message: string
  severity?: Severity
  /** Set on issues produced by `validateBatch` (they're refreshed independently). */
  async?: boolean
}

export interface RowIssue extends Issue {
  rowId: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Sources & formats
// ─────────────────────────────────────────────────────────────────────────────

/** A file (or any blob) handed to the importer. */
export interface SourceFile {
  name: string
  size: number
  /** MIME type, may be empty. */
  type: string
  /** Lower-cased extension without the dot, e.g. `csv`. */
  extension: string
  blob: Blob
}

/**
 * A dataset is one "table" inside a file: a CSV has one, a workbook has one per
 * sheet, a JSON or XML document has one per repeated collection of records.
 */
export interface DatasetInfo {
  id: string
  label: string
  /** Human readable location, e.g. `Sheet1`, `$.data.customers[*]`, `/orders/order`. */
  path?: string
  /**
   * `grid`    – rows are arrays of cells; a header row must be located (CSV, XLSX).
   * `records` – rows are objects; fields are (nested) property paths (JSON, XML).
   */
  layout: 'grid' | 'records'
  /** Known or estimated number of data rows. */
  rowCount?: number
  /** Additional, format-specific details shown in the UI (e.g. `{ delimiter: ';', encoding: 'windows-1252' }`). */
  meta?: Record<string, string | number | boolean>
}

export interface Inspection {
  datasets: DatasetInfo[]
}

export interface ReadOptions {
  dataset: DatasetInfo
  signal: AbortSignal
}

/** A chunk of rows: arrays of cells for `grid` datasets, objects for `records` datasets. */
export type RowChunk = RawValue[][] | Record<string, RawValue>[]

export interface FormatAdapter {
  id: string
  /** Display name, e.g. `CSV`. */
  label: string
  /** Used for the file picker `accept` attribute and quick detection, e.g. `['csv', 'tsv']`. */
  extensions: string[]
  mimeTypes?: string[]
  /** Return true if this adapter can read the file. Defaults to an extension / MIME check. */
  supports?: (file: SourceFile) => boolean | Promise<boolean>
  /**
   * What the adapter can do, so apps and docs can be precise about it:
   * `streaming` – rows are read incrementally (memory doesn't grow with the file);
   * `cancellation` – reading stops promptly when the signal aborts;
   * `sourceLocations` – row numbers map to lines/records in the original file.
   */
  capabilities?: { streaming?: boolean; cancellation?: boolean; sourceLocations?: boolean }
  /** Discover the datasets contained in the file. Should be cheap. */
  inspect: (file: SourceFile, ctx: { signal: AbortSignal }) => Promise<Inspection>
  /** Stream rows of a dataset in chunks. */
  read: (file: SourceFile, options: ReadOptions) => AsyncIterable<RowChunk>
}

// ─────────────────────────────────────────────────────────────────────────────
// Source fields (the importer's uniform intermediate representation)
// ─────────────────────────────────────────────────────────────────────────────

export type InferredType = 'empty' | 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'email' | 'url' | 'mixed'

/** A column of a grid dataset or a property path of a records dataset. */
export interface SourceField {
  /** Stable key, unique within the dataset (`col_3`, `address.city`). */
  key: string
  /** Display label: the header cell text or the property path. */
  label: string
  /** Position in the source (column index or discovery order). */
  index: number
  /** First non-empty values, for previews and matching. */
  samples: RawValue[]
  inferredType: InferredType
  /** Share of empty values in the sampled rows, 0…1. */
  emptyRatio: number
}

export interface SourceRow {
  /** Stable row id. */
  id: string
  /** 1-based line/record number in the source, for error messages. */
  sourceIndex: number
  values: Record<string, RawValue>
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapping & transforms
// ─────────────────────────────────────────────────────────────────────────────

/** A serialisable step in a transform pipeline, e.g. `{ op: 'split', separator: ' ', index: 0 }`. */
export interface TransformStep {
  op: string
  [param: string]: unknown
}

export interface TransformContext {
  field: FieldDefinition
  /** Labels of the source fields feeding this target, in order. */
  sources: string[]
}

export interface TransformDefinition {
  /** Identifier referenced from `TransformStep.op`. */
  op: string
  label: string
  description?: string
  /** Whether the transform takes several inputs (e.g. `join`) or one. */
  arity: 'one' | 'many'
  /** Parameter schema rendered by the UI and used to validate steps. */
  params?: TransformParam[]
  /** Required to replace a built-in transform with the same `op`. */
  override?: boolean
  /**
   * Apply the transform. `value` is a single value for `arity: 'one'` and an array
   * of values (one per source) for `arity: 'many'`.
   */
  apply: (value: unknown, params: Record<string, unknown>, ctx: TransformContext) => unknown
}

export interface TransformParam {
  name: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'select'
  default?: unknown
  options?: { value: string; label: string }[]
}

/** Column-level parsing hints, auto-detected from the data and editable by the user. */
export interface ColumnOptions {
  /** Order of day/month/year in ambiguous dates like `03/04/2024`. */
  dateOrder?: 'DMY' | 'MDY' | 'YMD'
  /** Decimal separator for numbers like `1.234,56`. */
  decimal?: '.' | ','
}

/** How one target field is produced from the source. */
export interface FieldMapping {
  /** Source field keys. More than one source requires a `many`-arity transform (defaults to `join`). */
  sources: string[]
  /** Transform pipeline applied before type coercion. */
  transforms?: TransformStep[]
  /** Map distinct source values to enum option values, e.g. `{ 'Ja': 'yes' }`. */
  valueMap?: Record<string, string>
  /** Constant used when the mapped value is empty. */
  fallback?: unknown
  options?: ColumnOptions
  /** Where this mapping came from, for UI badges. */
  origin?: 'user' | 'recipe' | 'suggestion'
  /** Matcher confidence 0…1 when `origin` is `suggestion`. */
  confidence?: number
}

/** Target field key → mapping. Unmapped fields are absent. */
export type Mapping = Record<string, FieldMapping>

// ─────────────────────────────────────────────────────────────────────────────
// Matching
// ─────────────────────────────────────────────────────────────────────────────

export interface MatchSuggestion {
  target: string
  sources: string[]
  /** 0…1 */
  confidence: number
  transforms?: TransformStep[]
  /** Short explanation, e.g. `header "E-Mail" ≈ alias "email"`. */
  reason?: string
}

export interface MatchContext {
  schema: ImportSchema<unknown>
  sourceFields: SourceField[]
  /** Mapping as it currently stands (recipes already applied). */
  mapping: Mapping
  /** All registered transforms (built-ins and plugin-provided) a matcher may propose. */
  transforms: TransformDefinition[]
  signal: AbortSignal
}

export interface Matcher {
  id: string
  /** Matchers run in order of descending priority; ties keep plugin order. */
  priority?: number
  match: (ctx: MatchContext) => MatchSuggestion[] | Promise<MatchSuggestion[]>
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipes (persisted mapping decisions)
// ─────────────────────────────────────────────────────────────────────────────

export interface Recipe {
  version: 1
  id: string
  name?: string
  schemaId?: string
  createdAt: string
  updatedAt: string
  /** Labels of the source fields the recipe was created from, used to find it again. */
  sourceLabels: string[]
  /** Header row index for grid datasets. */
  headerRow?: number
  /** Dataset id (sheet name, JSON path, XML path) the recipe was made for. */
  dataset?: string
  /** Format adapter id the recipe was made with, for reference. */
  format?: string
  /** Target key → mapping, with `sources` expressed as source *labels* (not keys). */
  mapping: Mapping
  /** Custom fields the mapping uses, restored when the recipe is applied. */
  customFields?: CustomField[]
}

export interface RecipeStore {
  list: (schemaId: string | undefined) => Promise<Recipe[]> | Recipe[]
  save: (recipe: Recipe) => Promise<void> | void
  remove?: (id: string) => Promise<void> | void
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugins
// ─────────────────────────────────────────────────────────────────────────────

export interface ImportPlugin {
  name: string
  formats?: FormatAdapter[]
  matchers?: Matcher[]
  transforms?: TransformDefinition[]
  /** Observe the session lifecycle (analytics, logging, side effects). */
  onEvent?: (event: ImportEvent) => void
}

export type ImportEvent =
  | { type: 'file:loaded'; file: SourceFile; inspection: Inspection; format: string }
  | { type: 'dataset:selected'; dataset: DatasetInfo }
  | { type: 'rows:loaded'; count: number; durationMs: number }
  | { type: 'mapping:suggested'; suggestions: MatchSuggestion[] }
  | { type: 'mapping:confirmed'; mapping: Mapping }
  | { type: 'validation:completed'; errors: number; warnings: number; durationMs: number }
  | { type: 'submit:progress'; processed: number; total: number }
  | { type: 'submit:completed'; submitted: number; skipped: number }
  | { type: 'error'; error: ImportError }

// ─────────────────────────────────────────────────────────────────────────────
// Session state
// ─────────────────────────────────────────────────────────────────────────────

export type Step = 'upload' | 'dataset' | 'header' | 'mapping' | 'review' | 'submitting' | 'complete'

export type ImportErrorCode =
  | 'unsupported_file'
  | 'file_too_large'
  | 'parse_failed'
  | 'empty_file'
  | 'too_many_rows'
  | 'invalid_recipe'
  | 'invalid_plugin'
  | 'invalid_custom_field'
  | 'submit_failed'
  | 'aborted'
  | 'unknown'

export interface ImportError {
  code: ImportErrorCode
  message: string
  cause?: unknown
}

export interface ReviewRow {
  id: string
  sourceIndex: number
  /** Coerced values by target key (flat). */
  values: Record<string, unknown>
  /** Pre-coercion values by target key, shown when coercion failed. */
  input: Record<string, unknown>
  issues: Issue[]
  /** Target keys edited by the user. */
  edited?: string[]
}

export interface ReviewStats {
  total: number
  valid: number
  withErrors: number
  withWarnings: number
  errorCount: number
  warningCount: number
  /** Error count per target field key. */
  byField: Record<string, { errors: number; warnings: number }>
}

export interface SubmitResult {
  submitted: number
  skipped: number
  /** Issues reported back by `onSubmit` (e.g. server-side rejections). */
  rejected: RowIssue[]
}

export interface SessionState {
  step: Step
  /** True while an async operation (parsing, validating, submitting) runs. */
  busy: false | 'inspecting' | 'loading' | 'matching' | 'validating' | 'submitting'
  error: ImportError | null
  file: SourceFile | null
  format: { id: string; label: string } | null
  datasets: DatasetInfo[]
  dataset: DatasetInfo | null
  /** First rows of a grid dataset, used to pick the header row. */
  preview: RawValue[][]
  headerRow: number
  /** Header row chosen automatically (for the "we detected…" hint). */
  detectedHeaderRow: number
  sourceFields: SourceField[]
  rowCount: number
  mapping: Mapping
  /** Fields the user added during this import (`customFields` option). They're part of `session.schema`. */
  customFields: CustomField[]
  suggestions: MatchSuggestion[]
  /** Recipe applied to the current mapping, if any. */
  recipe: Pick<Recipe, 'id' | 'name' | 'updatedAt'> | null
  rows: ReviewRow[]
  stats: ReviewStats
  progress: { processed: number; total: number } | null
  result: SubmitResult | null
  /** Increments whenever `rows` changes. Remote sessions (worker) don't ship `rows`; watch this instead. */
  rowsVersion: number
  /** Whether `back()` leads somewhere from the current step. */
  canGoBack: boolean
}

/** Which review rows to look at. */
export interface RowQuery {
  filter?: 'all' | 'errors' | 'valid'
  /** Only rows with an issue on this field. */
  field?: string
  /** Case-insensitive search across all values. */
  search?: string
}

export type MaybePromise<T> = T | Promise<T>
