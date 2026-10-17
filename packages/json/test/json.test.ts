import { createImporter, defineSchema, type FormatAdapter, field, type SourceFile, sourceFromString, toSourceFile } from '@openimport/core'
import { describe, expect, it } from 'vitest'
import { discoverCollections, jsonFormat, jsonFormats, jsonlFormat } from '../src'

const signal = new AbortController().signal

async function readDataset(format: FormatAdapter, file: SourceFile, id?: string) {
  const { datasets } = await format.inspect(file, { signal })
  const dataset = id ? datasets.find((d) => d.id === id)! : datasets[0]!
  const rows: Record<string, unknown>[] = []
  const sizes: number[] = []
  for await (const chunk of format.read(file, { dataset, signal })) {
    sizes.push(chunk.length)
    rows.push(...(chunk as Record<string, unknown>[]))
  }
  return { rows, sizes, datasets }
}

const nested = {
  meta: { exportedAt: '2024-01-01', tags: ['a', 'b'] },
  data: {
    customers: [
      { id: 1, name: 'Ann', address: { city: 'Köln' }, orders: [{ sku: 'A' }, { sku: 'B' }] },
      { id: 2, name: 'Bob', address: { city: 'Bonn' }, orders: [{ sku: 'C' }] },
      { id: 3, name: 'Cy', orders: [] },
    ],
    regions: [{ code: 'NRW' }],
  },
  numbers: [1, 2, 3],
}

describe('discoverCollections', () => {
  it('finds arrays of objects at any depth, including inside records', () => {
    expect(discoverCollections(nested).map((c) => [c.path, c.count])).toEqual([
      ['$.data.customers[*]', 3],
      ['$.data.regions[*]', 1],
      ['$.data.customers[*].orders[*]', 3],
    ])
  })

  it('puts a top-level array first', () => {
    expect(discoverCollections([{ a: 1, list: [{ x: 1 }, { x: 2 }, { x: 3 }] }]).map((c) => c.path)).toEqual(['$[*]', '$[*].list[*]'])
  })

  it('quotes keys that are not identifiers', () => {
    expect(discoverCollections({ 'my items': [{ a: 1 }] })[0]!.path).toBe('$["my items"][*]')
  })

  it('ignores arrays of primitives', () => {
    expect(discoverCollections({ tags: ['a', 'b'], n: [1, 2] })).toEqual([])
  })
})

describe('json format', () => {
  it('lists datasets with labels, paths and counts', async () => {
    const { datasets } = await jsonFormat().inspect(sourceFromString(JSON.stringify(nested), 'export.json'), { signal })
    expect(datasets[0]).toEqual({
      id: '$.data.customers[*]',
      label: 'data › customers',
      path: '$.data.customers[*]',
      layout: 'records',
      rowCount: 3,
    })
    expect(datasets).toHaveLength(3)
  })

  it('reads records of a dataset', async () => {
    const { rows } = await readDataset(jsonFormat(), sourceFromString(JSON.stringify(nested), 'export.json'))
    expect(rows.map((r) => r.name)).toEqual(['Ann', 'Bob', 'Cy'])
    expect(rows[0]!.address).toEqual({ city: 'Köln' })
  })

  it('fans out over nested record arrays', async () => {
    const { rows } = await readDataset(
      jsonFormat(),
      sourceFromString(JSON.stringify(nested), 'export.json'),
      '$.data.customers[*].orders[*]',
    )
    expect(rows).toEqual([{ sku: 'A' }, { sku: 'B' }, { sku: 'C' }])
  })

  it('reads a top-level array in chunks', async () => {
    const data = Array.from({ length: 25 }, (_, i) => ({ i }))
    const { rows, sizes } = await readDataset(jsonFormat({ chunkSize: 10 }), sourceFromString(JSON.stringify(data), 'a.json'))
    expect(rows).toHaveLength(25)
    expect(sizes).toEqual([10, 10, 5])
  })

  it('treats an object of objects as a keyed collection', async () => {
    const doc = { u1: { name: 'Ann' }, u2: { name: 'Bob' } }
    const { rows, datasets } = await readDataset(jsonFormat(), sourceFromString(JSON.stringify(doc), 'users.json'))
    expect(datasets[0]!.id).toBe('$.*')
    expect(rows).toEqual([
      { _key: 'u1', name: 'Ann' },
      { _key: 'u2', name: 'Bob' },
    ])
  })

  it('treats a single object as one record', async () => {
    const { rows } = await readDataset(jsonFormat(), sourceFromString('{"name":"Ann","age":3}', 'one.json'))
    expect(rows).toEqual([{ name: 'Ann', age: 3 }])
  })

  it('strips a BOM', async () => {
    const { rows } = await readDataset(jsonFormat(), sourceFromString('﻿[{"a":1}]', 'bom.json'))
    expect(rows).toEqual([{ a: 1 }])
  })

  it('reports invalid JSON as a parse error', async () => {
    await expect(jsonFormat().inspect(sourceFromString('{"a":', 'bad.json'), { signal })).rejects.toMatchObject({ code: 'parse_failed' })
  })
})

describe('jsonl format', () => {
  const text = '{"id":1,"name":"Ann"}\r\n\n{"id":2,"name":"Bob"}\n42\n{"id":3,"user":{"email":"c@d.de"}}'

  it('inspects one dataset with an exact count for small files', async () => {
    const { datasets } = await jsonlFormat().inspect(sourceFromString(text, 'x.jsonl'), { signal })
    expect(datasets).toEqual([{ id: 'jsonl', label: 'x.jsonl', layout: 'records', rowCount: 4 }])
  })

  it('streams records, skipping blank lines and wrapping primitives', async () => {
    const { rows, sizes } = await readDataset(jsonlFormat({ chunkSize: 2 }), sourceFromString(text, 'x.jsonl'))
    expect(rows).toEqual([{ id: 1, name: 'Ann' }, { id: 2, name: 'Bob' }, { value: 42 }, { id: 3, user: { email: 'c@d.de' } }])
    expect(sizes).toEqual([2, 2])
  })

  it('handles multi-byte characters split across stream chunks', async () => {
    const bytes = new TextEncoder().encode('{"name":"Jürgen"}\n{"name":"Zoë"}\n')
    const blob = {
      size: bytes.length,
      type: '',
      slice: (a?: number, b?: number) => new Blob([bytes.slice(a, b)]),
      stream: () =>
        new ReadableStream<Uint8Array>({
          start(c) {
            for (let i = 0; i < bytes.length; i += 3) c.enqueue(bytes.slice(i, i + 3))
            c.close()
          },
        }),
    } as unknown as Blob
    const { rows } = await readDataset(jsonlFormat(), toSourceFile(blob, 'u.ndjson'))
    expect(rows).toEqual([{ name: 'Jürgen' }, { name: 'Zoë' }])
  })

  it('reports the line number of invalid JSON', async () => {
    const file = sourceFromString('{"a":1}\n{"a":\n', 'bad.jsonl')
    const format = jsonlFormat()
    const run = async () => {
      for await (const _ of format.read(file, { dataset: { id: 'jsonl', label: '', layout: 'records' }, signal })) {
        // drain
      }
    }
    await expect(run()).rejects.toMatchObject({ code: 'parse_failed', message: expect.stringContaining('line 2') })
  })
})

describe('json with an import session', () => {
  it('lets the user pick a dataset and maps nested paths', async () => {
    const importer = createImporter({
      schema: defineSchema({ fields: { name: field.string({ required: true }), city: field.string() } }),
      plugins: [jsonFormats()],
      recipes: false,
    })
    const session = importer.createSession()
    await session.loadFile(sourceFromString(JSON.stringify(nested), 'export.json'))
    expect(session.getState().step).toBe('dataset')
    await session.selectDataset('$.data.customers[*]')
    const state = session.getState()
    expect(state.step).toBe('mapping')
    expect(state.sourceFields.map((f) => f.key)).toContain('address.city')
    session.setMapping('city', { sources: ['address.city'] })
    await session.confirmMapping({ saveRecipe: false })
    expect(await session.getRecords()).toEqual([{ name: 'Ann', city: 'Köln' }, { name: 'Bob', city: 'Bonn' }, { name: 'Cy' }])
  })
})
