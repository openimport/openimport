import type { ColumnOptions, FieldDefinition, Issue, RawValue } from './types'
import { isEmpty, stringify } from './utils'

export type CoerceResult = { ok: true; value: unknown } | { ok: false; issue: Issue }

const fail = (field: FieldDefinition, code: string, message: string): CoerceResult => ({
  ok: false,
  issue: { field: field.key, code, message, severity: 'error' },
})

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/
const TRUE = new Set(['true', 'yes', 'y', '1', 'x', '✓', '✔', 'on', 'ja', 'j', 'wahr', 'oui', 'si', 'sí'])
const FALSE = new Set(['false', 'no', 'n', '0', '', 'off', 'nein', 'falsch', 'non', '-'])

/**
 * Convert a mapped value into the field's type. Strings are trimmed; empty
 * values become `undefined` (required-ness is checked by the validator).
 */
export function coerceValue(
  raw: unknown,
  field: FieldDefinition,
  options: ColumnOptions = {},
  valueMap?: Record<string, string>,
): CoerceResult {
  if (field.parse) {
    const parsed = field.parse(raw as RawValue, { field, options })
    if (parsed !== undefined) return { ok: true, value: parsed }
  }
  if (isEmpty(raw)) {
    // Keep the source's meaning: an empty list stays a list, a nullable field gets null.
    if (field.default !== undefined) return { ok: true, value: field.default }
    if (field.multiple) return { ok: true, value: [] }
    if (field.nullable) return { ok: true, value: null }
    return { ok: true, value: undefined }
  }

  if (field.multiple) {
    const separator = typeof field.multiple === 'object' ? field.multiple.separator : undefined
    const list = Array.isArray(raw) ? raw : splitList(stringify(raw), separator)
    const values: unknown[] = []
    for (const item of list) {
      if (isEmpty(item)) continue
      const r = coerceSingle(item, field, options, valueMap)
      if (!r.ok) return r
      values.push(r.value)
    }
    return { ok: true, value: values.length ? values : (field.default ?? []) }
  }
  if (Array.isArray(raw)) {
    // A single-valued field fed by an array (e.g. JSON) → join for strings, take the only element otherwise.
    if (raw.length === 1) return coerceSingle(raw[0], field, options, valueMap)
    if (field.type === 'string') return { ok: true, value: raw.map(stringify).join(', ') }
    return fail(field, 'too_many_values', 'Expected a single value')
  }
  return coerceSingle(raw, field, options, valueMap)
}

function splitList(s: string, separator?: string): string[] {
  if (separator) return s.split(separator).map((x) => x.trim())
  const sep = s.includes(';') ? ';' : s.includes('|') ? '|' : ','
  return s.split(sep).map((x) => x.trim())
}

function coerceSingle(raw: unknown, field: FieldDefinition, options: ColumnOptions, valueMap?: Record<string, string>): CoerceResult {
  let value = raw
  if (valueMap) {
    const key = stringify(value).trim()
    if (Object.hasOwn(valueMap, key)) value = valueMap[key]
  }
  switch (field.type) {
    case 'string': {
      if (value instanceof Date) return { ok: true, value: toIsoDate(value, true) }
      return { ok: true, value: typeof value === 'object' && value !== null ? JSON.stringify(value) : stringify(value).trim() }
    }
    case 'email': {
      const s = stringify(value)
        .trim()
        .replace(/^mailto:/i, '')
      return EMAIL.test(s) ? { ok: true, value: s.toLowerCase() } : fail(field, 'invalid_email', 'Not a valid email address')
    }
    case 'url': {
      let s = stringify(value).trim()
      if (/^www\./i.test(s)) s = `https://${s}`
      try {
        const u = new URL(s)
        if (!/^https?:$/.test(u.protocol)) throw new Error('protocol')
        return { ok: true, value: u.toString() }
      } catch {
        return fail(field, 'invalid_url', 'Not a valid URL')
      }
    }
    case 'number':
    case 'integer': {
      const n = typeof value === 'number' ? value : parseNumber(stringify(value), options.decimal)
      if (n === null || !Number.isFinite(n)) return fail(field, 'invalid_number', 'Not a valid number')
      if (field.type === 'integer' && !Number.isInteger(n)) return fail(field, 'invalid_integer', 'Must be a whole number')
      return { ok: true, value: n }
    }
    case 'boolean': {
      if (typeof value === 'boolean') return { ok: true, value }
      if (typeof value === 'number')
        return value === 1 || value === 0 ? { ok: true, value: value === 1 } : fail(field, 'invalid_boolean', 'Expected yes/no')
      const s = stringify(value).trim().toLowerCase()
      if (TRUE.has(s)) return { ok: true, value: true }
      if (FALSE.has(s)) return { ok: true, value: false }
      return fail(field, 'invalid_boolean', 'Expected yes/no')
    }
    case 'date':
    case 'datetime': {
      const d = parseDate(value, options.dateOrder)
      if (!d) return fail(field, 'invalid_date', 'Not a valid date')
      return { ok: true, value: toIsoDate(d, field.type === 'datetime') }
    }
    case 'enum': {
      const match = matchOption(value, field)
      return match !== undefined
        ? { ok: true, value: match }
        : fail(field, 'invalid_option', `"${stringify(value)}" is not an allowed value`)
    }
    default:
      return { ok: true, value }
  }
}

/** Resolve a value against an enum field's options (value, label, aliases — case-insensitive). */
export function matchOption(value: unknown, field: FieldDefinition): string | undefined {
  const s = stringify(value).trim()
  const options = field.options ?? []
  const exact = options.find((o) => o.value === s)
  if (exact) return exact.value
  const lower = s.toLowerCase()
  for (const o of options) {
    if (o.value.toLowerCase() === lower || o.label?.toLowerCase() === lower || o.aliases?.some((a) => a.toLowerCase() === lower))
      return o.value
  }
  return undefined
}

// ─────────────────────────────────────────────────────────────────────────────
// Numbers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses `1,234.56`, `1.234,56`, `1 234,56`, `€ 12,50`, `(42)`, `12%` (→ 0.12)…
 * `decimal` resolves the ambiguous `1,234` / `1.234` case.
 */
export function parseNumber(input: string, decimal?: '.' | ','): number | null {
  let s = input.trim()
  if (!s) return null
  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }
  const percent = s.endsWith('%')
  s = s.replace(/[%\s'’  ]|[^\d.,+\-eE]/g, '')
  if (s.startsWith('-')) {
    negative = !negative
    s = s.slice(1)
  } else if (s.startsWith('+')) s = s.slice(1)
  if (!/^[\d.,]+([eE][-+]?\d+)?$/.test(s)) return null

  const lastDot = s.lastIndexOf('.')
  const lastComma = s.lastIndexOf(',')
  let dec: '.' | ',' | null
  if (lastDot >= 0 && lastComma >= 0) dec = lastDot > lastComma ? '.' : ','
  else if (lastComma >= 0) {
    const groups = s.split(',')
    // "1,234" or "1,234,567" are thousands-grouped unless the column says otherwise.
    const looksGrouped = groups.length > 1 && groups.slice(1).every((g) => g.length === 3)
    dec = decimal === ',' ? ',' : looksGrouped ? null : groups.length === 2 ? ',' : null
  } else if (lastDot >= 0) {
    const groups = s.split('.')
    const looksGrouped = groups.length > 2 || (groups.length === 2 && groups[1]?.length === 3 && decimal === ',')
    dec = looksGrouped ? null : '.'
  } else dec = null

  const thousands = dec === '.' ? ',' : dec === ',' ? '.' : null
  let normalized = s
  if (thousands) normalized = normalized.split(thousands).join('')
  if (dec === ',') normalized = normalized.replace(',', '.')
  if (!dec) normalized = normalized.replace(/[.,]/g, '')
  const n = Number(normalized)
  if (Number.isNaN(n)) return null
  const signed = negative ? -n : n
  return percent ? signed / 100 : signed
}

// ─────────────────────────────────────────────────────────────────────────────
// Dates
// ─────────────────────────────────────────────────────────────────────────────

const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/
const PARTS = /^(\d{1,4})[./\-\s](\d{1,2})[./\-\s](\d{1,4})(?:[T ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i
const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  mär: 3,
  apr: 4,
  may: 5,
  mai: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  okt: 10,
  nov: 11,
  dec: 12,
  dez: 12,
}

/** Excel stores dates as days since 1899-12-30. */
function fromExcelSerial(n: number): Date | null {
  if (n < 1 || n > 2958465) return null
  const ms = Math.round((n - 25569) * 86400 * 1000)
  return new Date(ms)
}

export function parseDate(value: unknown, order?: 'DMY' | 'MDY' | 'YMD'): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'number') return fromExcelSerial(value)
  const s = stringify(value).trim()
  if (!s) return null
  if (/^\d{5}(\.\d+)?$/.test(s)) return fromExcelSerial(Number(s))

  let m = ISO.exec(s)
  if (m) {
    const [, y, mo, d, h, mi, sec, frac, tz] = m
    if (tz) {
      const date = new Date(s.replace(' ', 'T'))
      return Number.isNaN(date.getTime()) ? null : date
    }
    return makeDate(+y!, +mo!, +d!, +(h ?? 0), +(mi ?? 0), +(sec ?? 0), frac ? Number(`0.${frac}`) * 1000 : 0)
  }
  m = PARTS.exec(s)
  if (m) {
    const [, a, b, c, h, mi, sec, ampm] = m
    let hour = +(h ?? 0)
    if (ampm) hour = (hour % 12) + (ampm.toLowerCase() === 'pm' ? 12 : 0)
    const [y, mo, d] = resolveOrder(a!, b!, c!, order)
    return makeDate(y, mo, d, hour, +(mi ?? 0), +(sec ?? 0), 0)
  }
  // "12 Mar 2024", "March 12, 2024", "12. März 2024"
  const words = s.toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean)
  if (words.length === 3) {
    const mi = words.findIndex((w) => MONTHS[w.slice(0, 3)] !== undefined)
    if (mi >= 0) {
      const month = MONTHS[(words[mi] as string).slice(0, 3)] as number
      const nums = words.filter((_, i) => i !== mi).map(Number)
      if (nums.every(Number.isFinite)) {
        const [p, q] = nums as [number, number]
        const year = p > 31 ? p : q
        const day = p > 31 ? q : p
        return makeDate(normalizeYear(year), month, day, 0, 0, 0, 0)
      }
    }
  }
  return null
}

function resolveOrder(a: string, b: string, c: string, order?: 'DMY' | 'MDY' | 'YMD'): [number, number, number] {
  if (a.length === 4 || order === 'YMD') return [normalizeYear(+a), +b, +c]
  const x = +a
  const y = +b
  const year = normalizeYear(+c)
  if (order === 'MDY') return [year, x, y]
  if (order === 'DMY') return [year, y, x]
  // Unambiguous cases first, otherwise default to day-first (most of the world).
  if (x > 12) return [year, y, x]
  if (y > 12) return [year, x, y]
  return [year, y, x]
}

function normalizeYear(y: number): number {
  if (y >= 100) return y
  return y + (y < 70 ? 2000 : 1900)
}

function makeDate(y: number, mo: number, d: number, h: number, mi: number, s: number, ms: number): Date | null {
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s, ms))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null
  return date
}

function toIsoDate(d: Date, withTime: boolean): string {
  return withTime ? d.toISOString() : d.toISOString().slice(0, 10)
}

// ─────────────────────────────────────────────────────────────────────────────
// Column option detection
// ─────────────────────────────────────────────────────────────────────────────

/** Detect date order and decimal separator from a column's values. */
export function detectColumnOptions(values: unknown[], field: FieldDefinition): ColumnOptions {
  const options: ColumnOptions = {}
  const strings = values.filter((v) => typeof v === 'string' && v.trim()).map((v) => (v as string).trim())
  if (field.type === 'date' || field.type === 'datetime') {
    let dmy = 0
    let mdy = 0
    for (const s of strings) {
      const m = PARTS.exec(s)
      if (!m || m[1]!.length === 4) continue
      if (+m[1]! > 12) dmy++
      if (+m[2]! > 12) mdy++
      if (s.includes('.')) dmy += 0.1 // dotted dates are almost always day-first
    }
    if (dmy || mdy) options.dateOrder = mdy > dmy ? 'MDY' : 'DMY'
  }
  if (field.type === 'number' || field.type === 'integer') {
    let comma = 0
    let dot = 0
    for (const s of strings) {
      if (/\d,\d{1,2}$|\d,\d{4,}$/.test(s) || /\d\.\d{3},\d/.test(s)) comma++
      if (/\d\.\d{1,2}$|\d\.\d{4,}$/.test(s) || /\d,\d{3}\.\d/.test(s)) dot++
    }
    if (comma || dot) options.decimal = comma > dot ? ',' : '.'
  }
  return options
}
