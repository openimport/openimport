import { describe, expect, it } from 'vitest'
import { createImporter, defineSchema, field, sourceFromString } from '../src'
import { testFormats } from './helpers'

const schema = defineSchema({ fields: { name: field.string({ required: true }), email: field.email() } })
const CSV = 'name,email\nAda,ada@x.io\n,bad\nAlan,alan@x.io\nGrace,nope\nLinus,linus@x.io\n'

async function reviewed() {
  const session = createImporter({ schema, plugins: [testFormats], recipes: false }).createSession()
  await session.loadFile(sourceFromString(CSV, 'a.csv'))
  await session.confirmMapping()
  return session
}

describe('row queries', () => {
  it('counts, pages and lists ids per filter', async () => {
    const s = await reviewed()
    expect(s.countRows()).toBe(5)
    expect(s.countRows({ filter: 'errors' })).toBe(2)
    expect(s.countRows({ filter: 'valid' })).toBe(3)
    expect(s.countRows({ field: 'email' })).toBe(2)
    expect(s.countRows({ search: 'ALAN' })).toBe(1)
    expect(s.getRows({ filter: 'valid' }, 1, 3).map((r) => r.values.name)).toEqual(['Alan', 'Linus'])
    expect(s.getRows({}, 0, 2).map((r) => r.values.name)).toEqual(['Ada', undefined])
    expect(s.rowIds({ filter: 'errors' })).toHaveLength(2)
  })

  it('finds the next error cell and wraps around', async () => {
    const s = await reviewed()
    const fields = ['name', 'email']
    const first = s.findIssue({}, null, fields)
    expect(first).toEqual({ row: 1, col: 0 })
    const second = s.findIssue({}, first, fields)
    expect(second).toEqual({ row: 1, col: 1 })
    const third = s.findIssue({}, second, fields)
    expect(third).toEqual({ row: 3, col: 1 })
    expect(s.findIssue({}, third, fields)).toEqual(first)
    expect(s.findIssue({ filter: 'valid' }, null, fields)).toBeNull()
  })

  it('bumps rowsVersion on every change to the rows', async () => {
    const s = await reviewed()
    const v = s.getState().rowsVersion
    s.editCell(s.getRows({ filter: 'errors' }, 0, 1)[0]!.id, 'name', 'Fixed')
    expect(s.getState().rowsVersion).toBe(v + 1)
    s.deleteInvalidRows()
    expect(s.getState().rowsVersion).toBe(v + 2)
    expect(s.countRows({ filter: 'errors' })).toBe(0)
  })

  it('exposes canGoBack in state', async () => {
    const s = await reviewed()
    expect(s.getState().canGoBack).toBe(true)
    s.reset()
    expect(s.getState().canGoBack).toBe(false)
  })
})
