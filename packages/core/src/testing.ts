/**
 * Conformance checks for format plugins. Use them in your plugin's tests:
 *
 *   const problems = await checkFormatAdapter(myFormat, sourceFromString(text, 'a.dat'))
 *   expect(problems).toEqual([])
 */
import { toSourceFile } from './source'
import type { DatasetInfo, FormatAdapter, ImportPlugin, RawValue, SourceFile } from './types'

export interface ConformanceOptions {
  /** Expected number of rows per dataset id (header rows included for grid datasets). */
  rows?: Record<string, number>
}

const isRaw = (v: unknown): v is RawValue =>
  v === null ||
  v === undefined ||
  typeof v === 'string' ||
  typeof v === 'number' ||
  typeof v === 'boolean' ||
  v instanceof Date ||
  (Array.isArray(v) && v.every(isRaw)) ||
  (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype && Object.values(v as object).every(isRaw))

/** Check one adapter against one sample file. Returns a list of problems (empty = conformant). */
export async function checkFormatAdapter(
  adapter: FormatAdapter,
  input: Blob | File | SourceFile,
  options: ConformanceOptions = {},
): Promise<string[]> {
  const problems: string[] = []
  const file = toSourceFile(input)
  if (!adapter.id) problems.push('`id` is empty')
  if (!adapter.label) problems.push('`label` is empty')
  if (!adapter.extensions.length) problems.push('`extensions` is empty')
  for (const ext of adapter.extensions)
    if (ext !== ext.toLowerCase() || ext.startsWith('.')) problems.push(`extension "${ext}" must be lower-case without a dot`)
  if (adapter.supports && !(await adapter.supports(file))) problems.push(`supports() returned false for ${file.name}`)

  const signal = new AbortController().signal
  let datasets: DatasetInfo[] = []
  try {
    datasets = (await adapter.inspect(file, { signal })).datasets
  } catch (error) {
    return [...problems, `inspect() threw: ${(error as Error).message}`]
  }
  if (!Array.isArray(datasets)) return [...problems, 'inspect() must return { datasets: [] }']
  const ids = new Set<string>()
  for (const d of datasets) {
    if (!d.id || !d.label) problems.push('every dataset needs an `id` and a `label`')
    if (ids.has(d.id)) problems.push(`dataset id "${d.id}" is used twice`)
    ids.add(d.id)
    if (d.layout !== 'grid' && d.layout !== 'records') problems.push(`dataset "${d.id}": layout must be "grid" or "records"`)
  }

  for (const d of datasets) {
    let rows = 0
    let chunks = 0
    try {
      for await (const chunk of adapter.read(file, { dataset: d, signal })) {
        chunks++
        if (!Array.isArray(chunk)) {
          problems.push(`dataset "${d.id}": read() must yield arrays of rows`)
          break
        }
        for (const row of chunk as unknown[]) {
          rows++
          if (d.layout === 'grid' && !Array.isArray(row)) problems.push(`dataset "${d.id}": grid rows must be arrays (row ${rows})`)
          if (d.layout === 'records' && (typeof row !== 'object' || row === null || Array.isArray(row)))
            problems.push(`dataset "${d.id}": records must be objects (row ${rows})`)
          if (!isRaw(row))
            problems.push(
              `dataset "${d.id}": row ${rows} contains values other than strings, numbers, booleans, dates, null, arrays or plain objects`,
            )
          if (problems.length > 20) return problems
        }
      }
    } catch (error) {
      problems.push(`dataset "${d.id}": read() threw: ${(error as Error).message}`)
      continue
    }
    const expected = options.rows?.[d.id] ?? (d.meta?.estimated ? undefined : d.rowCount)
    if (expected !== undefined && Math.abs(expected - rows) > (options.rows ? 0 : 1)) {
      problems.push(`dataset "${d.id}": expected ${expected} rows, read ${rows}`)
    }
    if (chunks === 0 && rows === 0 && (d.rowCount ?? 0) > 0) problems.push(`dataset "${d.id}": read() yielded nothing`)

    // Declared cancellation: an aborted signal must stop reading.
    if (adapter.capabilities?.cancellation) {
      const controller = new AbortController()
      controller.abort(new DOMException('Aborted', 'AbortError'))
      let yielded = 0
      try {
        for await (const chunk of adapter.read(file, { dataset: d, signal: controller.signal })) yielded += (chunk as unknown[]).length
        if (yielded > 0) problems.push(`dataset "${d.id}": declares cancellation but read() yielded rows after the signal was aborted`)
      } catch (error) {
        if ((error as Error).name !== 'AbortError')
          problems.push(`dataset "${d.id}": aborting should throw an AbortError, got: ${(error as Error).message}`)
      }
    }
  }
  return problems
}

/** Check every format of a plugin against a sample file it should accept. */
export async function checkPlugin(
  plugin: ImportPlugin,
  samples: Record<string, Blob | File | SourceFile>,
  options?: ConformanceOptions,
): Promise<string[]> {
  const problems: string[] = []
  if (!plugin.name) problems.push('plugin `name` is empty')
  for (const format of plugin.formats ?? []) {
    const sample = samples[format.id]
    if (!sample) {
      problems.push(`no sample file for format "${format.id}"`)
      continue
    }
    for (const p of await checkFormatAdapter(format, sample, options)) problems.push(`${format.id}: ${p}`)
  }
  return problems
}
