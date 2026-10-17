import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createImporter, defineSchema, field, type ImportSession, memoryRecipeStore, type SessionState, sourceFromString } from '../src'
import { testFormats } from './helpers'

const schema = defineSchema({
  id: 'contacts',
  fields: {
    firstName: field.string({ required: true }),
    lastName: field.string(),
    email: field.email({ required: true, unique: true }),
    status: field.enum(['active', 'inactive']),
    signupDate: field.date({ label: 'Signup date' }),
  },
})

const CSV = [
  'Contacts export',
  '',
  'Vorname;Nachname;E-Mail;Status;Signup date',
  'Ada;Lovelace;ada@example.com;Active;15.03.2024',
  'Alan;Turing;alan@example.com;inaktiv;01.02.2024',
  ';Hopper;grace@example.com;active;2024-02-30',
  'Ada;Byron;ADA@example.com;active;',
  '',
].join('\n')

const until = (session: ImportSession<any>, predicate: (s: SessionState) => boolean) =>
  new Promise<SessionState>((resolve) => {
    if (predicate(session.getState())) return resolve(session.getState())
    const off = session.subscribe((s) => {
      if (predicate(s)) {
        off()
        resolve(s)
      }
    })
  })

function setup(config: Partial<Parameters<typeof createImporter>[0]> = {}) {
  const importer = createImporter({ schema, plugins: [testFormats], recipes: memoryRecipeStore(), ...config } as Parameters<
    typeof createImporter
  >[0])
  return { importer, session: importer.createSession() as ImportSession<any> }
}

describe('ImportSession', () => {
  it('runs the full flow: detect header → auto-map → validate → edit → submit', async () => {
    const { session } = setup()
    await session.loadFile(sourceFromString(CSV, 'contacts.csv'))

    // Title rows above the table → header step
    let state = session.getState()
    expect(state.step).toBe('header')
    expect(state.detectedHeaderRow).toBe(2)
    await session.confirmHeader()

    state = session.getState()
    expect(state.step).toBe('mapping')
    expect(state.rowCount).toBe(4)
    const label = (key: string) => state.sourceFields.find((f) => f.key === key)?.label
    expect(Object.fromEntries(Object.entries(state.mapping).map(([k, m]) => [k, label(m.sources[0] as string)]))).toEqual({
      firstName: 'Vorname',
      lastName: 'Nachname',
      email: 'E-Mail',
      status: 'Status',
      signupDate: 'Signup date',
    })
    // Detected day-first dates; suggested enum value map for "inaktiv"
    expect(state.mapping.signupDate?.options).toEqual({ dateOrder: 'DMY' })
    expect(state.mapping.status?.valueMap).toEqual({ inaktiv: 'inactive' })
    expect(session.previewField('signupDate')[0]?.output).toBe('2024-03-15')

    await session.confirmMapping()
    state = session.getState()
    expect(state.step).toBe('review')
    // First occurrence of a duplicate is kept (warning), later ones are errors — same rule as run().
    expect(state.stats).toMatchObject({ total: 4, valid: 2, withErrors: 2, withWarnings: 1 })
    expect(state.rows[0]?.issues[0]).toMatchObject({ code: 'duplicate', severity: 'warning', message: 'Also used in row 7' })
    expect(state.rows[3]?.issues[0]).toMatchObject({ code: 'duplicate', severity: 'error', message: 'Duplicate of row 4' })
    const codes = (i: number) => state.rows[i]?.issues.map((x) => `${x.field}:${x.code}`).sort()
    expect(codes(0)).toEqual(['email:duplicate'])
    expect(codes(2)).toEqual(['firstName:required', 'signupDate:invalid_date'])
    expect(codes(3)).toEqual(['email:duplicate'])
    expect(state.rows[2]?.sourceIndex).toBe(6)
    expect(session.canSubmit()).toBe(false)

    // Fix errors
    session.editCell(state.rows[2]!.id, 'firstName', 'Grace')
    session.editCell(state.rows[2]!.id, 'signupDate', '2024-02-29')
    session.editCell(state.rows[3]!.id, 'email', 'byron@example.com')
    state = session.getState()
    expect(state.stats.withErrors).toBe(0)
    expect(state.rows[0]?.issues).toEqual([])
    expect(state.rows[2]?.edited).toEqual(['firstName', 'signupDate'])

    const onSubmit = vi.fn()
    const result = await session.submit(onSubmit)
    expect(result).toEqual({ submitted: 4, skipped: 0, rejected: [] })
    expect(session.getState().step).toBe('complete')
    expect(onSubmit.mock.calls[0]?.[0].records[1]).toEqual({
      firstName: 'Alan',
      lastName: 'Turing',
      email: 'alan@example.com',
      status: 'inactive',
      signupDate: '2024-02-01',
    })
  })

  it('remembers mappings as recipes for the next import', async () => {
    const recipes = memoryRecipeStore()
    const { session } = setup({ recipes })
    await session.loadFile(sourceFromString('Spalte A,Spalte B\nAda,ada@x.io\n', 'a.csv'))
    expect(session.getState().step).toBe('mapping')
    session.assign('firstName', 'c0')
    session.assign('email', 'c1')
    await session.confirmMapping()

    const next = setup({ recipes }).session
    await next.loadFile(sourceFromString('Spalte B,Spalte A\nbob@x.io,Bob\n', 'b.csv'))
    const state = next.getState()
    expect(state.recipe).not.toBeNull()
    expect(state.mapping.firstName).toMatchObject({ sources: ['c1'], origin: 'recipe' })
    expect(state.mapping.email).toMatchObject({ sources: ['c0'], origin: 'recipe' })
  })

  it('supports combine and split transforms', async () => {
    const s = defineSchema({ fields: { fullName: field.string(), first: field.string(), last: field.string(), email: field.email() } })
    const importer = createImporter({ schema: s, plugins: [testFormats], recipes: false })
    const session = importer.createSession()
    await session.loadFile(sourceFromString('Given,Family,Name\nAda,Lovelace,Grace Brewster Hopper\n', 'x.csv'))
    session.setMapping('fullName', { sources: ['c0', 'c1'], transforms: [{ op: 'join', separator: ' ' }] })
    session.setMapping('first', { sources: ['c2'], transforms: [{ op: 'split', index: 0 }] })
    session.setMapping('last', { sources: ['c2'], transforms: [{ op: 'split', index: -1 }] })
    await session.confirmMapping()
    expect(await session.getRecords()).toEqual([{ fullName: 'Ada Lovelace', first: 'Grace', last: 'Hopper' }])
  })

  it('assign() keeps one-to-one semantics', async () => {
    const { session } = setup({ recipes: false })
    await session.loadFile(sourceFromString('Vorname,E-Mail\nAda,ada@x.io\n', 'a.csv'))
    expect(session.getState().mapping.firstName?.sources).toEqual(['c0'])
    session.assign('lastName', 'c0')
    expect(session.getState().mapping.firstName).toBeUndefined()
    expect(session.getState().mapping.lastName?.sources).toEqual(['c0'])
    expect(session.missingRequired()).toEqual(['firstName'])
  })

  it('handles records datasets (JSON) with nested paths', async () => {
    const s = defineSchema({ fields: { name: field.string(), 'address.city': field.string({ label: 'City' }) } })
    const importer = createImporter({ schema: s, plugins: [testFormats], recipes: false })
    const session = importer.createSession()
    await session.loadFile(sourceFromString(JSON.stringify([{ name: 'Ada', addr: { city: 'London' } }]), 'x.json'))
    const state = session.getState()
    expect(state.sourceFields.map((f) => f.key)).toEqual(['name', 'addr.city'])
    expect(state.mapping['address.city']?.sources).toEqual(['addr.city'])
    await session.confirmMapping()
    expect(await session.getRecords()).toEqual([{ name: 'Ada', address: { city: 'London' } }])
  })

  it('validates with a Standard Schema and outputs its parsed value', async () => {
    const zs = z.object({
      email: z.email(),
      age: z.number().int().min(18, 'Must be an adult'),
      plan: z.enum(['free', 'pro']).default('free'),
    })
    const importer = createImporter({ schema: zs, plugins: [testFormats], recipes: false })
    const session = importer.createSession()
    await session.loadFile(sourceFromString('email,age\na@x.io,30\nb@x.io,12\n', 'x.csv'))
    await session.confirmMapping()
    const { rows } = session.getState()
    expect(rows[1]?.issues).toEqual([{ field: 'age', code: 'schema', message: 'Must be an adult', severity: 'error' }])
    session.deleteInvalidRows()
    const records = await session.getRecords()
    expect(records).toEqual([{ email: 'a@x.io', age: 30, plan: 'free' }])
  })

  it('runs custom field, row and batch validators', async () => {
    const s = defineSchema({
      fields: {
        email: field.email({ validate: (v) => (String(v).endsWith('@spam.io') ? 'Blocked domain' : undefined) }),
        min: field.number(),
        max: field.number(),
      },
      validateRow: (row) => (Number(row.min) > Number(row.max) ? { field: 'max', code: 'range', message: 'max < min' } : undefined),
      validateBatch: async (rows) =>
        rows
          .filter((r) => r.values.email === 'taken@x.io')
          .map((r) => ({ rowId: r.id, field: 'email', code: 'exists', message: 'Already exists' })),
    })
    const importer = createImporter({ schema: s, plugins: [testFormats], recipes: false })
    const session = importer.createSession()
    await session.loadFile(sourceFromString('email,min,max\na@spam.io,1,2\ntaken@x.io,5,1\n', 'x.csv'))
    await session.confirmMapping()
    const { rows } = session.getState()
    expect(rows[0]?.issues.map((i) => i.message)).toEqual(['Blocked domain'])
    expect(rows[1]?.issues.map((i) => i.code).sort()).toEqual(['exists', 'range'])

    session.editCell(rows[1]!.id, 'email', 'free@x.io')
    await until(session, (st) => !st.rows[1]?.issues.some((i) => i.code === 'exists'))
    expect(session.getState().rows[1]?.issues.map((i) => i.code)).toEqual(['range'])
  })

  it('skips invalid rows when configured and reports rejections', async () => {
    const { session } = setup({ invalidRows: 'skip', recipes: false, batchSize: 1 })
    await session.loadFile(sourceFromString('Vorname,E-Mail\nAda,ada@x.io\n,bad\nAlan,alan@x.io\n', 'a.csv'))
    await session.confirmMapping()
    expect(session.canSubmit()).toBe(true)
    const batches: number[] = []
    const result = await session.submit(({ rows, index }) => {
      batches.push(index)
      return rows[0]?.values.firstName === 'Alan'
        ? { rejected: [{ rowId: rows[0].id, field: 'email', code: 'server', message: 'Server said no' }] }
        : undefined
    })
    expect(batches).toEqual([0, 1])
    expect(result).toMatchObject({ submitted: 1, skipped: 1 })
    session.reviewRejected()
    const state = session.getState()
    expect(state.step).toBe('review')
    expect(state.rows).toHaveLength(1)
    expect(state.rows[0]?.issues[0]?.message).toBe('Server said no')
  })

  it('reports unsupported files and size limits', async () => {
    const { session } = setup({ maxFileSize: 10 })
    await session.loadFile(sourceFromString('x', 'notes.pdf'))
    expect(session.getState().error?.code).toBe('unsupported_file')
    await session.loadFile(sourceFromString('a,b\n1,2\n3,4\n', 'big.csv'))
    expect(session.getState().error?.code).toBe('file_too_large')
  })

  it('navigates back through steps', async () => {
    const { session } = setup({ recipes: false })
    await session.loadFile(sourceFromString(CSV, 'contacts.csv'))
    await session.confirmHeader()
    expect(session.getState().step).toBe('mapping')
    session.back()
    expect(session.getState().step).toBe('header')
    session.setHeaderRow(0)
    expect(session.getState().sourceFields[0]?.label).toBe('Contacts export')
    session.back()
    expect(session.getState().step).toBe('upload')
    expect(session.getState().file).toBeNull()
  })

  it('emits lifecycle events to plugins', async () => {
    const onEvent = vi.fn()
    const { session } = setup({ plugins: [testFormats, { name: 'spy', onEvent }], recipes: false })
    await session.loadFile(sourceFromString('Vorname,E-Mail\nAda,ada@x.io\n', 'a.csv'))
    await session.confirmMapping()
    expect(onEvent.mock.calls.map((c) => c[0].type)).toEqual([
      'file:loaded',
      'dataset:selected',
      'rows:loaded',
      'mapping:suggested',
      'mapping:confirmed',
      'validation:completed',
    ])
  })
})

describe('importer.run (headless)', () => {
  it('streams validated records with auto-mapping', async () => {
    const { importer } = setup({ recipes: false })
    const rows = [
      'Vorname;E-Mail;Status',
      ...Array.from({ length: 25 }, (_, i) => `P${i};p${i % 20}@x.io;${i % 2 ? 'active' : 'nope'}`),
    ].join('\n')
    const chunks = []
    for await (const chunk of importer.run(sourceFromString(rows, 'big.csv'), { batchSize: 10 })) chunks.push(chunk)
    expect(chunks).toHaveLength(3)
    expect(chunks[0]?.mapping?.firstName?.sources).toEqual(['c0'])
    const records = chunks.flatMap((c) => c.records)
    const invalid = chunks.flatMap((c) => c.invalid)
    expect(records[0]).toEqual({ firstName: 'P1', email: 'p1@x.io', status: 'active' })
    expect(records.length + invalid.length).toBe(25)
    // later duplicates (p0..p4 again) are flagged
    expect(chunks.flatMap((c) => c.issues).filter((i) => i.code === 'duplicate')).toHaveLength(5)
  })

  it('accepts an explicit mapping by source labels', async () => {
    const { importer } = setup({ recipes: false })
    const out = []
    for await (const chunk of importer.run(sourceFromString('A,B\nada@x.io,Ada\n', 'x.csv'), {
      mapping: { email: { sources: ['A'] }, firstName: { sources: ['B'], transforms: [{ op: 'uppercase' }] } },
      autoMap: false,
    }))
      out.push(...chunk.records)
    expect(out).toEqual([{ email: 'ada@x.io', firstName: 'ADA' }])
  })
})
