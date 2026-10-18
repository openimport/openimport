import type { FieldDefinition, FieldMapping, MatchSuggestion, ResolvedCustomFields, SessionState, SourceField } from '@openimport/core'
import { useMemo } from 'react'
import { useSession } from '../context'
import { shallowEqual, useImportState } from './use-import-state'

export interface MappingField {
  field: FieldDefinition
  mapping: FieldMapping | undefined
  /** Source fields feeding this target. */
  sources: SourceField[]
  /** A suggestion below the auto-map threshold, offered to the user. */
  suggestion: (MatchSuggestion & { sourceFields: SourceField[] }) | undefined
  status: 'mapped' | 'missing' | 'unmapped'
}

export interface UseMappingReturn {
  fields: MappingField[]
  sourceFields: SourceField[]
  /** Columns that feed no field. */
  unusedSources: SourceField[]
  mappedCount: number
  requiredMissing: FieldDefinition[]
  recipe: SessionState['recipe']
  canConfirm: boolean
  isBusy: boolean
  /** Custom field settings (types, groups), or `null` when users can't add fields. */
  customFields: ResolvedCustomFields | null
}

const select = (s: SessionState) => ({
  mapping: s.mapping,
  sourceFields: s.sourceFields,
  suggestions: s.suggestions,
  recipe: s.recipe,
  busy: s.busy,
  // session.schema includes these, so the field list follows them
  customFields: s.customFields,
})

/** Everything the mapping step needs, derived from session state. Actions live on `useSession()`. */
export function useMapping(): UseMappingReturn {
  const session = useSession()
  const { mapping, sourceFields, suggestions, recipe, busy } = useImportState(select, shallowEqual)
  // Includes custom fields; the same object until they change.
  const schema = session.schema
  return useMemo(() => {
    const byKey = new Map(sourceFields.map((f) => [f.key, f]))
    const used = new Set(Object.values(mapping).flatMap((m) => m.sources))
    const fields: MappingField[] = schema.fields.map((field) => {
      const m = mapping[field.key]
      const suggestion = suggestions.find((s) => s.target === field.key)
      const status = m ? 'mapped' : field.required && field.default === undefined ? 'missing' : 'unmapped'
      return {
        field,
        mapping: m,
        sources: (m?.sources ?? []).map((k) => byKey.get(k)).filter((f): f is SourceField => !!f),
        suggestion:
          !m && suggestion && !suggestion.sources.some((k) => used.has(k))
            ? { ...suggestion, sourceFields: suggestion.sources.map((k) => byKey.get(k)).filter((f): f is SourceField => !!f) }
            : undefined,
        status,
      }
    })
    const requiredMissing = fields.filter((f) => f.status === 'missing').map((f) => f.field)
    return {
      fields,
      sourceFields,
      unusedSources: sourceFields.filter((f) => !used.has(f.key)),
      mappedCount: fields.filter((f) => f.status === 'mapped').length,
      requiredMissing,
      recipe,
      canConfirm: requiredMissing.length === 0 && !busy,
      isBusy: !!busy,
      customFields: session.importer.customFields,
    }
  }, [session, schema, mapping, sourceFields, suggestions, recipe, busy])
}
