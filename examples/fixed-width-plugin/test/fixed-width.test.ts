import { createImporter, defineSchema, field, sourceFromString } from '@openimport/core'
import { checkPlugin } from '@openimport/core/testing'
import { describe, expect, it } from 'vitest'
import { fixedWidth } from '../src'

const columns = [
  { name: 'Name', start: 0, end: 12 },
  { name: 'IBAN', start: 12, end: 40 },
  { name: 'Amount', start: 40, end: 50 },
]
const file = ['Ada Lovelace de89 3704 0044 0532 0130 00  1.234,50', 'Alan Turing de44 5001 0517 5407 3249 31      980,00', ''].join('\n')

describe('fixed-width plugin', () => {
  it('passes the OpenImport conformance checks', async () => {
    expect(await checkPlugin(fixedWidth({ columns }), { 'fixed-width': sourceFromString(file, 'payments.dat') })).toEqual([])
  })

  it('imports end to end, including its custom transform', async () => {
    const importer = createImporter({
      schema: defineSchema({ fields: { name: field.string(), iban: field.string(), amount: field.number() } }),
      plugins: [fixedWidth({ columns })],
      recipes: false,
    })
    const out = []
    for await (const chunk of importer.run(sourceFromString(file, 'payments.dat'), {
      mapping: {
        name: { sources: ['Name'] },
        iban: { sources: ['IBAN'], transforms: [{ op: 'iban' }] },
        amount: { sources: ['Amount'], options: { decimal: ',' } },
      },
    }))
      out.push(...chunk.records)
    expect(out).toEqual([
      { name: 'Ada Lovelace', iban: 'DE89370400440532013000', amount: 1234.5 },
      { name: 'Alan Turing', iban: 'DE44500105175407324931', amount: 980 },
    ])
  })
})
