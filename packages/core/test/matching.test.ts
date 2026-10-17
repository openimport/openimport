import { describe, expect, it } from 'vitest'
import { defineSchema, field, fieldsFromGrid, fieldsFromRecords, fuzzyMatcher, similarity, suggestValueMap } from '../src'

describe('similarity', () => {
  it('scores synonyms and spelling variants highly', () => {
    expect(similarity('E-Mail', 'email')).toBe(1)
    expect(similarity('Vorname', 'firstName')).toBeGreaterThanOrEqual(0.9)
    expect(similarity('PLZ', 'Postal code')).toBeGreaterThanOrEqual(0.9)
    expect(similarity('Customer Email Address', 'email')).toBeGreaterThanOrEqual(0.8)
    expect(similarity('Straße', 'street')).toBeGreaterThanOrEqual(0.9)
  })

  it('keeps distinct concepts apart', () => {
    expect(similarity('First name', 'Last name')).toBeLessThan(0.5)
    expect(similarity('Name', 'First name')).toBeLessThan(0.5)
    expect(similarity('Phone', 'Email')).toBeLessThan(0.3)
  })
})

describe('fuzzyMatcher', () => {
  const schema = defineSchema({
    fields: {
      firstName: field.string({ required: true }),
      lastName: field.string(),
      email: field.email(),
      phone: field.string({ aliases: ['msisdn'] }),
      zip: field.string({ label: 'Postal code' }),
      revenue: field.number(),
    },
  })
  const grid = [
    ['Vorname', 'Nachname', 'E-Mail-Adresse', 'MSISDN', 'PLZ', 'Fakturavolumen', 'Notes'],
    ['Ada', 'Lovelace', 'ada@example.com', '+44 1', '10115', '1.200,50', 'x'],
    ['Alan', 'Turing', 'alan@example.com', '+44 2', '10117', '900', 'y'],
  ]
  const sourceFields = fieldsFromGrid(grid, 0)

  it('maps German headers to English fields', async () => {
    const suggestions = await fuzzyMatcher().match({
      schema,
      sourceFields,
      mapping: {},
      transforms: [],
      signal: new AbortController().signal,
    })
    const byTarget = Object.fromEntries(suggestions.map((s) => [s.target, sourceFields.find((f) => f.key === s.sources[0])?.label]))
    expect(byTarget).toMatchObject({ firstName: 'Vorname', lastName: 'Nachname', email: 'E-Mail-Adresse', phone: 'MSISDN', zip: 'PLZ' })
    expect(byTarget.revenue).toBeUndefined()
  })

  it('learns custom synonyms', async () => {
    const suggestions = await fuzzyMatcher({ synonyms: [['revenue', 'fakturavolumen']] }).match({
      schema,
      sourceFields,
      mapping: {},
      transforms: [],
      signal: new AbortController().signal,
    })
    expect(suggestions.find((s) => s.target === 'revenue')).toBeDefined()
  })

  it('never assigns one column twice and skips mapped fields', async () => {
    const suggestions = await fuzzyMatcher().match({
      schema,
      sourceFields,
      mapping: { email: { sources: ['c0'] } },
      transforms: [],
      signal: new AbortController().signal,
    })
    expect(suggestions.find((s) => s.target === 'email')).toBeUndefined()
    expect(suggestions.flatMap((s) => s.sources)).not.toContain('c0')
  })
})

describe('suggestValueMap', () => {
  it('maps fuzzy enum values to options', () => {
    const f = field.enum([
      { value: 'active', label: 'Active', aliases: ['aktiv'] },
      { value: 'churned', label: 'Churned' },
    ])
    expect(suggestValueMap(['Active', 'Aktiv ', 'churn', 'random'], { ...f, key: 'status', label: 'Status' })).toEqual({ churn: 'churned' })
  })
})

describe('nested record paths', () => {
  it('matches leaf and reversed path segments', async () => {
    const schema = defineSchema({
      fields: { firstName: field.string(), lastName: field.string(), email: field.email(), street: field.string() },
    })
    const sourceFields = fieldsFromRecords([
      { 'name.given': 'Ada', 'name.family': 'Lovelace', 'contact.email': 'a@x.io', 'billing_address.line1': 'Main St 1' },
    ])
    const suggestions = await fuzzyMatcher().match({
      schema,
      sourceFields,
      mapping: {},
      transforms: [],
      signal: new AbortController().signal,
    })
    expect(Object.fromEntries(suggestions.map((s) => [s.target, s.sources[0]]))).toEqual({
      firstName: 'name.given',
      lastName: 'name.family',
      email: 'contact.email',
      street: 'billing_address.line1',
    })
  })
})
