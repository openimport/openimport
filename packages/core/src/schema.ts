import { hasJsonSchema, type StandardJSONSchemaV1, type StandardSchemaV1 } from './standard-schema'
import type { BatchValidator, EnumOption, FieldDefinition, FieldType, ImportSchema, RowValidator } from './types'
import { humanize, isSafePath } from './utils'

// ─────────────────────────────────────────────────────────────────────────────
// Field builders with type inference
// ─────────────────────────────────────────────────────────────────────────────

export type FieldOptions = Partial<Omit<FieldDefinition, 'key' | 'type'>>

/** A field spec without a key. `T` is the coerced value type, `O` the literal options. */
export type FieldSpec<T = unknown, O extends FieldOptions = FieldOptions> = Omit<FieldDefinition, 'key' | 'label'> & {
  label?: string
  readonly __value?: T
  readonly __options?: O
}

type Multi<T, O> = O extends { multiple: true | { separator: string } } ? T[] : T
type Opt<T, O> = O extends { required: true } ? T : T | undefined

export type InferFieldValue<S> = S extends FieldSpec<infer T, infer O> ? Opt<Multi<T, O>, O> : unknown

function builder<T>(type: FieldType) {
  return <const O extends FieldOptions = {}>(options?: O): FieldSpec<T, O> => ({ ...options, type }) as FieldSpec<T, O>
}

function enumBuilder<const V extends string, const O extends FieldOptions = {}>(
  values: readonly (V | (EnumOption & { value: V }))[],
  options?: O,
): FieldSpec<V, O> {
  return {
    ...options,
    type: 'enum',
    options: values.map((v) => (typeof v === 'string' ? { value: v } : v)),
  } as FieldSpec<V, O>
}

/**
 * Field builders. Each returns a typed spec so `defineSchema` can infer the
 * shape of the imported records.
 *
 * @example
 * defineSchema({ fields: { email: field.email({ required: true, unique: true }) } })
 */
export const field = {
  string: builder<string>('string'),
  number: builder<number>('number'),
  integer: builder<number>('integer'),
  boolean: builder<boolean>('boolean'),
  /** ISO date string `YYYY-MM-DD`. */
  date: builder<string>('date'),
  /** ISO date-time string. */
  datetime: builder<string>('datetime'),
  email: builder<string>('email'),
  url: builder<string>('url'),
  enum: enumBuilder,
}

// ─────────────────────────────────────────────────────────────────────────────
// Nested record inference: { 'address.city': string } → { address: { city: string } }
// ─────────────────────────────────────────────────────────────────────────────

type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never
type Nest<K extends string, V> = K extends `${infer H}.${infer R}` ? { [P in H]: Nest<R, V> } : { [P in K]: V }
type DeepExpand<T> = T extends object ? (T extends unknown[] ? T : { [K in keyof T]: DeepExpand<T[K]> }) : T

export type InferRecord<F extends Record<string, FieldSpec>> = DeepExpand<
  UnionToIntersection<{ [K in keyof F & string]: Nest<K, InferFieldValue<F[K]>> }[keyof F & string]>
>

/** Extracts the record type an importer produces. */
export type InferSchema<S> = S extends ImportSchema<infer R> ? R : never

// ─────────────────────────────────────────────────────────────────────────────
// defineSchema
// ─────────────────────────────────────────────────────────────────────────────

interface SchemaExtras {
  id?: string
  name?: string
  validateRow?: RowValidator | RowValidator[]
  validateBatch?: BatchValidator
}

export interface SchemaConfig<F extends Record<string, FieldSpec>> extends SchemaExtras {
  fields: F
  /** Optional Standard Schema validated against every final record. */
  standard?: StandardSchemaV1
}

export interface RuntimeSchemaConfig extends SchemaExtras {
  fields: FieldDefinition[]
  standard?: StandardSchemaV1
}

export interface StandardSchemaExtras extends SchemaExtras {
  /** Per-field overrides layered on top of what's derived from the JSON Schema. */
  fields?: Record<string, Partial<Omit<FieldDefinition, 'key'>>>
}

/** Define a schema with typed field builders. */
export function defineSchema<const F extends Record<string, FieldSpec>>(config: SchemaConfig<F>): ImportSchema<InferRecord<F>>
/** Define a schema from a runtime field list (e.g. fetched from your API). */
export function defineSchema(config: RuntimeSchemaConfig): ImportSchema<Record<string, unknown>>
/**
 * Use a zod / valibot / arktype schema directly. Fields are derived via
 * Standard JSON Schema, and every record is validated with the schema itself.
 */
export function defineSchema<S extends StandardJSONSchemaV1>(
  schema: S,
  extras?: StandardSchemaExtras,
): ImportSchema<StandardSchemaV1.InferOutput<S>>
export function defineSchema(
  input: SchemaConfig<Record<string, FieldSpec>> | RuntimeSchemaConfig | StandardJSONSchemaV1,
  extras?: StandardSchemaExtras,
): ImportSchema<any> {
  if (hasJsonSchema(input)) {
    const json = input['~standard'].jsonSchema.input({ target: 'draft-2020-12' })
    const overrides = extras?.fields ?? {}
    // Constraints are enforced by the schema itself (with the library's own messages).
    const skipped: string[] = []
    const derived = collectFields(json, { prefix: '', group: undefined, exclude: new Set(), skipped })
    if (skipped.length)
      console.warn(`[openimport] Lists of objects can't be imported from a flat file and were left out: ${skipped.join(', ')}`)
    const fields = derived.map(({ min: _min, max: _max, pattern: _pattern, ...f }) =>
      normalizeField({ ...f, ...overrides[f.key], key: f.key }),
    )
    const { fields: _ignored, ...rest } = extras ?? {}
    assertValidKeys(fields)
    return { ...rest, fields, standard: input as StandardSchemaV1 }
  }
  const { fields, ...rest } = input as SchemaConfig<Record<string, FieldSpec>> | RuntimeSchemaConfig
  const list: FieldDefinition[] = Array.isArray(fields)
    ? fields.map(normalizeField)
    : Object.entries(fields).map(([key, spec]) => normalizeField({ ...spec, key } as FieldDefinition))
  assertValidKeys(list)
  return { ...rest, fields: list }
}

/**
 * Field keys become property paths in the output, so they must be unique,
 * safe (no `__proto__`, `prototype` or `constructor` segments, which could
 * reach `Object.prototype`) and must not overlap (`address` vs `address.city`).
 * This matters most for runtime schemas defined by tenants or users.
 */
export function assertValidKeys(fields: FieldDefinition[]): void {
  const keys = new Set<string>()
  for (const f of fields) {
    if (typeof f.key !== 'string' || !isSafePath(f.key)) throw new Error(`[openimport] Unsafe field key "${String(f.key)}"`)
    if (keys.has(f.key)) throw new Error(`[openimport] Duplicate field key "${f.key}"`)
    keys.add(f.key)
  }
  for (const key of keys) {
    const parts = key.split('.')
    for (let i = 1; i < parts.length; i++) {
      const prefix = parts.slice(0, i).join('.')
      if (keys.has(prefix)) throw new Error(`[openimport] Field keys "${prefix}" and "${key}" conflict: one is nested inside the other`)
    }
  }
}

function normalizeField(f: Partial<FieldDefinition> & { key: string }): FieldDefinition {
  const leaf = f.key.split('.').at(-1) ?? f.key
  const parent = f.key.includes('.') ? f.key.split('.').slice(0, -1).map(humanize).join(' › ') : undefined
  return {
    ...f,
    type: f.type ?? 'string',
    label: f.label ?? humanize(leaf),
    ...((f.group ?? parent) ? { group: f.group ?? parent } : {}),
  } as FieldDefinition
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON Schema → fields
// ─────────────────────────────────────────────────────────────────────────────

type JsonSchema = Record<string, any>

const FORMAT_TYPES: Record<string, FieldType> = {
  email: 'email',
  'idn-email': 'email',
  uri: 'url',
  url: 'url',
  'iri-reference': 'url',
  date: 'date',
  'date-time': 'datetime',
}

/**
 * Converts a JSON Schema object into importer fields. Nested objects become
 * dot-path keys; arrays of primitives become `multiple` fields. Arrays of
 * objects can't come from a flat file and are left out (see `fromJsonSchema`).
 */
export function fieldsFromJsonSchema(schema: JsonSchema, prefix = '', group?: string): FieldDefinition[] {
  return collectFields(schema, { prefix, group, exclude: new Set(), skipped: [] })
}

export interface CollectOptions {
  prefix: string
  group: string | undefined
  /** Dot paths to leave out, with everything below them. */
  exclude: Set<string>
  /** Receives the dot paths of arrays of objects that were left out. */
  skipped: string[]
}

export function collectFields(schema: JsonSchema, o: CollectOptions): FieldDefinition[] {
  const { prefix, group } = o
  const root = resolveRef(schema, schema)
  const props: Record<string, JsonSchema> = root.properties ?? {}
  const required = new Set<string>(root.required ?? [])
  const out: FieldDefinition[] = []

  for (const [name, raw] of Object.entries(props)) {
    const key = prefix ? `${prefix}.${name}` : name
    if (o.exclude.has(key)) continue
    const { node, nullable } = unwrapNullable(resolveRef(raw, schema))

    if (node.type === 'object' && node.properties) {
      out.push(
        ...collectFields(
          { ...node, $defs: schema.$defs, definitions: schema.definitions },
          { ...o, prefix: key, group: node.title ?? (group ? `${group} › ${humanize(name)}` : humanize(name)) },
        ),
      )
      continue
    }

    const isArray = node.type === 'array'
    const item = isArray ? unwrapNullable(resolveRef(node.items ?? {}, schema)).node : node
    if (isArray && (item.type === 'object' || item.properties)) {
      // A list of objects (e.g. several addresses) has no single-cell representation.
      o.skipped.push(key)
      continue
    }
    const enumValues: unknown[] | undefined = item.enum ?? (item.const !== undefined ? [item.const] : undefined)
    const anyOfConsts = (item.anyOf ?? item.oneOf)?.every((s: JsonSchema) => s.const !== undefined)
      ? (item.anyOf ?? item.oneOf).map((s: JsonSchema) => s.const)
      : undefined
    const options = enumValues ?? anyOfConsts

    let type: FieldType = 'string'
    if (options) type = 'enum'
    else if (item.format && FORMAT_TYPES[item.format]) type = FORMAT_TYPES[item.format] as FieldType
    else if (item.type === 'integer') type = 'integer'
    else if (item.type === 'number') type = 'number'
    else if (item.type === 'boolean') type = 'boolean'

    const field: FieldDefinition = {
      key,
      label: node.title ?? humanize(name),
      type,
    }
    if (group) field.group = group
    if (node.description) field.description = node.description
    // JSON Schema "required" means "present", not "non-empty": an empty list or
    // a null is a valid value there, so only demand content when it's asked for.
    if (required.has(name) && !nullable && (!isArray || (node.minItems ?? 0) > 0)) field.required = true
    if (nullable) field.nullable = true
    if (isArray) field.multiple = true
    if (options) field.options = options.map((v: unknown) => ({ value: String(v) }))
    // Exclusive bounds only translate exactly for integers; a validator enforces the rest.
    const exclusive = (bound: unknown, step: number) => (typeof bound === 'number' && type === 'integer' ? bound + step : undefined)
    const min = item.minimum ?? exclusive(item.exclusiveMinimum, 1) ?? item.minLength
    const max = item.maximum ?? exclusive(item.exclusiveMaximum, -1) ?? item.maxLength
    if (typeof min === 'number' && Math.abs(min) < Number.MAX_SAFE_INTEGER) field.min = min
    if (typeof max === 'number' && Math.abs(max) < Number.MAX_SAFE_INTEGER) field.max = max
    if (item.pattern && type === 'string') field.pattern = item.pattern
    if (node.default !== undefined) field.default = node.default
    if (Array.isArray(node.examples)) field.examples = node.examples.map(String)
    const aliases = node.aliases ?? node['x-aliases']
    if (Array.isArray(aliases)) field.aliases = aliases.map(String)
    if (node.unique === true || node['x-unique'] === true) field.unique = true
    out.push(field)
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Plain JSON Schema (e.g. an OpenAPI request body) as the importer's schema
// ─────────────────────────────────────────────────────────────────────────────

/** One validation error, as Ajv (6 or 8) and similar validators report it. */
export interface JsonSchemaError {
  /** Ajv 8: `/address/city` */
  instancePath?: string
  /** Ajv 6: `.address.city` */
  dataPath?: string
  /** e.g. schemasafe: `#/address/city` */
  instanceLocation?: string
  keyword?: string
  message?: string
  params?: { missingProperty?: string; [key: string]: unknown }
}

/**
 * A compiled validator: returns `true` or `false` and puts its errors on
 * `.errors`, like `ajv.compile(schema)`. Ajv's `$async` schemas return a promise.
 */
export type JsonSchemaValidator = ((data: unknown) => boolean | Promise<unknown>) & { errors?: JsonSchemaError[] | null }

export interface JsonSchemaOptions extends StandardSchemaExtras {
  /**
   * Validates each finished record against the whole JSON Schema. Without it,
   * only what translates into field rules is checked: required, enum, format,
   * min/max and pattern. `oneOf`, `if`/`then`, `dependentRequired` and the
   * like need a validator.
   */
  validate?: JsonSchemaValidator
  /** Dot paths to leave out, e.g. `['addresses']` for a list of objects. */
  exclude?: string[]
}

/**
 * Use a plain JSON Schema object (an OpenAPI request body, a `.schema.json`
 * file) as the importer's schema. Resolve `$ref`s that point to other
 * documents first; refs inside the schema (`#/$defs/…`) are followed.
 */
export function fromJsonSchema<T = Record<string, unknown>>(json: object, options: JsonSchemaOptions = {}): ImportSchema<T> {
  const root = json as JsonSchema
  if (typeof root !== 'object' || root === null || typeof root.properties !== 'object')
    throw new Error('[openimport] fromJsonSchema needs an object schema with `properties`')
  const { validate, exclude = [], fields: overrides = {}, ...extras } = options
  const skipped: string[] = []
  const derived = collectFields(root, { prefix: '', group: undefined, exclude: new Set(exclude), skipped })
  if (skipped.length) {
    const list = skipped.map((p) => `'${p}'`).join(', ')
    throw new Error(
      `[openimport] Lists of objects can't be mapped from a flat file: ${list}. Leave them out with { exclude: [${list}] }, or import them separately.`,
    )
  }
  const fields = derived.map((f) => normalizeField({ ...f, ...overrides[f.key], key: f.key }))
  assertValidKeys(fields)
  return {
    ...(typeof root.title === 'string' ? { name: root.title } : {}),
    ...(typeof root.$id === 'string' ? { id: root.$id } : {}),
    ...extras,
    fields,
    ...(validate ? { standard: standardFromValidator<T>(validate) } : {}),
  }
}

/** Wrap a compiled validator as a Standard Schema, so issues land on the right fields. */
function standardFromValidator<T>(validate: JsonSchemaValidator): StandardSchemaV1<unknown, T> {
  const toIssues = (errors: JsonSchemaError[]): StandardSchemaV1.Issue[] =>
    errors.map((e) => {
      const location = e.instancePath ?? e.instanceLocation?.replace(/^#/, '') ?? e.dataPath?.replace(/\./g, '/') ?? ''
      const path = location
        .split('/')
        .filter(Boolean)
        .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))
      // "required" points at the parent object; the missing property is in params.
      if (e.params?.missingProperty) path.push(e.params.missingProperty)
      return { message: e.message ?? 'is invalid', path }
    })
  return {
    '~standard': {
      version: 1,
      vendor: 'openimport-json-schema',
      validate: (value) => {
        const result = validate(value)
        if (result instanceof Promise)
          return result.then(
            () => ({ value: value as T }),
            (error: { errors?: JsonSchemaError[]; message?: string }) => ({
              issues: toIssues(error?.errors ?? [{ message: error?.message ?? String(error) }]),
            }),
          )
        return result ? { value: value as T } : { issues: toIssues(validate.errors ?? [{ message: 'is invalid' }]) }
      },
    },
  }
}

function resolveRef(node: JsonSchema, root: JsonSchema): JsonSchema {
  if (typeof node?.$ref === 'string' && node.$ref.startsWith('#/')) {
    const target = node.$ref
      .slice(2)
      .split('/')
      .reduce<JsonSchema | undefined>((acc, part) => acc?.[part], root)
    if (target) return { ...target, ...node, $ref: undefined }
  }
  return node
}

function unwrapNullable(node: JsonSchema): { node: JsonSchema; nullable: boolean } {
  const variants: JsonSchema[] | undefined = node.anyOf ?? node.oneOf
  if (variants) {
    const nonNull = variants.filter((v) => v.type !== 'null')
    if (nonNull.length === 1 && nonNull.length < variants.length) {
      return {
        node: { ...nonNull[0], title: node.title ?? nonNull[0]?.title, description: node.description ?? nonNull[0]?.description },
        nullable: true,
      }
    }
  }
  if (Array.isArray(node.type) && node.type.includes('null')) {
    const types = node.type.filter((t: string) => t !== 'null')
    return { node: { ...node, type: types.length === 1 ? types[0] : types }, nullable: true }
  }
  return { node, nullable: false }
}

/** Returns a field by key or throws. */
export function getField(schema: ImportSchema<unknown>, key: string): FieldDefinition {
  const f = schema.fields.find((x) => x.key === key)
  if (!f) throw new Error(`[openimport] Unknown field "${key}"`)
  return f
}
