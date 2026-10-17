import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createRecipe, fieldsFromGrid, indexedDbRecipeStore } from '../src'

describe('indexedDbRecipeStore', () => {
  it('saves, lists newest first, scopes by schema, trims and removes', async () => {
    const store = indexedDbRecipeStore(`test-${Math.random()}`, 2)
    const fields = fieldsFromGrid([['Vorname', 'Mail']], 0)
    const a = { ...createRecipe({ firstName: { sources: ['c0'] } }, fields, { schemaId: 'contacts' }), updatedAt: '2026-01-01T00:00:00Z' }
    const b = { ...createRecipe({ email: { sources: ['c1'] } }, fields, { schemaId: 'contacts' }), updatedAt: '2026-02-01T00:00:00Z' }
    const c = { ...createRecipe({ sku: { sources: ['c0'] } }, fields, { schemaId: 'products' }), updatedAt: '2026-03-01T00:00:00Z' }
    await store.save(a)
    await store.save(b)
    expect((await store.list('contacts')).map((r) => r.id)).toEqual([b.id, a.id])
    await store.save(c) // max 2 → the oldest (a) is dropped
    expect((await store.list(undefined)).map((r) => r.id)).toEqual([c.id, b.id])
    expect((await store.list('products')).map((r) => r.id)).toEqual([c.id])
    await store.remove?.(b.id)
    expect(await store.list('contacts')).toEqual([])
  })

  it('ignores invalid records instead of failing', async () => {
    const name = `test-${Math.random()}`
    const store = indexedDbRecipeStore(name)
    await store.save({ version: 1, id: 'ok', createdAt: 'x', updatedAt: 'x', sourceLabels: [], mapping: {} })
    await store.save({ version: 2, id: 'bad' } as never)
    expect((await store.list(undefined)).map((r) => r.id)).toEqual(['ok'])
  })
})
