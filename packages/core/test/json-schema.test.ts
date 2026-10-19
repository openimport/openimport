import Ajv2020 from 'ajv/dist/2020'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createImporter, defineSchema, fromJsonSchema, type JsonSchemaValidator, type ReviewRow, sourceFromString } from '../src'
import { testFormats } from './helpers'

/** Like an OpenAPI request body for creating a contact. */
const contact = {
  $id: 'contact',
  title: 'Contact',
  type: 'object',
  required: ['firstName', 'email'],
  properties: {
    firstName: { type: 'string', title: 'First name', minLength: 1, 'x-aliases': ['Vorname'] },
    email: { type: 'string', format: 'email' },
    status: { type: 'string', enum: ['lead', 'customer'] },
    signupDate: { type: 'string', format: 'date' },
    company: { type: 'string' },
    vatId: { type: 'string', title: 'VAT ID' },
    score: { type: 'integer', exclusiveMinimum: 0, exclusiveMaximum: 100 },
    ratio: { type: 'number', exclusiveMinimum: 0 },
    address: {
      type: 'object',
      properties: { street: { type: 'string' }, zip: { type: 'string', pattern: '^\\d{5}$' } },
    },
    tags: { type: 'array', items: { type: 'string' } },
    phones: { type: 'array', items: { type: 'object', properties: { number: { type: 'string' } } } },
  },
  dependentRequired: { company: ['vatId'] },
  additionalProperties: false,
}

// Draft 2020-12 (draft-07's default Ajv ignores dependentRequired). strict: false accepts vendor
// keywords like x-aliases; formats are checked by OpenImport's own types. A fresh instance per
// schema, because Ajv caches schemas by $id.
const compile = (schema: object, async = false) =>
  new Ajv2020({ allErrors: true, strict: false, validateFormats: false }).compile(async ? { ...schema, $async: true } : schema)

async function load(schema: ReturnType<typeof fromJsonSchema>, csv: string, extra: { customFields?: boolean } = {}) {
  const session = createImporter({ schema, plugins: [testFormats], recipes: false, ...extra }).createSession()
  await session.loadFile(sourceFromString(csv, 'contacts.csv'))
  return session
}

afterEach(() => vi.restoreAllMocks())

describe('fromJsonSchema', () => {
  it('refuses lists of objects and says how to leave them out', () => {
    expect(() => fromJsonSchema(contact)).toThrow(/Lists of objects can't be mapped from a flat file: 'phones'.*exclude: \['phones'\]/)
  })

  it('derives fields: types, groups, required, options, aliases, name and id', () => {
    const schema = fromJsonSchema(contact, { exclude: ['phones'] })
    expect(schema.name).toBe('Contact')
    expect(schema.id).toBe('contact')
    const byKey = Object.fromEntries(schema.fields.map((f) => [f.key, f]))
    expect(Object.keys(byKey)).toEqual([
      'firstName',
      'email',
      'status',
      'signupDate',
      'company',
      'vatId',
      'score',
      'ratio',
      'address.street',
      'address.zip',
      'tags',
    ])
    expect(byKey.firstName).toMatchObject({ label: 'First name', required: true, aliases: ['Vorname'], min: 1 })
    expect(byKey.email).toMatchObject({ type: 'email', required: true })
    expect(byKey.status?.options?.map((o) => o.value)).toEqual(['lead', 'customer'])
    expect(byKey.signupDate?.type).toBe('date')
    expect(byKey['address.zip']).toMatchObject({ group: 'Address', pattern: '^\\d{5}$' })
    expect(byKey.tags?.multiple).toBe(true)
  })

  it('translates exclusive bounds exactly for integers and leaves the others to the validator', () => {
    const schema = fromJsonSchema(contact, { exclude: ['phones'] })
    expect(schema.fields.find((f) => f.key === 'score')).toMatchObject({ min: 1, max: 99 })
    expect(schema.fields.find((f) => f.key === 'ratio')?.min).toBeUndefined()
  })

  it('applies per-field overrides', async () => {
    const schema = fromJsonSchema(contact, { exclude: ['phones'], fields: { vatId: { aliases: ['USt-IdNr'] } } })
    const session = await load(schema, 'Vorname,email,USt-IdNr\nAda,ada@x.io,DE123\n')
    expect(Object.keys(session.getState().mapping).sort()).toEqual(['email', 'firstName', 'vatId'])
  })

  it('without a validator, checks what translates into field rules only', async () => {
    const schema = fromJsonSchema(contact, { exclude: ['phones'] })
    const session = await load(schema, 'firstName,email,company,address.zip\nAda,ada@x.io,ACME,123\n')
    await session.confirmMapping()
    const issues = session.getState().rows[0]?.issues ?? []
    expect(issues.map((i) => i.field)).toEqual(['address.zip']) // pattern; dependentRequired isn't checked
  })

  it('with Ajv, validates the whole schema and puts errors on the right fields', async () => {
    const schema = fromJsonSchema(contact, { exclude: ['phones'], validate: compile(contact) })
    const session = await load(schema, 'firstName,email,company,vatId\nAda,ada@x.io,ACME,\nAlan,alan@x.io,ACME,DE1\nGrace,grace@x.io,,\n')
    await session.confirmMapping()
    const [ada, alan, grace] = session.getState().rows
    expect(ada?.issues).toEqual([expect.objectContaining({ field: 'vatId', code: 'schema', message: expect.stringMatching(/vatId/) })])
    expect(alan?.issues).toEqual([])
    expect(grace?.issues).toEqual([])
  })

  it('reports rules without a single field (anyOf) on the row', async () => {
    const eitherOr = {
      ...contact,
      required: ['firstName'],
      anyOf: [{ required: ['email'] }, { required: ['company'] }],
      dependentRequired: {},
    }
    const schema = fromJsonSchema(eitherOr, { exclude: ['phones'], validate: compile(eitherOr) })
    const session = await load(schema, 'firstName,email,company\nAda,,\nAlan,alan@x.io,\n')
    await session.confirmMapping()
    const [ada, alan] = session.getState().rows
    expect(ada?.issues.some((i) => i.field === undefined && /anyOf/.test(i.message))).toBe(true)
    expect(alan?.issues).toEqual([])
  })

  it('keeps custom fields out of a closed schema (additionalProperties: false)', async () => {
    const schema = fromJsonSchema(contact, { exclude: ['phones'], validate: compile(contact) })
    const session = await load(schema, 'firstName,email,Segment\nAda,ada@x.io,A\n', { customFields: true })
    const segment = session.getState().sourceFields.find((f) => f.label === 'Segment')?.key as string
    session.addCustomField({ label: 'Segment', type: 'string', source: segment })
    await session.confirmMapping()
    expect(session.getState().rows[0]?.issues).toEqual([])
    expect(await session.getRecords()).toEqual([{ firstName: 'Ada', email: 'ada@x.io', tags: [], $custom: { segment: 'A' } }])
  })

  it('supports async validators and other error formats', async () => {
    const asyncValidate = compile(contact, true) as unknown as JsonSchemaValidator
    const schema = fromJsonSchema(contact, { exclude: ['phones'], validate: asyncValidate })
    const session = await load(schema, 'firstName,email,company\nAda,ada@x.io,ACME\n')
    await session.confirmMapping()
    expect(session.getState().rows[0]?.issues.map((i) => i.field)).toEqual(['vatId'])

    // Ajv 6 (dataPath) and schemasafe (instanceLocation)
    const legacy = Object.assign(() => false, { errors: [{ dataPath: '.address.zip', message: 'bad zip' }] })
    const located = Object.assign(() => false, { errors: [{ instanceLocation: '#/address/street', message: 'bad street' }] })
    for (const [validate, field] of [
      [legacy, 'address.zip'],
      [located, 'address.street'],
    ] as const) {
      const s = await load(fromJsonSchema(contact, { exclude: ['phones'], validate }), 'firstName,email\nAda,ada@x.io\n')
      await s.confirmMapping()
      expect(s.getState().rows[0]?.issues.map((i) => i.field)).toEqual([field])
    }
  })

  it('runs the same in run()', async () => {
    const importer = createImporter({
      schema: fromJsonSchema(contact, { exclude: ['phones'], validate: compile(contact) }),
      plugins: [testFormats],
      recipes: false,
    })
    const records: unknown[] = []
    const invalid: ReviewRow[] = []
    for await (const chunk of importer.run(
      sourceFromString('firstName,email,company,vatId\nAda,ada@x.io,ACME,\nAlan,alan@x.io,,\n', 'a.csv'),
    )) {
      records.push(...chunk.records)
      invalid.push(...chunk.invalid)
    }
    expect(records).toEqual([{ firstName: 'Alan', email: 'alan@x.io', tags: [] }])
    expect(invalid.map((r) => r.values.firstName)).toEqual(['Ada'])
  })

  it('needs an object schema', () => {
    expect(() => fromJsonSchema({ type: 'string' })).toThrow(/object schema with `properties`/)
  })
})

describe('createImporter with a plain JSON Schema', () => {
  it('says to wrap it', () => {
    expect(() => createImporter({ schema: contact as never, plugins: [testFormats] })).toThrow(/fromJsonSchema\(schema\)/)
  })
})

describe('zod schemas with lists of objects', () => {
  it('leave them out with a warning instead of a broken field', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const schema = defineSchema(z.object({ name: z.string(), items: z.array(z.object({ sku: z.string() })).optional() }))
    expect(schema.fields.map((f) => f.key)).toEqual(['name'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('items'))
  })
})
