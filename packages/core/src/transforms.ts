import type { FieldDefinition, FieldMapping, RawValue, TransformContext, TransformDefinition, TransformStep } from './types'
import { isEmpty, stringify } from './utils'

const str = (v: unknown) => stringify(v)

/** Transforms shipped with the core. Plugins can add more via `transforms`. */
export const builtinTransforms: TransformDefinition[] = [
  {
    op: 'join',
    label: 'Combine',
    description: 'Join several columns with a separator, skipping empty values.',
    arity: 'many',
    params: [{ name: 'separator', label: 'Separator', type: 'string', default: ' ' }],
    apply: (values, p) =>
      (values as unknown[])
        .map(str)
        .map((s) => s.trim())
        .filter(Boolean)
        .join(typeof p.separator === 'string' ? p.separator : ' '),
  },
  {
    op: 'template',
    label: 'Template',
    description: 'Build a value from a template. Use {1}, {2}, … for the selected columns.',
    arity: 'many',
    params: [{ name: 'template', label: 'Template', type: 'string', default: '{1} {2}' }],
    apply: (values, p) => {
      const list = values as unknown[]
      const template = typeof p.template === 'string' ? p.template : ''
      return template
        .replace(/\{(\d+)\}/g, (_, n: string) => str(list[Number(n) - 1]).trim())
        .replace(/\s{2,}/g, ' ')
        .trim()
    },
  },
  {
    op: 'coalesce',
    label: 'First non-empty',
    description: 'Use the first column that has a value.',
    arity: 'many',
    apply: (values) => (values as unknown[]).find((v) => !isEmpty(v)) ?? null,
  },
  {
    op: 'split',
    label: 'Split',
    description: 'Split by a separator and take one part (negative index counts from the end).',
    arity: 'one',
    params: [
      { name: 'separator', label: 'Separator', type: 'string', default: ' ' },
      { name: 'index', label: 'Part', type: 'number', default: 0 },
      { name: 'rest', label: 'Include the rest', type: 'boolean', default: false },
    ],
    apply: (value, p) => {
      const sep = typeof p.separator === 'string' && p.separator !== '' ? p.separator : ' '
      const parts = str(value)
        .split(sep === ' ' ? /\s+/ : sep)
        .map((s) => s.trim())
        .filter(Boolean)
      if (p.index === undefined || p.index === null || p.index === '') return parts
      const n = Number(p.index)
      const i = n < 0 ? parts.length + n : n
      if (i < 0 || i >= parts.length) return ''
      return p.rest ? parts.slice(i).join(sep === ' ' ? ' ' : sep) : parts[i]
    },
  },
  { op: 'trim', label: 'Trim whitespace', arity: 'one', apply: (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : v) },
  { op: 'lowercase', label: 'lowercase', arity: 'one', apply: (v) => str(v).toLowerCase() },
  { op: 'uppercase', label: 'UPPERCASE', arity: 'one', apply: (v) => str(v).toUpperCase() },
  {
    op: 'titlecase',
    label: 'Title Case',
    arity: 'one',
    apply: (v) =>
      str(v)
        .toLowerCase()
        .replace(/(^|[\s\-'’(])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase()),
  },
  {
    op: 'replace',
    label: 'Find & replace',
    arity: 'one',
    params: [
      { name: 'find', label: 'Find', type: 'string' },
      { name: 'replace', label: 'Replace with', type: 'string', default: '' },
      { name: 'regex', label: 'Regular expression', type: 'boolean', default: false },
    ],
    apply: (v, p) => {
      const find = typeof p.find === 'string' ? p.find : ''
      if (!find) return v
      const replacement = typeof p.replace === 'string' ? p.replace : ''
      return p.regex ? str(v).replace(new RegExp(find, 'g'), replacement) : str(v).split(find).join(replacement)
    },
  },
  {
    op: 'extract',
    label: 'Extract (regex)',
    description: 'Keep the first match of a regular expression (or its first capture group).',
    arity: 'one',
    params: [{ name: 'pattern', label: 'Pattern', type: 'string' }],
    apply: (v, p) => {
      if (typeof p.pattern !== 'string' || !p.pattern) return v
      const m = str(v).match(new RegExp(p.pattern))
      return m ? (m[1] ?? m[0]) : ''
    },
  },
  {
    op: 'prefix',
    label: 'Add prefix / suffix',
    arity: 'one',
    params: [
      { name: 'prefix', label: 'Prefix', type: 'string', default: '' },
      { name: 'suffix', label: 'Suffix', type: 'string', default: '' },
    ],
    apply: (v, p) => (isEmpty(v) ? v : `${p.prefix ?? ''}${str(v)}${p.suffix ?? ''}`),
  },
]

export type TransformRegistry = ReadonlyMap<string, TransformDefinition>

export function createTransformRegistry(extra: TransformDefinition[] = []): TransformRegistry {
  const map = new Map<string, TransformDefinition>()
  for (const t of [...builtinTransforms, ...extra]) map.set(t.op, t)
  return map
}

/**
 * Produce the (pre-coercion) value of a target field for a single source row.
 * Throws if a transform is unknown so broken recipes fail loudly.
 */
export function applyFieldMapping(
  mapping: FieldMapping,
  values: Record<string, RawValue>,
  field: FieldDefinition,
  registry: TransformRegistry,
  sourceLabels: string[] = mapping.sources,
): unknown {
  const inputs = mapping.sources.map((k) => values[k] ?? null)
  let tuple = inputs.length > 1
  let current: unknown = tuple ? inputs : inputs[0]
  const ctx: TransformContext = { field, sources: sourceLabels }

  for (const step of mapping.transforms ?? []) {
    const def = registry.get(step.op)
    if (!def) throw new Error(`[openimport] Unknown transform "${step.op}"`)
    const problem = checkTransformStep(def, step)
    if (problem) throw new Error(`[openimport] ${problem}`)
    const params = withDefaults(def, step)
    if (def.arity === 'many') {
      current = def.apply(tuple ? current : [current], params, ctx)
      tuple = false
    } else if (tuple) {
      current = (current as unknown[]).map((v) => def.apply(v, params, ctx))
    } else {
      current = def.apply(current, params, ctx)
    }
  }
  if (tuple)
    current = (current as unknown[])
      .map(str)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(' ')
  if (isEmpty(current) && mapping.fallback !== undefined) return mapping.fallback
  return current
}

/**
 * Check a step's params against the transform's declared params. Returns a
 * problem description, or undefined when the step is valid. Empty values mean
 * "use the default".
 */
export function checkTransformStep(def: TransformDefinition, step: TransformStep): string | undefined {
  const declared = new Map((def.params ?? []).map((p) => [p.name, p]))
  for (const [name, value] of Object.entries(step)) {
    if (name === 'op' || value === undefined || value === null || value === '') continue
    const param = declared.get(name)
    if (!param) return `Transform "${def.op}" has no parameter "${name}"`
    const ok =
      param.type === 'number'
        ? typeof value === 'number' && Number.isFinite(value)
        : param.type === 'boolean'
          ? typeof value === 'boolean'
          : param.type === 'select'
            ? typeof value === 'string' && (param.options ?? []).some((o) => o.value === value)
            : typeof value === 'string'
    if (!ok)
      return `Transform "${def.op}": "${name}" must be ${param.type === 'select' ? `one of ${(param.options ?? []).map((o) => o.value).join(', ')}` : `a ${param.type}`}`
  }
  // Regular expressions must at least compile.
  for (const key of ['pattern', 'find']) {
    if (typeof step[key] === 'string' && (key === 'pattern' || step.regex === true)) {
      try {
        new RegExp(step[key] as string)
      } catch {
        return `Transform "${def.op}": "${key}" is not a valid regular expression`
      }
    }
  }
  return undefined
}

function withDefaults(def: TransformDefinition, step: TransformStep): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const p of def.params ?? []) if (p.default !== undefined) params[p.name] = p.default
  for (const [k, v] of Object.entries(step)) if (k !== 'op' && v !== '' && v !== null && v !== undefined) params[k] = v
  return params
}
