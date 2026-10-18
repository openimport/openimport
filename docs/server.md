---
title: Server-side
description: Import without a UI, in Node, Bun, Deno or a worker.
---

`importer.run()` runs the same pipeline as the interactive importer and yields batches: same limits, transforms, rules, Standard Schema, uniqueness and `validateBatch`.

```ts title="jobs/import.ts"
import { openAsBlob } from 'node:fs'

// Read from disk as the import goes, instead of loading the file into memory
const file = new File([await openAsBlob('export.csv')], 'export.csv')

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

A recipe replays the mapping, transforms, value maps, date and number formats, the header row, the dataset (sheet or JSON collection) and the user's [custom fields](./custom-fields.md), if the importer allows them. Recipes are validated before use; an invalid one throws `invalid_recipe`.

Format settings such as a forced CSV delimiter are plugin options, not part of the recipe. Configure them on the plugin.

---

## Memory

Rows are validated and yielded `batchSize` at a time. What else stays in memory depends on the format:

| Format | Read |
|---|---|
| CSV, JSON Lines | streamed; memory doesn't grow with the file |
| JSON, XML, Excel | the whole document is parsed first |

`unique` fields keep one entry per distinct value, about 100 MB per million values. Without unique fields, a million-row CSV runs in a few MB of heap.

---

## Serverless

- **AWS Lambda:** read large files from S3, not the request body (6 MB). Download to `/tmp` and open with `openAsBlob`, so the file isn't held in memory. A run has to finish within the function's time limit (15 minutes; a CSV runs at roughly 200,000 rows a second).
- **Cloudflare Workers:** memory is the limit (128 MB), and an R2 object's `.blob()` holds the whole file in memory. CSV files of a few tens of MB work; very large files, many unique values or big Excel files don't fit yet.

Streaming input, resumable runs and a swappable uniqueness check for these platforms are on the [roadmap](./roadmap.md).

---

## Uniqueness

`run()` sees rows in order, so the first occurrence of a value is kept and later ones are errors ("Duplicate of row 5"). The interactive importer uses the same rule and also warns on the first occurrence.

---

## Options

| Option | |
|---|---|
| `recipe` | a saved recipe |
| `mapping` | or a mapping with sources given by header name |
| `customFields` | custom fields an explicit `mapping` uses (a recipe brings its own) |
| `autoMap` | match automatically when neither is given (default `true`) |
| `dataset` | sheet or collection id (default: the recipe's, then the first) |
| `headerRow` | header row (default: the recipe's, then detection) |
| `batchSize` | rows per chunk (default 1,000) |
| `signal` | an `AbortSignal` |

For JSON and XML, properties that appear late in the file are still read when a recipe or mapping names them explicitly.

---

## Runtimes

The packages use only web APIs (`Blob`, streams, `TextDecoder`). CI runs the same import on Node, Bun and Deno: see `examples/runtime-smoke`.
