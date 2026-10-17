import { detectColumnOptions } from './coerce'
import type { Importer } from './importer'
import { assignGreedy, suggestValueMap, usedPlainSources } from './matching'
import { applyFieldMapping } from './transforms'
import type { FieldDefinition, FieldMapping, Mapping, MatchSuggestion, SourceField, SourceRow } from './types'
import { isEmpty, stringify } from './utils'

/** Run all matchers and merge their suggestions into a conflict-free set. */
export async function collectSuggestions(
  importer: Importer<any>,
  sourceFields: SourceField[],
  mapping: Mapping,
  signal: AbortSignal,
): Promise<MatchSuggestion[]> {
  const targets = new Set(importer.schema.fields.map((f) => f.key))
  const sourceKeys = new Set(sourceFields.map((f) => f.key))
  const all: MatchSuggestion[] = []
  const priority = new Map<MatchSuggestion, number>()
  const transforms = [...importer.transforms.values()]
  for (const matcher of importer.matchers) {
    try {
      const result = await matcher.match({ schema: importer.schema, sourceFields, mapping, transforms, signal })
      for (const s of result) {
        if (!targets.has(s.target) || !s.sources.length || !s.sources.every((k) => sourceKeys.has(k))) continue
        all.push(s)
        priority.set(s, matcher.priority ?? 0)
      }
    } catch (error) {
      if (signal.aborted) throw error
      console.error(`[openimport] matcher "${matcher.id}" failed`, error)
    }
  }
  // Higher-priority matchers get a small boost: an AI suggestion at 0.9 beats a fuzzy 0.95,
  // but a hesitant 0.5 doesn't override an exact header match.
  return assignGreedy(all, usedPlainSources(mapping), (s) => s.confidence + (priority.get(s) ?? 0) * 0.01)
}

/**
 * Enrich a field mapping with things we can infer from the data: the date
 * order / decimal separator, and value maps for enum fields.
 */
export function enrichMapping(
  importer: Importer<any>,
  field: FieldDefinition,
  mapping: FieldMapping,
  rows: SourceRow[],
  sourceFields: SourceField[],
): FieldMapping {
  const needsOptions = !mapping.options && ['date', 'datetime', 'number', 'integer'].includes(field.type)
  const needsValues = field.type === 'enum' && !mapping.valueMap
  if (!needsOptions && !needsValues) return mapping
  const labels = mapping.sources.map((k) => sourceFields.find((f) => f.key === k)?.label ?? k)
  const sample = rows.slice(0, 1000).map((r) => {
    try {
      return applyFieldMapping(mapping, r.values, field, importer.transforms, labels)
    } catch {
      return undefined
    }
  })
  const next = { ...mapping }
  if (needsOptions) {
    const options = detectColumnOptions(sample, field)
    if (Object.keys(options).length) next.options = options
  }
  if (needsValues) {
    const distinct = distinctValues(sample, 500).map((d) => d.value)
    const valueMap = suggestValueMap(distinct, field)
    if (Object.keys(valueMap).length) next.valueMap = valueMap
  }
  return next
}

export interface DistinctValue {
  value: string
  count: number
}

/** Count distinct (stringified, trimmed) values, most frequent first. */
export function distinctValues(values: unknown[], limit = 200): DistinctValue[] {
  const counts = new Map<string, number>()
  for (const v of values) {
    const items = Array.isArray(v) ? v : [v]
    for (const item of items) {
      if (isEmpty(item)) continue
      const s = stringify(item).trim()
      counts.set(s, (counts.get(s) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }))
}
