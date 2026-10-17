/**
 * Reproduces the "import trace" on the landing page: a messy German CRM
 * export (title rows, semicolons, DD.MM.YYYY, decimal commas, typos) run
 * through a real session, timed per stage.
 *
 *   pnpm bench            # 50,000 rows
 *   pnpm bench 200000     # any row count
 */
import { arch, cpus, platform } from 'node:os'
import { createImporter, defineSchema, field, memoryRecipeStore } from '@openimport/core'
import { csv } from '@openimport/csv'

const ROWS = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 50_000)

const schema = defineSchema({
  id: 'contacts',
  fields: {
    firstName: field.string({ required: true }),
    lastName: field.string({ required: true }),
    email: field.email({ required: true, unique: true }),
    phone: field.string(),
    status: field.enum([
      { value: 'lead', aliases: ['interessent'] },
      { value: 'customer', aliases: ['kunde'] },
      { value: 'churned', aliases: ['ex-kunde'] },
    ]),
    signupDate: field.date(),
    revenue: field.number({ min: 0 }),
    newsletter: field.boolean(),
  },
})

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}

function crmExport(rows: number): File {
  const r = rng(42)
  const pick = <T>(list: T[]) => list[Math.floor(r() * list.length)] as T
  const first = ['Anna', 'Lukas', 'Mia', 'Leon', 'Emma', 'Paul', 'Sofia', 'Jonas', 'Lea', 'Jürgen']
  const last = ['Müller', 'Schmidt', 'Weber', 'Becker', 'Koch', 'Klein', 'Wolf']
  const lines = ['CRM Export – Kontakte;;;;;;;', 'Erstellt am 17.10.2026;;;;;;;', ';;;;;;;']
  lines.push('Vorname;Nachname;E-Mail-Adresse;Telefon;Status;Kunde seit;Umsatz (EUR);Newsletter')
  for (let i = 0; i < rows; i++) {
    let email = `user${i}@beispiel.de`
    if (r() < 0.015) email = email.replace('@', ' at ')
    if (i > 10 && r() < 0.01) email = 'user3@beispiel.de'
    const day = String(1 + Math.floor(r() * 28)).padStart(2, '0')
    const month = String(1 + Math.floor(r() * 12)).padStart(2, '0')
    lines.push(
      [
        r() < 0.01 ? '' : pick(first),
        pick(last),
        email,
        `+49 ${Math.floor(100 + r() * 899)} ${Math.floor(100000 + r() * 899999)}`,
        r() < 0.01 ? 'unbekannt' : pick(['Kunde', 'Interessent', 'Ex-Kunde']),
        r() < 0.005 ? '31.02.2020' : `${day}.${month}.${2015 + Math.floor(r() * 11)}`,
        r() < 0.2
          ? ''
          : (r() * 250000)
              .toFixed(2)
              .replace('.', ',')
              .replace(/\B(?=(\d{3})+(?!\d))/g, '.'),
        r() < 0.5 ? 'Ja' : 'Nein',
      ].join(';'),
    )
  }
  return new File([lines.join('\r\n')], 'crm-export.csv', { type: 'text/csv' })
}

const timings: [stage: string, ms: number, result: string][] = []
let last = performance.now()
const lap = (stage: string, result: string) => {
  const now = performance.now()
  timings.push([stage, now - last, result])
  last = now
}

const importer = createImporter({
  schema,
  plugins: [csv()],
  recipes: memoryRecipeStore(),
  onEvent: (e) => {
    if (e.type === 'file:loaded')
      lap(
        'file.inspect',
        `${e.format} · ${Object.entries(e.inspection.datasets[0]?.meta ?? {})
          .map(([k, v]) => `${k}=${v}`)
          .join(' ')}`,
      )
    if (e.type === 'rows:loaded') lap('rows.read', `${e.count.toLocaleString()} rows (header detection included)`)
    if (e.type === 'mapping:suggested') lap('columns.match', `${e.suggestions.length} suggestions`)
  },
})

const file = crmExport(ROWS)
const session = importer.createSession()
last = performance.now()
await session.loadFile(file)
if (session.getState().step === 'header') await session.confirmHeader()
lap('mapping.enrich', `${Object.keys(session.getState().mapping).length} of ${schema.fields.length} fields mapped`)

await session.confirmMapping()
const { stats } = session.getState()
lap('rows.validate', `${stats.withErrors.toLocaleString()} rows with errors`)

session.deleteInvalidRows()
last = performance.now()
let batches = 0
const result = await session.submit(() => {
  batches++
})
lap('submit', `${result?.submitted.toLocaleString()} records in ${batches} batches`)

const total = timings.reduce((n, [, ms]) => n + ms, 0)
console.log(`\nOpenImport benchmark · ${ROWS.toLocaleString()} rows · ${(file.size / 1024 / 1024).toFixed(1)} MB`)
console.log(`node ${process.versions.node} · ${platform()} ${arch()} · ${cpus()[0]?.model ?? 'unknown cpu'}\n`)
for (const [stage, ms, info] of timings) console.log(`${stage.padEnd(16)} ${`${ms.toFixed(1)} ms`.padStart(10)}   ${info}`)
console.log(`${'total'.padEnd(16)} ${`${total.toFixed(0)} ms`.padStart(10)}\n`)
