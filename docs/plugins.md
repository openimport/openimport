---
title: Plugins
description: Add file formats, matchers, transforms and event listeners.
---

Plugins can add four things:

| Plugin part | For |
|---|---|
| `formats` | reading a file type |
| `matchers` | suggesting which column fills which field |
| `transforms` | named steps users and recipes can apply |
| `onEvent` | observing the import (analytics, logging) |

Everything else is configured, not plugged in: field types and validation live in the [schema](./schema.md), persistence in [`onSubmit`](./output.md), limits and policies in [config](./config.md).

```ts
import { definePlugin } from '@openimport/core'

export const myPlugin = definePlugin({
  name: 'my-plugin',
  formats: [],
  matchers: [],
  transforms: [],
  onEvent: (event) => {},
})

createImporter({ schema, plugins: [csv(), myPlugin] })
```

---

## Collisions

Results never depend on plugin order. `createImporter()` throws `invalid_plugin` when:

- two plugins register the same format id or matcher id,
- two plugins register the same transform op,
- a plugin redefines a built-in transform without `override: true`.

A matcher with id `fuzzy` deliberately replaces the built-in fuzzy matcher.

---

## Formats

A format has two methods: `inspect` lists the tables in a file, `read` streams their rows.

```ts
const fixedWidth = {
  id: 'fwf',
  label: 'Fixed width',
  extensions: ['dat'],
  capabilities: { streaming: true, cancellation: true, sourceLocations: true },
  inspect: async (file) => ({ datasets: [{ id: 'all', label: file.name, layout: 'grid' }] }),
  async *read(file, { signal }) { … },
}
```

- `layout: 'grid'` yields arrays of cells, header row included. The header is found for you.
- `layout: 'records'` yields objects. Nested objects become `a.b` columns.
- Yield chunks of about 1,000 rows and throw when `signal` is aborted.
- Keep values raw. Coercion happens later, where the user can control it.
- Throw `importError('parse_failed', 'Readable message')` for errors the user should see.

### Capabilities

Declare what your format does, so apps can rely on it:

| Capability | Meaning |
|---|---|
| `streaming` | rows are read incrementally; memory doesn't grow with the file |
| `cancellation` | reading stops when the signal aborts |
| `sourceLocations` | row numbers match lines or records in the original file |

---

## Testing a plugin

`@openimport/core/testing` checks a plugin against the contract: dataset shapes, row shapes, value types, row counts, and that declared cancellation actually works.

```ts
import { checkPlugin } from '@openimport/core/testing'

it('conforms', async () => {
  expect(await checkPlugin(fixedWidth(), { fwf: sourceFromString(sample, 'a.dat') })).toEqual([])
})
```

`examples/fixed-width-plugin` is a complete third-party plugin with these tests. The built-in formats run the same checks.

---

## Matchers

```ts
const erp = {
  id: 'erp',
  priority: 5,
  match: ({ sourceFields, mapping, transforms }) =>
    sourceFields
      .filter((c) => c.label.startsWith('ERP_'))
      .map((c) => ({ target: c.label.slice(4).toLowerCase(), sources: [c.key], confidence: 0.9 })),
}
```

Return every plausible match; conflicts are resolved for you. Skip fields already in `mapping`. `transforms` lists every registered transform, built-in and from plugins. Never throw for expected failures; return `[]`.

---

## Transforms

See [Transforms](./transforms.md#your-own-transforms).
