import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  createImporter,
  defineSchema,
  field,
  type ImporterConfig,
  type ImportRecord,
  memoryRecipeStore,
  parseRecipe,
  type SubmitBatch,
  sourceFromString,
} from '../src'
import { testFormats } from './helpers'

const schema = defineSchema({
  id: 'contacts',
  fields: {
    name: field.string({ required: true }),
    email: field.email(),
  },
})

const CSV = [
  'Name,E-Mail,Loyalty points,Tier,Kunde seit',
  'Ada,ada@x.io,120,gold,15.03.2021',
  'Alan,alan@x.io,abc,silver,02.11.2023',
  'Grace,grace@x.io,75,gold,30.06.2019',
  'Linus,linus@x.io,10,bronze,01.01.2020',
  'Ken,ken@x.io,5,silver,05.05.2022',
  'Barbara,barbara@x.io,0,gold,12.12.2018',
].join('\n')

type Config = Partial<Omit<ImporterConfig<{ name: string; email?: string }>, 'schema'>>

async function open(config: Config = { customFields: true }, csv = CSV) {
  const importer = createImporter({ schema, plugins: [testFormats], recipes: false, ...config })
  const session = importer.createSession()
  await session.loadFile(sourceFromString(csv, 'contacts.csv'))
  const key = (label: string) => session.getState().sourceFields.find((f) => f.label === label)?.key as string
  return { importer, session, key }
}

describe('custom fields', () => {
  it('are off unless enabled', async () => {
    const { session, key } = await open({})
    expect(() => session.addCustomField({ label: 'Points', type: 'number', source: key('Loyalty points') })).toThrow(/not enabled/)
    expect(session.suggestCustomField(key('Loyalty points'))).toBeNull()
  })

  it('become part of the schema, mapped to their column', async () => {
    const { session, key } = await open()
    const added = session.addCustomField({ label: 'Loyalty points', type: 'number', source: key('Loyalty points') })
    expect(added).toEqual({ key: 'loyalty_points', label: 'Loyalty points', type: 'number' })
    expect(session.schema.fields.at(-1)).toMatchObject({ key: 'loyalty_points', custom: true })
    expect(session.getState().mapping.loyalty_points?.sources).toEqual([key('Loyalty points')])
    expect(session.previewField('loyalty_points').map((p) => p.output)).toEqual([120, undefined, 75, 10, 5])
  })

  it('are validated by type and delivered in $custom, apart from the typed record', async () => {
    const { session, key } = await open()
    session.addCustomField({ label: 'Points', type: 'number', source: key('Loyalty points') })
    session.addCustomField({ label: 'Since', type: 'date', source: key('Kunde seit') })
    await session.confirmMapping()
    const alan = session.getState().rows[1]
    expect(alan?.issues.map((i) => i.field)).toEqual(['points'])

    session.editCell(alan?.id as string, 'points', '42')
    expect(session.getState().stats.withErrors).toBe(0)

    const batches: SubmitBatch<{ name: string; email?: string }>[] = []
    await session.submit((b) => void batches.push(b))
    const records = batches.flatMap((b) => b.records)
    expect(records[0]).toEqual({ name: 'Ada', email: 'ada@x.io', $custom: { points: 120, since: '2021-03-15' } })
    expect(records[1]?.$custom?.points).toBe(42)
    expect(batches[0]?.customFields.map((f) => f.key)).toEqual(['points', 'since'])
  })

  it('stay out of a strict Standard Schema', async () => {
    const strict = z.strictObject({ name: z.string(), email: z.string().optional() })
    const importer = createImporter({ schema: strict, plugins: [testFormats], recipes: false, customFields: true })
    const session = importer.createSession()
    await session.loadFile(sourceFromString(CSV, 'contacts.csv'))
    const tier = session.getState().sourceFields.find((f) => f.label === 'Tier')?.key as string
    session.addCustomField({ label: 'Tier', type: 'string', source: tier })
    await session.confirmMapping()
    expect(session.getState().stats.withErrors).toBe(0)
    const records = (await session.getRecords()) as ImportRecord<{ name: string }>[]
    expect(records[0]).toEqual({ name: 'Ada', email: 'ada@x.io', $custom: { tier: 'gold' } })
  })

  it('get unique keys and refuse names that exist', async () => {
    const { session, key } = await open()
    expect(() => session.addCustomField({ label: 'email', type: 'string' })).toThrow(/already exists/)
    expect(() => session.addCustomField({ label: '  ', type: 'string' })).toThrow(/name/)
    expect(session.addCustomField({ label: 'Kunde seit (Datum)', type: 'string' }).key).toBe('kunde_seit_datum')
    expect(session.addCustomField({ label: 'Name!', type: 'string', source: key('Tier') }).key).toBe('name_2')
    expect(session.addCustomField({ label: '1st contact', type: 'string' }).key).toBe('f_1st_contact')
    expect(session.addCustomField({ label: 'Straße', type: 'string' }).key).toBe('strasse')
  })

  it('respect allowed types, the maximum, groups and the check hook', async () => {
    const { session, key } = await open({
      customFields: {
        types: ['string', 'number'],
        max: 2,
        groups: ['Contact'],
        check: (f) => (f.label === 'Secret' ? 'Not allowed here' : undefined),
      },
    })
    expect(() => session.addCustomField({ label: 'Since', type: 'date' })).toThrow(/not an allowed type/)
    expect(() => session.addCustomField({ label: 'X', type: 'string', group: 'Order' })).toThrow(/Unknown group/)
    expect(() => session.addCustomField({ label: 'Secret', type: 'string' })).toThrow('Not allowed here')
    session.addCustomField({ label: 'A', type: 'string', group: 'Contact', source: key('Tier') })
    session.addCustomField({ label: 'B', type: 'number' })
    expect(() => session.addCustomField({ label: 'C', type: 'string' })).toThrow(/At most 2/)
    expect(session.schema.fields.find((f) => f.key === 'a')?.group).toBe('Contact')
  })

  it('require a group only when every schema field has one', async () => {
    const grouped = defineSchema({
      fields: { 'contact.name': field.string({ group: 'Contact' }), 'contract.number': field.string({ group: 'Contract' }) },
    })
    const mixed = defineSchema({ fields: { name: field.string(), street: field.string({ group: 'Address' }) } })
    const strict = createImporter({ schema: grouped, plugins: [testFormats], recipes: false, customFields: true })
    expect(strict.customFields).toMatchObject({ groups: ['Contact', 'Contract'], requireGroup: true })
    const loose = createImporter({ schema: mixed, plugins: [testFormats], recipes: false, customFields: true })
    expect(loose.customFields).toMatchObject({ groups: ['Address'], requireGroup: false })

    const session = strict.createSession()
    await session.loadFile(sourceFromString('Name,Number,Tier\nAda,1,gold\n', 'a.csv'))
    expect(() => session.addCustomField({ label: 'Tier', type: 'string' })).toThrow(/Choose where/)
    expect(session.addCustomField({ label: 'Tier', type: 'string', group: 'Contract' }).group).toBe('Contract')
  })

  it('suggest a type from the values', async () => {
    const { session, key } = await open()
    expect(session.suggestCustomField(key('Loyalty points'))).toMatchObject({ label: 'Loyalty points', type: 'string' }) // "abc" makes it mixed
    expect(session.suggestCustomField(key('Kunde seit'))).toMatchObject({ type: 'date' })
    const tier = session.suggestCustomField(key('Tier'))
    expect(tier?.type).toBe('enum')
    expect(tier?.options?.map((o) => o.value).sort()).toEqual(['bronze', 'gold', 'silver'])
    expect(session.suggestCustomField(key('E-Mail'))).toMatchObject({ type: 'email' })
  })

  it('can be removed, with their mapping', async () => {
    const { session, key } = await open()
    session.addCustomField({ label: 'Tier', type: 'string', source: key('Tier') })
    session.removeCustomField('tier')
    expect(session.getState().customFields).toEqual([])
    expect(session.getState().mapping.tier).toBeUndefined()
    expect(session.schema.fields.some((f) => f.custom)).toBe(false)
  })

  it('are saved with the recipe and restored for the next file', async () => {
    const recipes = memoryRecipeStore()
    const first = await open({ customFields: true, recipes })
    const tier = first.session.suggestCustomField(first.key('Tier'))
    first.session.addCustomField(tier as NonNullable<typeof tier>)
    first.session.addCustomField({ label: 'Unused', type: 'string' }) // not mapped: not saved
    await first.session.confirmMapping()

    const recipe = (await recipes.list('contacts'))[0]
    expect(recipe?.customFields?.map((f) => f.key)).toEqual(['tier'])

    const second = await open({ customFields: true, recipes })
    expect(second.session.getState().customFields).toEqual(recipe?.customFields)
    expect(second.session.getState().mapping.tier?.sources).toEqual([second.key('Tier')])
  })

  it('from untrusted recipes are checked: malformed entries are rejected, disallowed ones dropped', async () => {
    const base = { version: 1 as const, id: 'r', createdAt: '', updatedAt: '', sourceLabels: [], mapping: {} }
    expect(() => parseRecipe({ ...base, customFields: [{ key: '__proto__', label: 'x', type: 'string' }] })).toThrow(/customFields\[0\]/)
    expect(() => parseRecipe({ ...base, customFields: 'nope' })).toThrow(/must be a list/)

    const recipes = memoryRecipeStore([
      {
        ...base,
        sourceLabels: ['Name', 'E-Mail', 'Loyalty points', 'Tier', 'Kunde seit'],
        mapping: { name: { sources: ['Name'] }, points: { sources: ['Loyalty points'] }, tier: { sources: ['Tier'] } },
        customFields: [
          { key: 'points', label: 'Points', type: 'number' },
          { key: 'tier', label: 'Tier', type: 'string' },
        ],
      },
    ])
    const { session } = await open({ customFields: { types: ['string'] }, recipes })
    expect(session.getState().customFields.map((f) => f.key)).toEqual(['tier'])
    expect(session.getState().mapping.points).toBeUndefined()
  })

  it('replay in run() with a recipe', async () => {
    const recipes = memoryRecipeStore()
    const first = await open({ customFields: true, recipes })
    first.session.addCustomField({ label: 'Points', type: 'number', source: first.key('Loyalty points') })
    const recipe = first.session.exportRecipe()

    const importer = createImporter({ schema, plugins: [testFormats], recipes: false, customFields: true })
    const chunks = []
    for await (const chunk of importer.run(sourceFromString(CSV, 'contacts.csv'), { recipe })) chunks.push(chunk)
    expect(chunks[0]?.customFields?.map((f) => f.key)).toEqual(['points'])
    const records = chunks.flatMap((c) => c.records)
    expect(records.map((r) => r.$custom?.points)).toEqual([120, 75, 10, 5, 0])
    expect(chunks.flatMap((c) => c.invalid).map((r) => r.values.name)).toEqual(['Alan'])

    // Without the option, run() ignores the recipe's custom fields.
    const off = createImporter({ schema, plugins: [testFormats], recipes: false })
    const plain = []
    for await (const chunk of off.run(sourceFromString(CSV, 'contacts.csv'), { recipe })) plain.push(...chunk.records)
    expect(plain.every((r) => r.$custom === undefined)).toBe(true)
  })
})
