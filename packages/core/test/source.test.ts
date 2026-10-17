import { describe, expect, it } from 'vitest'
import { detectHeaderRow, fieldsFromGrid, fieldsFromRecords, flattenRecord, inferType } from '../src'

describe('detectHeaderRow', () => {
  it('returns 0 for a plain table', () => {
    expect(
      detectHeaderRow([
        ['name', 'email'],
        ['Ada', 'ada@x.io'],
        ['Alan', 'alan@x.io'],
      ]),
    ).toBe(0)
  })

  it('skips title lines, blanks and notes above the table', () => {
    const grid = [
      ['Customer export', '', '', ''],
      ['Generated 2024-03-01', '', '', ''],
      ['', '', '', ''],
      ['Name', 'Email', 'Revenue', 'Since'],
      ['Ada', 'ada@x.io', '1200', '2020-01-01'],
      ['Alan', 'alan@x.io', '900', '2021-05-05'],
    ]
    expect(detectHeaderRow(grid)).toBe(3)
  })
})

describe('fieldsFromGrid', () => {
  it('labels empty and duplicate headers and drops empty trailing columns', () => {
    const fields = fieldsFromGrid(
      [
        ['Email', '', 'Email', ''],
        ['a@x.io', 'foo', 'b@x.io', ''],
      ],
      0,
    )
    expect(fields.map((f) => f.label)).toEqual(['Email', 'Column B', 'Email (2)'])
    expect(fields[0]?.inferredType).toBe('email')
  })
})

describe('records', () => {
  it('flattens nested objects to dot paths', () => {
    expect(flattenRecord({ a: { b: { c: 1 } }, tags: ['x'], d: null })).toEqual({ 'a.b.c': 1, tags: ['x'], d: null })
    const fields = fieldsFromRecords([{ id: 1 }, { id: 2, extra: 'x' }])
    expect(fields.map((f) => f.key)).toEqual(['id', 'extra'])
    expect(fields[1]?.emptyRatio).toBe(0.5)
  })
})

describe('inferType', () => {
  it.each([
    [['1', '2'], 'integer'],
    [['1.5', '2'], 'number'],
    [['2024-01-01', '01.02.2024'], 'date'],
    [['a@b.de'], 'email'],
    [['yes', 'no'], 'boolean'],
    [['hello', '2'], 'mixed'],
    [[], 'empty'],
  ])('%j → %s', (values, type) => {
    expect(inferType(values)).toBe(type)
  })
})
