// Uses the *built* packages (dist), exactly as an app would after `npm install`.
import { createImporter, defineSchema, field, sourceFromString } from '@openimport/core'
import { csv } from '@openimport/csv'
import { jsonFormats } from '@openimport/json'

const runtime = globalThis.Deno ? `deno ${Deno.version.deno}` : globalThis.Bun ? `bun ${Bun.version}` : `node ${process.versions.node}`

const importer = createImporter({
  schema: defineSchema({
    fields: {
      name: field.string({ required: true }),
      email: field.email({ unique: true }),
      since: field.date({ aliases: ['Kunde seit'] }),
    },
  }),
  plugins: [csv(), jsonFormats()],
  recipes: false,
})

const results = []
for (const file of [
  sourceFromString('Report\n\nName;E-Mail;Kunde seit\nAda;ada@x.io;15.03.2024\nAlan;ADA@x.io;01.02.2024\n', 'contacts.csv'),
  sourceFromString(JSON.stringify({ data: { people: [{ name: 'Grace', email: 'grace@x.io', since: '2024-01-05' }] } }), 'people.json'),
]) {
  const records = []
  const issues = []
  for await (const chunk of importer.run(file)) {
    records.push(...chunk.records)
    issues.push(...chunk.issues.map((i) => `${i.sourceIndex}:${i.code}`))
  }
  results.push({ records, issues })
}

const expected = JSON.stringify([
  { records: [{ name: 'Ada', email: 'ada@x.io', since: '2024-03-15' }], issues: ['5:duplicate'] },
  { records: [{ name: 'Grace', email: 'grace@x.io', since: '2024-01-05' }], issues: [] },
])
if (JSON.stringify(results) !== expected) {
  console.error(`✗ ${runtime}\n${JSON.stringify(results, null, 2)}`)
  throw new Error('runtime smoke test failed')
}
console.log(`✓ ${runtime}`)
