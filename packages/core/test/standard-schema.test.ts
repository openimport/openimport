/** Verifies the "bring your own schema library" claim for each library we name. */
import { toStandardJsonSchema } from '@valibot/to-json-schema'
import { type } from 'arktype'
import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createImporter, sourceFromString } from '../src'
import { testFormats } from './helpers'

const CSV = 'email,age\nada@x.io,36\nnot-an-email,12\n'

async function importWith(schema: Parameters<typeof createImporter>[0]['schema']) {
  const session = createImporter({ schema, plugins: [testFormats], recipes: false } as Parameters<typeof createImporter>[0]).createSession()
  await session.loadFile(sourceFromString(CSV, 'a.csv'))
  await session.confirmMapping()
  return {
    fields: session.schema.fields.map((f) => `${f.key}:${f.type}`),
    stats: session.getState().stats,
    records: await session.getRecords(),
  }
}

describe('Standard Schema libraries', () => {
  it('zod (native)', async () => {
    const r = await importWith(z.object({ email: z.email(), age: z.number().optional() }))
    expect(r.fields).toEqual(['email:email', 'age:number'])
    expect(r.records).toEqual([{ email: 'ada@x.io', age: 36 }])
  })

  it('arktype (native)', async () => {
    const r = await importWith(type({ email: 'string.email', 'age?': 'number' }) as never)
    expect(r.fields).toEqual(['email:email', 'age:number'])
    expect(r.records).toEqual([{ email: 'ada@x.io', age: 36 }])
  })

  it('valibot (via toStandardJsonSchema)', async () => {
    const r = await importWith(
      toStandardJsonSchema(v.object({ email: v.pipe(v.string(), v.email()), age: v.optional(v.number()) })) as never,
    )
    expect(r.fields).toEqual(['email:email', 'age:number'])
    expect(r.records).toEqual([{ email: 'ada@x.io', age: 36 }])
  })
})
