/**
 * Custom fields: fields the user adds during an import for columns the schema
 * doesn't cover ("Add as custom field"). They're typed and validated like
 * schema fields, but kept apart in the output (`record.$custom`), so the
 * typed record stays exactly what the schema describes.
 */
import { importError } from './errors'
import type { EnumOption, FieldDefinition, FieldType, ImportSchema, InferredType, RawValue } from './types'
import { isSafePath, stringify } from './utils'

/** Where custom field values are delivered on each output record. */
export const CUSTOM_KEY = '$custom'

/** A field added by the user during an import. Plain data: it's saved in recipes and sent to workers. */
export interface CustomField {
  key: string
  label: string
  type: FieldType
  /** One of the groups offered (e.g. an entity name), when the schema groups its fields. */
  group?: string
  /** Options for `enum` fields. */
  options?: EnumOption[]
}

/** What the user enters; `source` maps the new field to that column right away. */
export interface CustomFieldInput {
  label: string
  type: FieldType
  group?: string
  options?: EnumOption[]
  source?: string
}

export interface CustomFieldsOptions {
  /** Types users can choose. Default: text, number, date, yes/no, email, URL and select. */
  types?: FieldType[]
  /** Most custom fields per import. Default 20. */
  max?: number
  /** Groups a custom field can belong to. Default: the `group`s of the schema's fields. */
  groups?: string[]
  /** Every custom field must pick a group. Default: when every schema field has a group (e.g. one group per entity). */
  requireGroup?: boolean
  /** Return a message to reject a field, e.g. when the name is already taken. */
  check?: (field: CustomField) => string | undefined
}

export interface ResolvedCustomFields {
  types: FieldType[]
  max: number
  groups: string[]
  requireGroup: boolean
  check?: (field: CustomField) => string | undefined
}

/** A record with the custom fields' values, if any were added. */
export type ImportRecord<T> = T & { $custom?: Record<string, unknown> }

const DEFAULT_TYPES: FieldType[] = ['string', 'number', 'date', 'boolean', 'email', 'url', 'enum']
const ALL_TYPES = new Set<FieldType>(['string', 'number', 'integer', 'boolean', 'date', 'datetime', 'email', 'url', 'enum'])

export function resolveCustomFields(
  option: boolean | CustomFieldsOptions | undefined,
  schema: ImportSchema<unknown>,
): ResolvedCustomFields | null {
  if (!option) return null
  const o = option === true ? {} : option
  const types = (o.types ?? DEFAULT_TYPES).filter((t) => ALL_TYPES.has(t))
  const groups = o.groups ?? [...new Set(schema.fields.map((f) => f.group).filter((g): g is string => !!g))]
  const requireGroup = groups.length > 0 && (o.requireGroup ?? schema.fields.every((f) => !!f.group))
  return { types, max: o.max ?? 20, groups, requireGroup, ...(o.check ? { check: o.check } : {}) }
}

/** `"Kunde seit (Datum)"` → `kunde_seit_datum`; unique among `taken`. */
export function customFieldKey(label: string, taken: Set<string>): string {
  let base = label
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!base) base = 'field'
  if (/^\d/.test(base)) base = `f_${base}`
  if (!isSafePath(base)) base = `${base}_field`
  let key = base
  for (let n = 2; taken.has(key); n++) key = `${base}_${n}`
  return key
}

export function toFieldDefinition(field: CustomField): FieldDefinition {
  return {
    key: field.key,
    label: field.label,
    type: field.type,
    custom: true,
    ...(field.group ? { group: field.group } : {}),
    ...(field.options ? { options: field.options } : {}),
  }
}

const merged = new WeakMap<ImportSchema<unknown>, WeakMap<CustomField[], ImportSchema<unknown>>>()

/** The schema with custom fields appended. Stable for the same inputs, so it's cheap to call on every render. */
export function withCustomFields<T>(schema: ImportSchema<T>, fields: CustomField[]): ImportSchema<T> {
  if (!fields.length) return schema
  let bySchema = merged.get(schema as ImportSchema<unknown>)
  if (!bySchema) merged.set(schema as ImportSchema<unknown>, (bySchema = new WeakMap()))
  let out = bySchema.get(fields)
  if (!out) {
    out = { ...(schema as ImportSchema<unknown>), fields: [...schema.fields, ...fields.map(toFieldDefinition)] }
    bySchema.set(fields, out)
  }
  return out as ImportSchema<T>
}

/** Check a new field against the options and the fields that already exist. Throws `invalid_custom_field`. */
export function validateCustomField(field: CustomField, options: ResolvedCustomFields | null, schema: ImportSchema<unknown>): void {
  const fail = (message: string): never => {
    throw importError('invalid_custom_field', message)
  }
  if (!options) fail('Custom fields are not enabled for this importer')
  const o = options as ResolvedCustomFields
  if (!field.label.trim()) fail('Enter a name for the field')
  if (!o.types.includes(field.type)) fail(`"${field.type}" is not an allowed type for custom fields`)
  if (field.type === 'enum' && !field.options?.length) fail('A select field needs options')
  if (field.group !== undefined && !o.groups.includes(field.group)) fail(`Unknown group "${field.group}"`)
  if (o.requireGroup && field.group === undefined) fail('Choose where the field belongs')
  if (!isSafePath(field.key) || field.key.includes('.')) fail(`Invalid key "${field.key}"`)
  const label = field.label.trim().toLowerCase()
  for (const f of schema.fields) {
    if (f.key === field.key) fail(`A field with the key "${field.key}" already exists`)
    if (f.label.trim().toLowerCase() === label && (f.group ?? '') === (field.group ?? ''))
      fail(`A field named "${field.label}" already exists`)
  }
  if (schema.fields.filter((f) => f.custom).length >= o.max) fail(`At most ${o.max} custom fields can be added`)
  const problem = o.check?.(field)
  if (problem) fail(problem)
}

/** Custom fields from an untrusted recipe, filtered to what this importer allows. Invalid entries are dropped. */
export function restoreCustomFields(input: unknown, options: ResolvedCustomFields | null, schema: ImportSchema<unknown>): CustomField[] {
  if (!options || !Array.isArray(input)) return []
  const out: CustomField[] = []
  let current = schema
  for (const raw of input) {
    const field = parseCustomField(raw)
    if (!field) continue
    try {
      validateCustomField(field, options, current)
    } catch {
      continue
    }
    out.push(field)
    current = withCustomFields(schema, out)
  }
  return out
}

/** Structural check of one recipe entry (types and safe keys only). */
export function parseCustomField(raw: unknown): CustomField | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const r = raw as Record<string, unknown>
  if (typeof r.key !== 'string' || typeof r.label !== 'string' || typeof r.type !== 'string') return undefined
  if (!ALL_TYPES.has(r.type as FieldType) || !isSafePath(r.key) || r.key.includes('.')) return undefined
  if (r.group !== undefined && typeof r.group !== 'string') return undefined
  let options: EnumOption[] | undefined
  if (r.options !== undefined) {
    if (!Array.isArray(r.options)) return undefined
    options = []
    for (const o of r.options) {
      if (typeof o !== 'object' || o === null || typeof (o as EnumOption).value !== 'string') return undefined
      const { value, label } = o as EnumOption
      options.push({ value, ...(typeof label === 'string' ? { label } : {}) })
    }
  }
  return {
    key: r.key,
    label: r.label,
    type: r.type as FieldType,
    ...(typeof r.group === 'string' ? { group: r.group } : {}),
    ...(options ? { options } : {}),
  }
}

/** Separate custom values from schema values (flat keys). */
export function splitCustomValues(
  schema: ImportSchema<unknown>,
  values: Record<string, unknown>,
): { values: Record<string, unknown>; custom: Record<string, unknown> | undefined } {
  let custom: Record<string, unknown> | undefined
  let rest: Record<string, unknown> | undefined
  for (const f of schema.fields) {
    if (!f.custom || !(f.key in values)) continue
    rest ??= { ...values }
    delete rest[f.key]
    if (values[f.key] !== undefined) (custom ??= {})[f.key] = values[f.key]
  }
  return { values: rest ?? values, custom }
}

/** A starting point for the "Add as custom field" form: the header as name, a type that fits the values. */
export function suggestCustomField(
  source: { key: string; label: string; inferredType: InferredType },
  distinct: { value: RawValue; count: number }[],
  rowCount: number,
  options: ResolvedCustomFields,
): CustomFieldInput {
  const allowed = (t: FieldType) => options.types.includes(t)
  const byInference: Partial<Record<InferredType, FieldType>> = {
    number: 'number',
    integer: allowed('integer') ? 'integer' : 'number',
    boolean: 'boolean',
    date: 'date',
    email: 'email',
    url: 'url',
  }
  let type: FieldType = 'string'
  let enumOptions: EnumOption[] | undefined
  const inferred = byInference[source.inferredType]
  if (inferred && allowed(inferred)) type = inferred
  else if (allowed('enum') && distinct.length >= 2 && distinct.length <= 12 && rowCount >= distinct.length * 2) {
    // A handful of values, each used on two rows or more on average, reads as a choice list.
    type = 'enum'
    enumOptions = distinct.map((d) => ({ value: stringify(d.value) })).filter((o) => o.value.trim() !== '')
  }
  if (!allowed(type)) type = options.types[0] ?? 'string'
  return { label: source.label.trim(), type, source: source.key, ...(enumOptions ? { options: enumOptions } : {}) }
}
