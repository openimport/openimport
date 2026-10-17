import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { defineSchema, field, fieldsFromJsonSchema, type InferSchema } from '../src'

describe('defineSchema', () => {
  it('builds fields from typed builders with humanized labels and groups', () => {
    const schema = defineSchema({
      id: 'contacts',
      fields: {
        firstName: field.string({ required: true }),
        email: field.email({ required: true, unique: true }),
        age: field.integer(),
        status: field.enum(['active', 'inactive'] as const),
        tags: field.string({ multiple: true }),
        'address.city': field.string(),
      },
    })
    expect(schema.fields.map((f) => f.key)).toEqual(['firstName', 'email', 'age', 'status', 'tags', 'address.city'])
    expect(schema.fields[0]).toMatchObject({ label: 'First name', type: 'string', required: true })
    expect(schema.fields[3]?.options).toEqual([{ value: 'active' }, { value: 'inactive' }])
    expect(schema.fields[5]).toMatchObject({ label: 'City', group: 'Address' })

    type Rec = InferSchema<typeof schema>
    expectTypeOf<Rec['firstName']>().toEqualTypeOf<string>()
    expectTypeOf<Rec['age']>().toEqualTypeOf<number | undefined>()
    expectTypeOf<Rec['status']>().toEqualTypeOf<'active' | 'inactive' | undefined>()
    expectTypeOf<Rec['tags']>().toEqualTypeOf<string[] | undefined>()
    expectTypeOf<Rec['address']['city']>().toEqualTypeOf<string | undefined>()
  })

  it('accepts runtime field lists', () => {
    const schema = defineSchema({ fields: [{ key: 'sku', label: 'SKU', type: 'string', required: true }] })
    expect(schema.fields).toHaveLength(1)
  })

  it('rejects duplicate keys', () => {
    expect(() =>
      defineSchema({
        fields: [
          { key: 'a', label: 'A', type: 'string' },
          { key: 'a', label: 'A', type: 'string' },
        ],
      }),
    ).toThrow(/Duplicate/)
  })

  it('derives fields from a zod schema via Standard JSON Schema', () => {
    const schema = defineSchema(
      z.object({
        firstName: z
          .string()
          .min(1)
          .meta({ title: 'Given name', aliases: ['vorname'] }),
        email: z.email(),
        age: z.number().int().optional(),
        plan: z.enum(['free', 'pro']).nullable(),
        birthday: z.iso.date().optional(),
        website: z.url().optional(),
        address: z.object({ city: z.string(), zip: z.string().optional() }),
        tags: z.array(z.string()).optional(),
      }),
      { fields: { email: { unique: true } } },
    )
    const byKey = Object.fromEntries(schema.fields.map((f) => [f.key, f]))
    expect(byKey.firstName).toMatchObject({ label: 'Given name', type: 'string', required: true, aliases: ['vorname'] })
    expect(byKey.email).toMatchObject({ type: 'email', required: true, unique: true })
    expect(byKey.age).toMatchObject({ type: 'integer' })
    expect(byKey.age?.required).toBeUndefined()
    expect(byKey.plan).toMatchObject({ type: 'enum', options: [{ value: 'free' }, { value: 'pro' }] })
    expect(byKey.plan?.required).toBeUndefined()
    expect(byKey.birthday?.type).toBe('date')
    expect(byKey.website?.type).toBe('url')
    expect(byKey['address.city']).toMatchObject({ required: true, group: 'Address' })
    expect(byKey.tags).toMatchObject({ multiple: true })
    expect(schema.standard).toBeDefined()

    type Rec = InferSchema<typeof schema>
    expectTypeOf<Rec['address']['city']>().toEqualTypeOf<string>()
  })

  it('resolves $ref and nullable unions in plain JSON Schema', () => {
    const fields = fieldsFromJsonSchema({
      $defs: { Money: { type: 'number', minimum: 0 } },
      type: 'object',
      properties: { price: { $ref: '#/$defs/Money' }, note: { type: ['string', 'null'] } },
      required: ['price', 'note'],
    })
    expect(fields[0]).toMatchObject({ key: 'price', type: 'number', min: 0, required: true })
    expect(fields[1]?.required).toBeUndefined()
  })
})
