import { describe, expect, it } from 'vitest'
import { applyFieldMapping, createTransformRegistry, type FieldDefinition } from '../src'

const registry = createTransformRegistry()
const field: FieldDefinition = { key: 'x', label: 'X', type: 'string' }
const row = { first: 'Ada', last: 'Lovelace', full: 'Ada  King Lovelace', street: 'Main St', no: '42', empty: '' }

describe('transforms', () => {
  it('passes a single source through', () => {
    expect(applyFieldMapping({ sources: ['first'] }, row, field, registry)).toBe('Ada')
  })

  it('joins several sources by default', () => {
    expect(applyFieldMapping({ sources: ['first', 'empty', 'last'] }, row, field, registry)).toBe('Ada Lovelace')
    expect(applyFieldMapping({ sources: ['street', 'no'], transforms: [{ op: 'join', separator: ', ' }] }, row, field, registry)).toBe(
      'Main St, 42',
    )
  })

  it('renders templates', () => {
    expect(
      applyFieldMapping({ sources: ['last', 'first'], transforms: [{ op: 'template', template: '{1}, {2}' }] }, row, field, registry),
    ).toBe('Lovelace, Ada')
  })

  it('splits and picks parts', () => {
    const split = (index: number, rest = false) =>
      applyFieldMapping({ sources: ['full'], transforms: [{ op: 'split', index, rest }] }, row, field, registry)
    expect(split(0)).toBe('Ada')
    expect(split(-1)).toBe('Lovelace')
    expect(split(1, true)).toBe('King Lovelace')
    expect(split(5)).toBe('')
  })

  it('applies one-arity transforms element-wise before combining', () => {
    expect(
      applyFieldMapping(
        { sources: ['first', 'last'], transforms: [{ op: 'uppercase' }, { op: 'join', separator: '-' }] },
        row,
        field,
        registry,
      ),
    ).toBe('ADA-LOVELACE')
  })

  it('supports case, replace, extract, prefix and coalesce', () => {
    const apply = (sources: string[], transforms: { op: string; [k: string]: unknown }[]) =>
      applyFieldMapping({ sources, transforms }, row, field, registry)
    expect(apply(['full'], [{ op: 'trim' }, { op: 'titlecase' }])).toBe('Ada King Lovelace')
    expect(apply(['street'], [{ op: 'replace', find: 'St', replace: 'Street' }])).toBe('Main Street')
    expect(apply(['street'], [{ op: 'replace', find: '\\s+', replace: '_', regex: true }])).toBe('Main_St')
    expect(apply(['street'], [{ op: 'extract', pattern: '(\\w+) St' }])).toBe('Main')
    expect(apply(['no'], [{ op: 'prefix', prefix: '#' }])).toBe('#42')
    expect(apply(['empty', 'first'], [{ op: 'coalesce' }])).toBe('Ada')
  })

  it('uses the fallback when empty', () => {
    expect(applyFieldMapping({ sources: ['empty'], fallback: 'n/a' }, row, field, registry)).toBe('n/a')
  })

  it('throws on unknown transforms', () => {
    expect(() => applyFieldMapping({ sources: ['first'], transforms: [{ op: 'nope' }] }, row, field, registry)).toThrow(/Unknown transform/)
  })
})
