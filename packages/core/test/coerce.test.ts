import { describe, expect, it } from 'vitest'
import { coerceValue, detectColumnOptions, type FieldDefinition, parseDate, parseNumber } from '../src'

const f = (type: FieldDefinition['type'], extra: Partial<FieldDefinition> = {}): FieldDefinition => ({
  key: 'x',
  label: 'X',
  type,
  ...extra,
})

describe('parseNumber', () => {
  it.each([
    ['42', 42],
    ['-3.5', -3.5],
    ['1,234.56', 1234.56],
    ['1.234,56', 1234.56],
    ['1 234,5', 1234.5],
    ['€ 12,50', 12.5],
    ['$1,000', 1000],
    ['(42)', -42],
    ['12%', 0.12],
    ["1'000'000", 1000000],
    ['1e3', 1000],
    ['abc', null],
    ['', null],
  ])('%s → %s', (input, expected) => {
    expect(parseNumber(input)).toBe(expected)
  })

  it('uses the column decimal hint for ambiguous values', () => {
    expect(parseNumber('1,234')).toBe(1234)
    expect(parseNumber('1,234', ',')).toBe(1.234)
    expect(parseNumber('1.234', ',')).toBe(1234)
    expect(parseNumber('1.5', ',')).toBe(1.5)
  })
})

describe('parseDate', () => {
  const iso = (v: unknown, order?: 'DMY' | 'MDY') => parseDate(v, order)?.toISOString().slice(0, 10)
  it.each([
    ['2024-03-15', '2024-03-15'],
    ['15.03.2024', '2024-03-15'],
    ['15/03/2024', '2024-03-15'],
    ['03/15/2024', '2024-03-15'],
    ['5.1.24', '2024-01-05'],
    ['12 Mar 2024', '2024-03-12'],
    ['March 12, 2024', '2024-03-12'],
    ['12. März 2024', '2024-03-12'],
    ['45366', '2024-03-15'],
  ])('%s → %s', (input, expected) => {
    expect(iso(input)).toBe(expected)
  })

  it('respects the column date order', () => {
    expect(iso('03/04/2024', 'MDY')).toBe('2024-03-04')
    expect(iso('03/04/2024', 'DMY')).toBe('2024-04-03')
  })

  it('rejects impossible dates', () => {
    expect(parseDate('31.02.2024')).toBeNull()
    expect(parseDate('hello')).toBeNull()
  })

  it('reads Excel serials and Date objects', () => {
    expect(iso(45366)).toBe('2024-03-15')
    expect(iso(new Date('2020-01-02T00:00:00Z'))).toBe('2020-01-02')
  })
})

describe('coerceValue', () => {
  it('coerces booleans in several languages', () => {
    for (const v of ['yes', 'Ja', 'TRUE', '1', 'x']) expect(coerceValue(v, f('boolean'))).toEqual({ ok: true, value: true })
    for (const v of ['no', 'Nein', 'false', '0']) expect(coerceValue(v, f('boolean'))).toEqual({ ok: true, value: false })
    expect(coerceValue('maybe', f('boolean')).ok).toBe(false)
  })

  it('normalises emails and urls', () => {
    expect(coerceValue(' Jane@Example.COM ', f('email'))).toEqual({ ok: true, value: 'jane@example.com' })
    expect(coerceValue('mailto:a@b.de', f('email'))).toEqual({ ok: true, value: 'a@b.de' })
    expect(coerceValue('jane@', f('email')).ok).toBe(false)
    expect(coerceValue('www.example.com', f('url'))).toEqual({ ok: true, value: 'https://www.example.com/' })
    expect(coerceValue('javascript:alert(1)', f('url')).ok).toBe(false)
  })

  it('matches enum options by value, label and alias, then value maps', () => {
    const field = f('enum', {
      options: [
        { value: 'DE', label: 'Germany', aliases: ['Deutschland'] },
        { value: 'AT', label: 'Austria' },
      ],
    })
    expect(coerceValue('de', field)).toEqual({ ok: true, value: 'DE' })
    expect(coerceValue('Deutschland', field)).toEqual({ ok: true, value: 'DE' })
    expect(coerceValue('austria', field)).toEqual({ ok: true, value: 'AT' })
    expect(coerceValue('Österreich', field).ok).toBe(false)
    expect(coerceValue('Österreich', field, {}, { Österreich: 'AT' })).toEqual({ ok: true, value: 'AT' })
  })

  it('splits multiple values and coerces each', () => {
    expect(coerceValue('1; 2;3', f('integer', { multiple: true }))).toEqual({ ok: true, value: [1, 2, 3] })
    expect(coerceValue(['a', 'b'], f('string', { multiple: true }))).toEqual({ ok: true, value: ['a', 'b'] })
    expect(coerceValue('a|b', f('string', { multiple: { separator: '|' } }))).toEqual({ ok: true, value: ['a', 'b'] })
  })

  it('returns the default for empty values', () => {
    expect(coerceValue('', f('string', { default: 'n/a' }))).toEqual({ ok: true, value: 'n/a' })
    expect(coerceValue(null, f('number'))).toEqual({ ok: true, value: undefined })
  })

  it('lets custom parse override coercion', () => {
    const field = f('string', { parse: (v) => String(v).replace(/\D/g, '') })
    expect(coerceValue('+49 (171) 123', field)).toEqual({ ok: true, value: '49171123' })
  })
})

describe('detectColumnOptions', () => {
  it('detects day-first dates and comma decimals', () => {
    expect(detectColumnOptions(['01.02.2024', '13.02.2024'], f('date'))).toEqual({ dateOrder: 'DMY' })
    expect(detectColumnOptions(['02/13/2024', '01/01/2024'], f('date'))).toEqual({ dateOrder: 'MDY' })
    expect(detectColumnOptions(['1.234,50', '12,5'], f('number'))).toEqual({ decimal: ',' })
    expect(detectColumnOptions(['1,234.50', '12.5'], f('number'))).toEqual({ decimal: '.' })
  })
})
