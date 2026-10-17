/**
 * pnpm --filter @openimport/example-jev-matcher demo
 *
 * 1. Maps a file with hard headers using the built-in fuzzy matcher only.
 * 2. Prints the exact request the Jev matcher would send for the fields it couldn't map.
 * 3. With TYPESAFE_API_KEY set, sends it and prints the combined mapping.
 */
import { createImporter, type ImportPlugin, type MatchSuggestion } from '@openimport/core'
import { csv } from '@openimport/csv'
import { buildJevRequest, fieldsToAsk, jevMatcher } from './index'
import { file, schema } from './sample'

async function mapWith(plugins: ImportPlugin[]) {
  let suggestions: MatchSuggestion[] = []
  const importer = createImporter({
    schema,
    plugins: [csv(), ...plugins],
    recipes: false,
    onEvent: (e) => {
      if (e.type === 'mapping:suggested') suggestions = e.suggestions
    },
  })
  const session = importer.createSession()
  await session.loadFile(file)
  return { importer, session, suggestions }
}

function printMapping({ session, suggestions }: Awaited<ReturnType<typeof mapWith>>) {
  const { mapping, sourceFields } = session.getState()
  const header = (key: string) => sourceFields.find((f) => f.key === key)?.label ?? key
  for (const f of schema.fields) {
    const m = mapping[f.key]
    const why = m && suggestions.find((s) => s.target === f.key && s.sources[0] === m.sources[0])?.reason
    console.log(`  ${f.label.padEnd(16)} ${m ? `← ${header(m.sources[0] as string)}`.padEnd(16) : '—'.padEnd(16)} ${why ?? ''}`)
  }
}

console.log('\n1 · Fuzzy matcher only\n')
const fuzzy = await mapWith([])
printMapping(fuzzy)

console.log('\n2 · What the Jev matcher sends for the rest\n')
const state = fuzzy.session.getState()
const ctx = {
  schema: fuzzy.importer.schema,
  sourceFields: state.sourceFields,
  mapping: {},
  transforms: [],
  signal: new AbortController().signal,
}
const ask = await fieldsToAsk(ctx)
console.log(`  Asked about: ${ask.map((f) => f.label).join(', ')}`)
console.log(
  `  Not asked (fuzzy is sure): ${schema.fields
    .filter((f) => !ask.includes(f))
    .map((f) => f.label)
    .join(', ')}\n`,
)
const request = buildJevRequest(ctx, ask)
const first = Object.keys(request.questions)[0] as string
const indent = (text: string) => text.replace(/^/gm, '  ')
console.log(indent(`state.task: ${JSON.stringify(request.state.task)}`))
console.log(indent('state.columns:'))
for (const column of request.state.columns as object[]) console.log(indent(`  ${JSON.stringify(column)}`))
console.log(indent(`\nquestions.${first} (one per field):`))
console.log(indent(JSON.stringify(request.questions[first], null, 2)))

if (!process.env.TYPESAFE_API_KEY) {
  console.log('\n3 · Set TYPESAFE_API_KEY to send this to Jev and see the combined mapping.\n')
} else {
  console.log('\n3 · Fuzzy matcher + Jev\n')
  printMapping(await mapWith([jevMatcher()]))
  console.log()
}
