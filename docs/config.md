---
title: Config
description: Every option of createImporter.
---

```ts
createImporter({
  schema,
  plugins: [csv()],
  recipes: indexedDbRecipeStore(),
  autoMapThreshold: 0.7,
  headerSelection: 'auto',
  invalidRows: 'block',
  batchSize: 1000,
  maxFileSize: 50 * 1024 * 1024,
  maxRows: 100_000,
  onSubmit: async ({ records }) => {},
  onEvent: (event) => {},
})
```

| Option | Default | |
|---|---|---|
| `schema` | – | from `defineSchema()`, or a zod / valibot / arktype object |
| `plugins` | `[]` | formats, matchers, transforms, listeners |
| `recipes` | IndexedDB, else `localStorage` | where mappings are remembered; `false` turns it off |
| `autoMapThreshold` | `0.7` | confidence needed to apply a suggestion automatically |
| `headerSelection` | `'auto'` | show the header step: `auto`, `always`, `never` |
| `invalidRows` | `'block'` | `block` until fixed, or `skip` them |
| `batchSize` | `1000` | rows per `onSubmit` call and per `run()` chunk |
| `maxFileSize` | – | bytes; larger files get a friendly error |
| `maxRows` | – | data rows (header and blank lines excluded); more is an error in the session and in `run()` |
| `customFields` | `false` | let users add unmatched columns as typed fields; see [Custom fields](./custom-fields.md) |
| `onSubmit` | – | persist valid records, in batches; see [Output](./output.md) |
| `onEvent` | – | lifecycle events |
