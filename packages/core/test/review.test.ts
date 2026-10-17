/**
 * Regression tests for the external review (data integrity, shared execution
 * semantics, replay). Each test reproduces one reported problem.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createImporter, defineSchema, field, type ImportPlugin, type ImportSession, type MatchSuggestion, sourceFromString } from '../src'
import { testFormats } from './helpers'

const collect = async <T>(gen: AsyncGenerator<{ records: T[]; issues: { code: string }[] }>) => {
  const records: T[] = []
  const codes: string[] = []
  for await (const chunk of gen) {
    records.push(...chunk.records)
    codes.push(...chunk.issues.map((i) => i.code))
  }
  return { records, codes }
}

describe('1 · run() and the session enforce the same rules', () => {
  const schema = defineSchema({
    fields: { email: field.email({ required: true }) },
    validateBatch: async (rows) =>
      rows
        .filter((r) => r.values.email === 'taken@x.io')
        .map((r) => ({ rowId: r.id, field: 'email', code: 'exists', message: 'Already exists' })),
  })
  const csv = 'email\nfree@x.io\ntaken@x.io\n'

  it('applies validateBatch in run()', async () => {
    const importer = createImporter({ schema, plugins: [testFormats], recipes: false })
    const { records, codes } = await collect(importer.run(sourceFromString(csv, 'a.csv')))
    expect(records).toEqual([{ email: 'free@x.io' }])
    expect(codes).toContain('exists')
  })

  it('enforces maxFileSize and maxRows in run()', async () => {
    const big = createImporter({ schema, plugins: [testFormats], recipes: false, maxFileSize: 5 })
    await expect(collect(big.run(sourceFromString(csv, 'a.csv')))).rejects.toMatchObject({ code: 'file_too_large' })
    const many = createImporter({ schema, plugins: [testFormats], recipes: false, maxRows: 1 })
    await expect(collect(many.run(sourceFromString(csv, 'a.csv')))).rejects.toMatchObject({ code: 'too_many_rows' })
  })
})

describe('2 · edits keep validation guarantees', () => {
  const schema = defineSchema({ fields: { name: field.string(), email: field.email({ unique: true }) } })

  it('editing another field keeps the row’s duplicate issue', async () => {
    const session = createImporter({ schema, plugins: [testFormats], recipes: false }).createSession()
    await session.loadFile(sourceFromString('name,email\nAda,a@x.io\nAlan,a@x.io\n', 'a.csv'))
    await session.confirmMapping()
    const [first, second] = session.getState().rows
    expect(first?.issues.map((i) => i.code)).toEqual(['duplicate'])
    session.editCell(second!.id, 'name', 'Alan T.')
    const rows = session.getState().rows
    expect(rows[1]?.issues.map((i) => i.code)).toEqual(['duplicate'])
    expect(rows[0]?.issues.map((i) => i.code)).toEqual(['duplicate'])
    expect(session.canSubmit()).toBe(false)
  })

  it('cannot submit while async schema checks are pending', async () => {
    let gate: Promise<void> = Promise.resolve()
    const slow = z.object({ email: z.email() }).superRefine(async (v, ctx) => {
      await gate
      if (v.email === 'bad@x.io') ctx.addIssue({ code: 'custom', path: ['email'], message: 'Server says no' })
    })
    const session = createImporter({ schema: slow, plugins: [testFormats], recipes: false }).createSession()
    await session.loadFile(sourceFromString('email\nok@x.io\n', 'a.csv'))
    await session.confirmMapping()
    expect(session.canSubmit()).toBe(true)

    let release!: () => void
    gate = new Promise<void>((r) => (release = r))
    session.editCell(session.getState().rows[0]!.id, 'email', 'bad@x.io')
    // The async check for the edit hasn't finished → no submitting yet.
    expect(session.canSubmit()).toBe(false)
    release()
    await vi.waitFor(() => expect(session.getState().busy).toBe(false))
    expect(session.getState().rows[0]?.issues.map((i) => i.message)).toEqual(['Server says no'])
    expect(session.canSubmit()).toBe(false)
  })
})

describe('3 · submission is resumable', () => {
  it('a retry after a failed batch does not resend accepted batches', async () => {
    const schema = defineSchema({ fields: { name: field.string() } })
    const session = createImporter({ schema, plugins: [testFormats], recipes: false, batchSize: 1 }).createSession()
    await session.loadFile(sourceFromString('name\nA\nB\nC\n', 'a.csv'))
    await session.confirmMapping()
    const sent: string[] = []
    let fail = true
    const handler = ({ records, index }: { records: { name?: string | undefined }[]; index: number }) => {
      if (index === 1 && fail) throw new Error('network down')
      sent.push(...records.map((r) => r.name ?? ''))
    }
    expect(await session.submit(handler)).toBeUndefined()
    const state = session.getState()
    expect(state.step).toBe('review')
    expect(state.error?.message).toMatch(/1 of 3 rows were imported/)
    fail = false
    const result = await session.submit(handler)
    expect(sent).toEqual(['A', 'B', 'C'])
    expect(result).toMatchObject({ submitted: 3 })
  })

  it('gives every batch a stable id for idempotent writes', async () => {
    const schema = defineSchema({ fields: { name: field.string() } })
    const session = createImporter({ schema, plugins: [testFormats], recipes: false, batchSize: 2 }).createSession()
    await session.loadFile(sourceFromString('name\nA\nB\nC\n', 'a.csv'))
    await session.confirmMapping()
    const ids: string[] = []
    await session.submit(({ batchId }) => void ids.push(batchId))
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })
})

describe('4 · target paths are safe', () => {
  afterEach(() => {
    delete (Object.prototype as Record<string, unknown>).reviewProbe
  })

  it('rejects prototype-polluting and conflicting keys', () => {
    expect(() => defineSchema({ fields: [{ key: '__proto__.reviewProbe', label: 'x', type: 'string' }] })).toThrow(/unsafe/i)
    expect(() => defineSchema({ fields: [{ key: 'constructor.prototype.x', label: 'x', type: 'string' }] })).toThrow(/unsafe/i)
    expect(() =>
      defineSchema({
        fields: [
          { key: 'address', label: 'a', type: 'string' },
          { key: 'address.city', label: 'b', type: 'string' },
        ],
      }),
    ).toThrow(/conflict/i)
    expect(({} as Record<string, unknown>).reviewProbe).toBeUndefined()
  })

  it('does not let source keys reach the prototype', async () => {
    const schema = defineSchema({ fields: { name: field.string() } })
    const importer = createImporter({ schema, plugins: [testFormats], recipes: false })
    const session = importer.createSession()
    await session.loadFile(sourceFromString('[{"name":"Ada","__proto__":{"reviewProbe":1}}]', 'a.json'))
    await session.confirmMapping()
    expect(({} as Record<string, unknown>).reviewProbe).toBeUndefined()
    expect(await session.getRecords()).toEqual([{ name: 'Ada' }])
  })
})

describe('5 · auto-map applies suggestions the same way every time', () => {
  it('keeps matcher transforms when auto-mapping again', async () => {
    const splitter: ImportPlugin = {
      name: 'splitter',
      matchers: [
        {
          id: 'splitter',
          priority: 10,
          match: ({ sourceFields, mapping }): MatchSuggestion[] => {
            const full = sourceFields.find((s) => s.label === 'Full name')
            if (!full) return []
            return [
              { target: 'first', sources: [full.key], confidence: 0.9, transforms: [{ op: 'split', index: 0 }] },
              { target: 'last', sources: [full.key], confidence: 0.9, transforms: [{ op: 'split', index: -1 }] },
            ].filter((s) => !mapping[s.target])
          },
        },
      ],
    }
    const schema = defineSchema({ fields: { first: field.string(), last: field.string() } })
    const session = createImporter({ schema, plugins: [testFormats, splitter], recipes: false }).createSession()
    await session.loadFile(sourceFromString('Full name\nAda Lovelace\n', 'a.csv'))
    expect(session.previewField('last')[0]?.output).toBe('Lovelace')
    session.clearMapping()
    await session.autoMap()
    expect(session.previewField('first')[0]?.output).toBe('Ada')
    expect(session.previewField('last')[0]?.output).toBe('Lovelace')
  })
})

describe('6 · source semantics are preserved', () => {
  it('keeps null for nullable fields and [] for lists before Standard Schema validation', async () => {
    const schema = z.object({ name: z.string(), plan: z.enum(['free', 'pro']).nullable(), tags: z.array(z.string()) })
    const session = createImporter({ schema, plugins: [testFormats], recipes: false }).createSession()
    await session.loadFile(sourceFromString(JSON.stringify([{ name: 'Ada', plan: null, tags: [] }]), 'a.json'))
    await session.confirmMapping()
    expect(session.getState().rows[0]?.issues).toEqual([])
    expect(await session.getRecords()).toEqual([{ name: 'Ada', plan: null, tags: [] }])
  })

  it('maps explicitly named JSON properties that first appear after the sample', async () => {
    // Streams records in chunks of 500, like the real JSON Lines plugin.
    const chunked: ImportPlugin = {
      name: 'chunked-json',
      formats: [
        {
          id: 'chunked',
          label: 'JSON',
          extensions: ['json'],
          inspect: async () => ({ datasets: [{ id: '$', label: 'Records', layout: 'records' }] }),
          async *read(file) {
            const all = JSON.parse(await file.blob.text()) as Record<string, unknown>[]
            for (let i = 0; i < all.length; i += 500) yield all.slice(i, i + 500) as never
          },
        },
      ],
    }
    const schema = defineSchema({ fields: { name: field.string(), vip: field.boolean() } })
    const importer = createImporter({ schema, plugins: [chunked], recipes: false })
    const records = Array.from({ length: 3000 }, (_, i) => (i === 2500 ? { name: `P${i}`, vip: true } : { name: `P${i}` }))
    const json = JSON.stringify(records)
    const { records: out } = await collect(
      importer.run(sourceFromString(json, 'a.json'), { mapping: { name: { sources: ['name'] }, vip: { sources: ['vip'] } } }),
    )
    expect(out[2500]).toEqual({ name: 'P2500', vip: true })

    // …and the interactive session discovers late properties too
    const session = importer.createSession() as ImportSession<any>
    await session.loadFile(sourceFromString(json, 'a.json'))
    expect(session.getState().sourceFields.map((f) => f.key)).toContain('vip')
  })

  it('replays a recipe’s header row in run()', async () => {
    const schema = defineSchema({ fields: { name: field.string() } })
    const importer = createImporter({ schema, plugins: [testFormats], recipes: false })
    const now = new Date().toISOString()
    // The user picked row 2 ("Name") as the header; detection alone would not.
    const recipe = {
      version: 1 as const,
      id: 'r',
      createdAt: now,
      updatedAt: now,
      sourceLabels: ['Name'],
      headerRow: 1,
      mapping: { name: { sources: ['Name'] } },
    }
    const { records } = await collect(importer.run(sourceFromString('Report\nName\nAda\nAlan\n', 'a.csv'), { recipe }))
    expect(records).toEqual([{ name: 'Ada' }, { name: 'Alan' }])
  })
})

describe('7 · plugin and recipe contracts', () => {
  const schema = defineSchema({ fields: { name: field.string() } })
  const fmt = (id: string) => ({ id, label: id, extensions: [id], inspect: async () => ({ datasets: [] }), async *read() {} })

  it('rejects colliding format ids, matcher ids and transform ops', () => {
    const make = (plugins: ImportPlugin[]) => () => createImporter({ schema, plugins, recipes: false })
    expect(
      make([
        { name: 'a', formats: [fmt('csv')] },
        { name: 'b', formats: [fmt('csv')] },
      ]),
    ).toThrow(/"a" and "b" both register the format "csv"/)
    expect(
      make([
        { name: 'a', matchers: [{ id: 'm', match: () => [] }] },
        { name: 'b', matchers: [{ id: 'm', match: () => [] }] },
      ]),
    ).toThrow(/matcher "m"/)
    const t = { op: 'iban', label: 'IBAN', arity: 'one' as const, apply: (v: unknown) => v }
    expect(
      make([
        { name: 'a', transforms: [t] },
        { name: 'b', transforms: [t] },
      ]),
    ).toThrow(/transform "iban"/)
    expect(make([{ name: 'a', transforms: [{ ...t, op: 'trim' }] }])).toThrow(/built-in transform "trim"/)
    expect(make([{ name: 'a', transforms: [{ ...t, op: 'trim', override: true }] }])).not.toThrow()
    // replacing the built-in fuzzy matcher is allowed by design
    expect(make([{ name: 'a', matchers: [{ id: 'fuzzy', match: () => [] }] }])).not.toThrow()
  })

  it('validates recipes before replaying them', async () => {
    const importer = createImporter({ schema, plugins: [testFormats], recipes: false })
    const now = new Date().toISOString()
    const base = { version: 1, id: 'r', createdAt: now, updatedAt: now, sourceLabels: ['Name'] }
    const run = (recipe: unknown) => collect(importer.run(sourceFromString('Name\nAda\n', 'a.csv'), { recipe: recipe as never }))
    await expect(run({ ...base, mapping: { name: { sources: 'Name' } } })).rejects.toMatchObject({ code: 'invalid_recipe' })
    await expect(run({ ...base, mapping: { name: { sources: ['Name'], transforms: [{ op: 'eval' }] } } })).rejects.toThrow(
      /unknown transform "eval"/,
    )
    await expect(run({ ...base, mapping: { name: { sources: ['Name'], transforms: [{ op: 'split', index: 'last' }] } } })).rejects.toThrow(
      /"index" must be a number/,
    )
    await expect(run({ ...base, mapping: { '__proto__.x': { sources: ['Name'] } } })).rejects.toThrow(/unsafe target/)
    await expect(run({ ...base, mapping: { name: { sources: ['Name'], transforms: [{ op: 'extract', pattern: '(' }] } } })).rejects.toThrow(
      /regular expression/,
    )
    expect((await run({ ...base, mapping: { name: { sources: ['Name'], transforms: [{ op: 'uppercase' }] } } })).records).toEqual([
      { name: 'ADA' },
    ])
  })

  it('flags bad transform params per row instead of misbehaving', async () => {
    const session = createImporter({ schema, plugins: [testFormats], recipes: false }).createSession()
    await session.loadFile(sourceFromString('Name\nAda Lovelace\n', 'a.csv'))
    session.setMapping('name', { sources: ['c0'], transforms: [{ op: 'split', separator: 3 }] })
    await session.confirmMapping()
    expect(session.getState().rows[0]?.issues[0]).toMatchObject({ code: 'transform_failed' })
  })

  it('records the dataset and format in exported recipes', async () => {
    const session = createImporter({ schema, plugins: [testFormats], recipes: false }).createSession()
    await session.loadFile(sourceFromString('Name\nAda\n', 'a.csv'))
    expect(session.exportRecipe()).toMatchObject({ dataset: 'default', format: 'test-csv', headerRow: 0 })
  })

  it('counts maxRows the same way in the session and in run()', async () => {
    const importer = createImporter({ schema, plugins: [testFormats], recipes: false, maxRows: 2 })
    const ok = 'Name\nA\nB\n'
    const tooMany = 'Name\nA\nB\nC\n'
    const session = importer.createSession()
    await session.loadFile(sourceFromString(ok, 'a.csv'))
    expect(session.getState().error).toBeNull()
    await session.loadFile(sourceFromString(tooMany, 'a.csv'))
    expect(session.getState().error?.code).toBe('too_many_rows')
    await expect(collect(importer.run(sourceFromString(ok, 'a.csv')))).resolves.toBeDefined()
    await expect(collect(importer.run(sourceFromString(tooMany, 'a.csv')))).rejects.toMatchObject({ code: 'too_many_rows' })
  })
})
