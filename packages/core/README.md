# @openimport/core

The headless engine of [OpenImport](../../README.md): schema, session state machine, column matching, declarative transforms, coercion, validation, recipes and streaming runs. It has zero dependencies, no framework and runs anywhere.

```bash
npm i @openimport/core @openimport/csv
```

```ts
import { createImporter, defineSchema, field } from '@openimport/core'
import { csv } from '@openimport/csv'

const importer = createImporter({
  schema: defineSchema({
    fields: {
      email: field.email({ required: true, unique: true }),
      name: field.string({ required: true }),
      plan: field.enum(['free', 'pro']),
    },
  }),
  plugins: [csv()],
})

// Interactive (what the UI drives)
const session = importer.createSession()
session.subscribe((state) => console.log(state.step))
await session.loadFile(file)
await session.confirmMapping()
await session.submit(({ records }) => api.save(records))

// Streaming, no UI
for await (const { records, issues } of importer.run(file)) await db.insert(records)
```

## Config

| Option | Default | |
|---|---|---|
| `schema` | – | `defineSchema(…)` result, or a zod / arktype (or wrapped valibot) object schema |
| `plugins` | `[]` | formats, matchers, transforms, event listeners |
| `recipes` | `localStorageRecipeStore()` | where mapping recipes live; `false` disables |
| `autoMapThreshold` | `0.7` | minimum confidence to apply suggestions automatically |
| `headerSelection` | `'auto'` | show the header step: `auto`, `always`, `never` |
| `invalidRows` | `'block'` | `block` submission until rows are fixed, or `skip` them |
| `batchSize` | `1000` | rows per `onSubmit` call / `run()` chunk |
| `maxFileSize`, `maxRows` | – | limits with friendly errors, enforced in the session and in `run()` |
| `onSubmit` | – | persists records in batches; resumable, with `batchId` for idempotency |
| `onEvent` | – | lifecycle events |

See the [docs](../../docs) for schemas, mapping, transforms, plugins and the session API.
