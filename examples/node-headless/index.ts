/**
 * Headless import on the server: no UI, no session — just stream a file through
 * the same schema, matching and validation the React UI uses.
 *
 *   pnpm --filter @openimport/example-node-headless start
 */
import { createImporter, defineSchema, field, sourceFromString } from '@openimport/core'
import { csv } from '@openimport/csv'

const contacts = defineSchema({
  id: 'contacts',
  fields: {
    firstName: field.string({ required: true }),
    lastName: field.string({ required: true }),
    email: field.email({ required: true, unique: true }),
    birthday: field.date(),
    revenue: field.number({ min: 0, aliases: ['Umsatz', 'turnover'] }),
    status: field.enum(['active', 'inactive'], { aliases: ['state'] }),
  },
})

const importer = createImporter({
  schema: contacts,
  plugins: [csv()],
  recipes: false,
})

// A typical German Excel export: semicolons, comma decimals, day-first dates, a title line.
const file = sourceFromString(
  [
    'Kundenexport Q3;;;;;',
    'Vorname;Nachname;E-Mail;Geburtsdatum;Umsatz;Status',
    'Jana;Schmidt;jana@example.com;17.05.1990;1.234,50;active',
    'Ole;Berg;ole@example.com;03.11.1985;99,90;inactive',
    'Mia;;mia(at)example.com;31.02.1999;-5;active',
    'Ole;Berg;ole@example.com;03.11.1985;12,00;active',
  ].join('\n'),
  'kunden.csv',
)

let imported = 0
for await (const chunk of importer.run(file, { batchSize: 100 })) {
  if (chunk.mapping && chunk.sourceFields) {
    const label = (key: string) => chunk.sourceFields?.find((f) => f.key === key)?.label ?? key
    console.log('Mapping')
    for (const [target, m] of Object.entries(chunk.mapping)) console.log(`  ${m.sources.map(label).join(' + ')} → ${target}`)
  }
  console.log('\nValid records')
  console.table(chunk.records)
  imported += chunk.records.length

  if (chunk.issues.length) {
    console.log('\nIssues')
    for (const issue of chunk.issues) console.log(`  line ${issue.sourceIndex} ${issue.field ?? '(row)'}: ${issue.message}`)
  }
}
console.log(`\n${imported} record(s) ready to save.`)
