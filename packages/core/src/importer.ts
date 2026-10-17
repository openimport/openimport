import { importError } from './errors'
import { fuzzyMatcher } from './matching'
import { type RunChunk, type RunOptions, runImport } from './pipeline'
import { defaultRecipeStore } from './recipe'
import { defineSchema } from './schema'
import { ImportSession } from './session'
import { hasJsonSchema, type StandardJSONSchemaV1, type StandardSchemaV1 } from './standard-schema'
import { builtinTransforms, createTransformRegistry, type TransformRegistry } from './transforms'
import type { FormatAdapter, ImportEvent, ImportPlugin, ImportSchema, Matcher, RecipeStore, ReviewRow, RowIssue, SourceFile } from './types'

export interface SubmitBatch<T> {
  /** Final, nested records of this batch. */
  records: T[]
  /** Review rows backing `records` (same order) — use `rows[i].id` to report rejections. */
  rows: ReviewRow[]
  /** 0-based batch index and total number of batches in this attempt. */
  index: number
  total: number
  /**
   * Stable id for this set of rows. Use it as an idempotency key: if the same
   * batch is sent again (e.g. after a timeout), it has the same id.
   */
  batchId: string
  signal: AbortSignal
}

/** Return rejections to send rows back to review with your server's messages. */
export interface SubmitFeedback {
  rejected?: RowIssue[]
}

export type SubmitHandler<T> = (batch: SubmitBatch<T>) => void | SubmitFeedback | Promise<void | SubmitFeedback>

export interface ImporterConfig<T> {
  /** The target schema: from `defineSchema(…)` or a zod / valibot / arktype object schema. */
  schema: ImportSchema<T> | StandardJSONSchemaV1<unknown, T>
  plugins?: ImportPlugin[]
  /** Where mapping recipes are remembered. Defaults to IndexedDB (shared by pages and workers), else localStorage, else memory. `false` disables recipes. */
  recipes?: RecipeStore | false
  /** Suggestions at or above this confidence are applied automatically. Default `0.7`. */
  autoMapThreshold?: number
  /** Show the header-row step: only when the header isn't the first row (`auto`), `always` or `never`. */
  headerSelection?: 'auto' | 'always' | 'never'
  /** `block`: rows with errors must be fixed or removed. `skip`: submit valid rows only. Default `block`. */
  invalidRows?: 'block' | 'skip'
  /** Rows per `onSubmit` batch. Default `1000`. */
  batchSize?: number
  /** Reject files larger than this many bytes. */
  maxFileSize?: number
  /** Reject datasets with more rows than this. */
  maxRows?: number
  /**
   * Persist records here. Called with batches of valid records; throw to stop
   * (rows sent so far stay imported, a retry sends the rest), or return
   * \`{ rejected }\` to send individual rows back to review.
   */
  onSubmit?: SubmitHandler<T>
  onEvent?: (event: ImportEvent) => void
}

export interface Importer<T = Record<string, unknown>> {
  readonly schema: ImportSchema<T>
  readonly config: Readonly<ImporterConfig<T>>
  readonly formats: FormatAdapter[]
  readonly matchers: Matcher[]
  readonly transforms: TransformRegistry
  readonly recipes: RecipeStore | null
  /** `accept` attribute for file inputs, e.g. `.csv,.tsv,text/csv`. */
  readonly accept: string
  /** Start an interactive import session (what the UI drives). */
  createSession: () => ImportSession<T>
  /** Find the format adapter for a file. */
  detectFormat: (file: SourceFile) => Promise<FormatAdapter | undefined>
  /**
   * Headless, streaming import: parse → map (recipe, explicit mapping or
   * auto-match) → validate, yielding batches. Works in Node, workers and browsers.
   */
  run: (file: Blob | File | SourceFile, options?: RunOptions) => AsyncGenerator<RunChunk<T>>
  emit: (event: ImportEvent) => void
}

export function createImporter<T>(config: ImporterConfig<T> & { schema: ImportSchema<T> }): Importer<T>
export function createImporter<S extends StandardJSONSchemaV1>(
  config: Omit<ImporterConfig<StandardSchemaV1.InferOutput<S>>, 'schema'> & { schema: S },
): Importer<StandardSchemaV1.InferOutput<S>>
export function createImporter<T>(config: ImporterConfig<T>): Importer<T> {
  const schema = (
    hasJsonSchema(config.schema) && !('fields' in config.schema) ? defineSchema(config.schema) : config.schema
  ) as ImportSchema<T>
  const plugins = config.plugins ?? []
  assertNoCollisions(plugins)
  const formats = plugins.flatMap((p) => p.formats ?? [])
  const pluginMatchers = plugins.flatMap((p) => p.matchers ?? [])
  // The fuzzy matcher is always present unless a plugin replaces it (same id).
  const matchers = [...pluginMatchers, ...(pluginMatchers.some((m) => m.id === 'fuzzy') ? [] : [fuzzyMatcher()])].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
  )
  const transforms = createTransformRegistry(plugins.flatMap((p) => p.transforms ?? []))
  const recipes =
    config.recipes === false ? null : (config.recipes ?? defaultRecipeStore(schema.id ? `openimport:recipes:${schema.id}` : undefined))

  const accept = [...new Set(formats.flatMap((f) => [...f.extensions.map((e) => `.${e}`), ...(f.mimeTypes ?? [])]))].join(',')

  const detectFormat = async (file: SourceFile) => {
    for (const f of formats) {
      const ok = f.supports
        ? await f.supports(file)
        : f.extensions.includes(file.extension) || (!!file.type && !!f.mimeTypes?.includes(file.type))
      if (ok) return f
    }
    return undefined
  }

  const emit = (event: ImportEvent) => {
    for (const p of plugins) {
      try {
        p.onEvent?.(event)
      } catch (error) {
        console.error(`[openimport] plugin "${p.name}" onEvent failed`, error)
      }
    }
    config.onEvent?.(event)
  }

  if (formats.length === 0) console.warn('[openimport] No format plugins registered — add e.g. csv() from @openimport/csv.')

  const importer: Importer<T> = {
    schema,
    config,
    formats,
    matchers,
    transforms,
    recipes,
    accept,
    detectFormat,
    emit,
    createSession: () => new ImportSession<T>(importer),
    run: (file, options) => runImport(importer, file, options),
  }
  return importer
}

/**
 * Collision rules, so the result never depends on plugin order:
 * - format ids and matcher ids must be unique (a matcher with id `fuzzy`
 *   intentionally replaces the built-in one);
 * - transform ops must be unique, and replacing a built-in transform needs
 *   `override: true` on the new definition.
 */
function assertNoCollisions(plugins: ImportPlugin[]): void {
  const fail = (message: string): never => {
    throw importError('invalid_plugin', `[openimport] ${message}`)
  }
  const owners = { format: new Map<string, string>(), matcher: new Map<string, string>(), transform: new Map<string, string>() }
  const claim = (kind: keyof typeof owners, id: string, plugin: string) => {
    const owner = owners[kind].get(id)
    if (owner) fail(`Plugins "${owner}" and "${plugin}" both register the ${kind} "${id}"`)
    owners[kind].set(id, plugin)
  }
  const builtins = new Set(builtinTransforms.map((t) => t.op))
  for (const p of plugins) {
    for (const f of p.formats ?? []) claim('format', f.id, p.name)
    for (const m of p.matchers ?? []) claim('matcher', m.id, p.name)
    for (const t of p.transforms ?? []) {
      claim('transform', t.op, p.name)
      if (builtins.has(t.op) && !t.override)
        fail(`Plugin "${p.name}" redefines the built-in transform "${t.op}"; set override: true if that's intended`)
    }
  }
}
