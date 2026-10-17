---
title: Mapping
description: How columns find their fields.
---

When a file is loaded, OpenImport builds a mapping from target fields to source columns. Users can change it on the mapping screen.

---

## Order of precedence

1. **Recipe.** If a saved recipe fits the file's headers, it's applied first.
2. **Matchers.** Every registered matcher suggests matches with a confidence between 0 and 1.
3. **Auto-apply.** Suggestions at or above `autoMapThreshold` (default `0.7`) are applied. The rest are shown as hints.

---

## The fuzzy matcher

Always registered. It compares column headers with each field's key, label and aliases, using:

- normalisation (`E-Mail-Adresse` → `e mail adresse`, umlauts, camelCase),
- an English and German synonym list (`Vorname` → first name, `PLZ` → postal code),
- nested paths (`name.family` → last name),
- the values in the column (a column of emails prefers an `email` field).

Add your own synonyms:

```ts
import { definePlugin, fuzzyMatcher } from '@openimport/core'

const matching = definePlugin({ name: 'synonyms', matchers: [fuzzyMatcher({ synonyms: [['msisdn', 'phone']] })] })
```

---

## Inferred options

For each mapped field, OpenImport looks at the data and fills in:

- **date order**: `DMY` for `15.03.2024`, `MDY` for `03/15/2024`,
- **decimal separator**: `,` for `1.234,56`,
- **value map**: `Kunde` → `customer` for enum fields.

Users can override all three in the transform editor.

---

## Mapping by hand

```ts
session.assign('email', 'c2')                  // one column, one field
session.setMapping('fullName', { sources: ['c0', 'c1'], transforms: [{ op: 'join' }] })
session.setMapping('email', null)              // unmap
```

Column keys are `c0`, `c1`, … for spreadsheets and property paths like `contact.email` for JSON and XML.

---

## Recipes

Confirming a mapping saves it as a recipe. Recipes store columns by header name, so they still fit when columns move.

```ts
createImporter({ schema, recipes: indexedDbRecipeStore() })    // default in browsers and workers
createImporter({ schema, recipes: { list: (id) => api.list(id), save: (r) => api.save(r) } })
createImporter({ schema, recipes: false })                       // off
```

`session.exportRecipe()` returns the current mapping as JSON, together with the header row, the dataset and the format. Pass it to [`run()`](./server.md) to import the same way on a server.

Recipes from storage, APIs or users are validated with `parseRecipe()` before use: unknown transforms, wrong parameter types, invalid regular expressions and unsafe field paths are rejected with `invalid_recipe`.
