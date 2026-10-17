---
title: Server-side
description: Import without a UI, in Node, Bun, Deno or a worker.
---

`importer.run()` runs the same pipeline as the interactive importer and yields batches: same limits, transforms, rules, Standard Schema, uniqueness and `validateBatch`.

```ts title="jobs/import.ts"
import { readFile } from 'node:fs/promises'

const file = new File([await readFile('export.csv')], 'export.csv')

for await (const chunk of importer.run(file, { batchSize: 5000 })) {
  await db.contacts.insertMany(chunk.records)
  for (const issue of chunk.issues) {
    console.warn(`line ${issue.sourceIndex}: ${issue.field} ${issue.message}`)
  }
}
```

Each chunk has `records` (valid), `invalid` (rows with errors) and `issues`.

---

## Replaying a user's mapping

A user maps a file once in the browser. Save the recipe and replay it on the server:

```ts
// browser
await api.saveRecipe(session.exportRecipe('Weekly CRM export'))

// server
for await (const chunk of importer.run(file, { recipe: await api.getRecipe() })) { … }
```

A recipe replays the mapping, transforms, value maps, date and number formats, the header row and the dataset (sheet or JSON collection). Recipes are validated before use; an invalid one throws `invalid_recipe`.

Format settings such as a forced CSV delimiter are plugin options, not part of the recipe. Configure them on the plugin.

---

## Memory

Rows are validated and yielded `batchSize` at a time. What else stays in memory depends on the format:

| Format | Read |
|---|---|
| CSV, JSON Lines | streamed; memory doesn't grow with the file |
| JSON, XML, Excel | the whole document is parsed first |

`unique` fields keep one entry per distinct value, so very large imports with unique fields grow with the number of distinct values.

---

## Uniqueness

`run()` sees rows in order, so the first occurrence of a value is kept and later ones are errors ("Duplicate of row 5"). The interactive importer uses the same rule and also warns on the first occurrence.

---

## Options

| Option | |
|---|---|
| `recipe` | a saved recipe |
| `mapping` | or a mapping with sources given by header name |
| `autoMap` | match automatically when neither is given (default `true`) |
| `dataset` | sheet or collection id (default: the recipe's, then the first) |
| `headerRow` | header row (default: the recipe's, then detection) |
| `batchSize` | rows per chunk (default 1,000) |
| `signal` | an `AbortSignal` |

For JSON and XML, properties that appear late in the file are still read when a recipe or mapping names them explicitly.

---

## Runtimes

The packages use only web APIs (`Blob`, streams, `TextDecoder`). CI runs the same import on Node, Bun and Deno: see `examples/runtime-smoke`.
