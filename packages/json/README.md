# @openimport/json

JSON and JSON Lines format plugins for [OpenImport](../../README.md).

```ts
import { createImporter } from '@openimport/core'
import { json, jsonl } from '@openimport/json' // or the combined default export `jsonFormats()`

const importer = createImporter({ schema, plugins: [json(), jsonl()] })
```

## JSON: automatic record discovery

Every array of objects in the document becomes a dataset, addressed with a JSONPath-like id:

```json
{ "data": { "customers": [{ "name": "Ann", "address": { "city": "Köln" }, "orders": [{ "sku": "A" }] }] } }
```

| Dataset                          | Records                  |
| -------------------------------- | ------------------------ |
| `$.data.customers[*]`            | every customer           |
| `$.data.customers[*].orders[*]`  | every order of every customer |

- Top-level arrays come first, then shallower and larger collections
- Arrays of primitives are values, not datasets
- An object of objects (`{ "u1": {…}, "u2": {…} }`) is a keyed collection; the key is exposed as `_key`
- A single object is imported as one record

Nested objects are flattened by the core into dot paths (`address.city`) so they can be mapped like columns.

## JSON Lines / NDJSON

`.jsonl` / `.ndjson` files are streamed line by line. Blank lines are skipped, primitives
are wrapped as `{ value }`, and parse errors report the line number.

## Options

| Option      | Default | Description                              |
| ----------- | ------- | ---------------------------------------- |
| `chunkSize` | `1000`  | Records per yielded chunk                |
| `maxDepth`  | `8`     | How deep to search for record arrays (JSON) |
